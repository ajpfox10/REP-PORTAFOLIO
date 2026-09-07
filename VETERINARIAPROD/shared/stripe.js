'use strict';
/**
 * Stripe wrapper — flag-gated por STRIPE_SECRET_KEY.
 * Si la clave no está configurada, todos los métodos lanzan un error controlado.
 */
const logger = require('./logger');
const { getSecret } = require('./secrets');

function getStripe() {
  const key = getSecret('STRIPE_SECRET_KEY');
  if (!key) {
    throw Object.assign(
      new Error('Stripe not configured (STRIPE_SECRET_KEY missing)'),
      { http: 501, code: 'SVC_005' },
    );
  }
  // Lazy require para no fallar si stripe no está instalado
  try {
    const Stripe = require('stripe');
    return new Stripe(key, { apiVersion: '2023-10-16', timeout: 10000 });
  } catch {
    throw Object.assign(
      new Error('Stripe SDK not installed. Run: npm install stripe'),
      { http: 501, code: 'SVC_005' },
    );
  }
}

// Mapa plan interno → Stripe Price ID (configurar por env)
const PLAN_PRICE_IDS = {
  basic:      process.env.STRIPE_PRICE_BASIC      || null,
  pro:        process.env.STRIPE_PRICE_PRO        || null,
  enterprise: process.env.STRIPE_PRICE_ENTERPRISE || null,
};

/**
 * Crea o recupera un Stripe Customer para un org.
 */
async function getOrCreateCustomer(orgId, email, name) {
  const stripe = getStripe();
  const db     = require('./db');

  const tenant = await db.queryOne(
    'SELECT stripe_customer_id FROM tenants WHERE org_id = :orgId',
    { orgId },
  );

  if (tenant?.stripe_customer_id) {
    return stripe.customers.retrieve(tenant.stripe_customer_id);
  }

  const customer = await stripe.customers.create({
    email,
    name:     name || `Org ${orgId}`,
    metadata: { org_id: String(orgId) },
  });

  await db.query(
    'UPDATE tenants SET stripe_customer_id = :cid, billing_email = :email WHERE org_id = :orgId',
    { cid: customer.id, email, orgId },
  );

  return customer;
}

/**
 * Crea una suscripción en Stripe para un plan dado.
 */
async function createSubscription(orgId, plan, email, orgName) {
  const priceId = PLAN_PRICE_IDS[plan];
  if (!priceId) {
    throw Object.assign(
      new Error(`No Stripe Price ID configured for plan '${plan}'`),
      { http: 400, code: 'VAL_002' },
    );
  }

  const stripe   = getStripe();
  const db       = require('./db');
  const customer = await getOrCreateCustomer(orgId, email, orgName);

  const subscription = await stripe.subscriptions.create({
    customer:  customer.id,
    items:     [{ price: priceId }],
    metadata:  { org_id: String(orgId), plan },
    expand:    ['latest_invoice.payment_intent'],
  });

  await db.query(
    `UPDATE tenants SET
       stripe_subscription_id = :subId,
       stripe_price_id        = :priceId,
       plan                   = :plan,
       next_billing_date      = DATE_ADD(NOW(), INTERVAL 1 MONTH)
     WHERE org_id = :orgId`,
    { subId: subscription.id, priceId, plan, orgId },
  );

  logger.info('[stripe] Subscription created', { orgId, plan, subscriptionId: subscription.id });
  return subscription;
}

/**
 * Cancela la suscripción de un org.
 */
async function cancelSubscription(orgId) {
  const stripe = getStripe();
  const db     = require('./db');

  const tenant = await db.queryOne(
    'SELECT stripe_subscription_id FROM tenants WHERE org_id = :orgId',
    { orgId },
  );

  if (!tenant?.stripe_subscription_id) {
    throw Object.assign(new Error('No active subscription found'), { http: 404 });
  }

  const cancelled = await stripe.subscriptions.cancel(tenant.stripe_subscription_id);

  await db.query(
    'UPDATE tenants SET stripe_subscription_id = NULL, plan = :plan WHERE org_id = :orgId',
    { plan: 'free', orgId },
  );

  logger.info('[stripe] Subscription cancelled', { orgId });
  return cancelled;
}

/**
 * Genera URL del Stripe Customer Portal.
 */
async function getBillingPortalUrl(orgId, returnUrl) {
  const stripe = getStripe();
  const db     = require('./db');

  const tenant = await db.queryOne(
    'SELECT stripe_customer_id FROM tenants WHERE org_id = :orgId',
    { orgId },
  );

  if (!tenant?.stripe_customer_id) {
    throw Object.assign(new Error('No Stripe customer found for this org'), { http: 404 });
  }

  const session = await stripe.billingPortal.sessions.create({
    customer:   tenant.stripe_customer_id,
    return_url: returnUrl || process.env.BILLING_PORTAL_RETURN_URL || 'https://app.vetmanager.io/billing',
  });

  return session.url;
}

/**
 * Valida y parsea un webhook de Stripe.
 *
 * IMPORTANTE: `payload` debe ser el body RAW (Buffer o string) — NO el objeto
 * ya parseado por express.json(). La ruta del webhook debe usar:
 *   express.raw({ type: 'application/json' })
 * antes de llamar a este helper. Si se pasa un objeto, la firma HMAC de Stripe
 * fallará silenciosamente y el evento será rechazado.
 *
 * @param {Buffer|string} payload  — raw request body
 * @param {string}        signature — valor del header Stripe-Signature
 */
function constructWebhookEvent(payload, signature) {
  // Detectar si accidentalmente se pasó un objeto ya parseado
  if (payload !== null && typeof payload === 'object' && !Buffer.isBuffer(payload)) {
    throw Object.assign(
      new Error(
        'constructWebhookEvent: payload debe ser el body raw (Buffer/string), no un objeto parseado. ' +
        'Asegurate de usar express.raw({ type: "application/json" }) en la ruta del webhook.'
      ),
      { http: 400, code: 'STRIPE_PAYLOAD_PARSED' }
    );
  }
  if (!signature) {
    throw Object.assign(new Error('Stripe-Signature header missing'), { http: 400, code: 'STRIPE_SIG_MISSING' });
  }
  const stripe = getStripe();
  const secret = getSecret('STRIPE_WEBHOOK_SECRET');
  if (!secret) throw Object.assign(new Error('STRIPE_WEBHOOK_SECRET not configured'), { http: 500 });
  return stripe.webhooks.constructEvent(payload, signature, secret);
}

module.exports = {
  getStripe,
  getOrCreateCustomer,
  createSubscription,
  cancelSubscription,
  getBillingPortalUrl,
  constructWebhookEvent,
  PLAN_PRICE_IDS,
};
