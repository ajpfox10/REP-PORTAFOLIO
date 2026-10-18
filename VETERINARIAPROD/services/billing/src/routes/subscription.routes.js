'use strict';

/**
 * Suscripción SaaS de la organización (cobro con MercadoPago preapproval).
 *
 *   GET  /subscription             estado, plan, prueba gratuita y consumo del mes
 *   POST /subscription/checkout    inicia la suscripción a un plan → init_point de MP
 *   POST /subscription/cancel      cancela la renovación (mantiene el período pago)
 *   POST /subscription/mp/webhook  notificaciones de MercadoPago (público, firmado)
 */

const { Router } = require('express');
const { body } = require('express-validator');
const { db, mp, validate, logBillingError } = require('./billing.common');
const R = require('../../../../shared/response');
const subscriptions = require('../../../../shared/subscriptions');
const usageLimits = require('../../../../shared/usageLimits');
const { createLogger } = require('../../../../shared/logger');

const log = createLogger('billing-subscription');

const ADMIN_ROLES = ['org_admin', 'superadmin'];
// Recursos que se muestran en la pantalla de consumo, en este orden.
const USAGE_FEATURES = ['pdf_reports', 'telemedicine', 'ai_diagnosis', 'ai_chatbot', 'sms_notifications', 'whatsapp_notify'];

function isDemoMode() {
  if (process.env.NODE_ENV === 'production') return false;
  return process.env.SUBSCRIPTION_DEMO_MODE !== 'false' && !mp.isConfigured();
}

function requireOrgAdmin(req, res, next) {
  if (!req.user?.orgId) return R.forbidden(res, 'Organización requerida');
  if (!(req.user.roles || []).some((role) => ADMIN_ROLES.includes(role))) {
    return R.forbidden(res, 'Solo un administrador de la organización puede gestionar la suscripción');
  }
  return next();
}

function addMonths(date, months) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

async function buildUsage(orgId) {
  const usage = await Promise.all(USAGE_FEATURES.map(async (feature) => {
    const { current, limit } = await usageLimits.checkLimit(orgId, feature).catch(() => ({ current: 0, limit: Infinity }));
    return { feature, current, limit: Number.isFinite(limit) ? limit : null };
  }));
  const storage = await usageLimits.checkStorageLimit(orgId).catch(() => ({ currentMb: 0, limitMb: Infinity }));
  usage.push({
    feature: 'storage_mb',
    current: Math.round(storage.currentMb),
    limit: Number.isFinite(storage.limitMb) ? storage.limitMb : null,
  });
  return usage;
}

async function countSeats(orgId) {
  const row = await db.queryOne(
    `SELECT
       (SELECT COUNT(*) FROM branches WHERE organization_id = :orgId AND is_active = 1) AS branches,
       (SELECT COUNT(*) FROM users u JOIN branches b ON b.id = u.branch_id
         WHERE b.organization_id = :orgId AND u.is_active = 1) AS users`,
    { orgId }
  );
  return { branches: Number(row?.branches || 0), users: Number(row?.users || 0) };
}

async function afterSubscriptionChange(orgId) {
  await usageLimits.invalidatePlanTier(orgId);
}

// ── Rutas autenticadas ───────────────────────────────────────────────────────
const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const orgId = req.user.orgId;
    const row = await subscriptions.getSubscription(orgId);
    const [usage, seats, events] = await Promise.all([
      buildUsage(orgId),
      countSeats(orgId),
      subscriptions.listEvents(orgId, 10),
    ]);
    return R.ok(res, {
      subscription: subscriptions.summarize(row),
      plans: subscriptions.listPlans(),
      trialDays: subscriptions.TRIAL_DAYS,
      usage,
      seats,
      events,
      checkout: { provider: 'mercadopago', configured: mp.isConfigured(), demoMode: isDemoMode() },
    });
  } catch (e) {
    logBillingError('GET /subscription', e, { orgId: req.user?.orgId });
    next(e);
  }
});

router.post('/checkout',
  requireOrgAdmin,
  body('plan').isIn(Object.keys(subscriptions.PLANS)),
  validate,
  async (req, res, next) => {
    try {
      const orgId = req.user.orgId;
      const plan = subscriptions.PLANS[req.body.plan];
      const row = await subscriptions.getSubscription(orgId);
      if (!row) return R.notFound(res, 'La organización no tiene una suscripción asociada');

      if (isDemoMode()) {
        const now = new Date();
        await subscriptions.applyProviderUpdate(orgId, {
          plan: plan.id,
          status: 'active',
          provider: 'demo',
          currentPeriodEnd: addMonths(now, 1),
          nextBillingDate: addMonths(now, 1),
          pendingPlan: null,
          cancelledAt: null,
        });
        await subscriptions.recordEvent({ orgId, provider: 'demo', eventType: 'subscription.activated', payload: { plan: plan.id } });
        await afterSubscriptionChange(orgId);
        return R.ok(res, { demo: true, status: 'active', plan: plan.id });
      }

      if (!mp.isConfigured()) {
        return R.error(res, 503, 'Los cobros con MercadoPago no están configurados', null, 'BILLING_PROVIDER_UNAVAILABLE');
      }

      const frontendUrl = process.env.FRONTEND_URL || process.env.APP_URL || 'http://localhost:5173';
      const preapproval = await mp.createPreapproval({
        orgId,
        plan: plan.id,
        reason: `VetManager Pro — Plan ${plan.name}`,
        amount: plan.monthlyPrice,
        currency: subscriptions.CURRENCY,
        payerEmail: row.billing_email || req.user.email,
        backUrl: `${frontendUrl}/suscripcion?resultado=mp`,
      });

      await subscriptions.applyProviderUpdate(orgId, {
        provider: 'mercadopago',
        mpPreapprovalId: String(preapproval.id),
        pendingPlan: plan.id,
      });
      await subscriptions.recordEvent({
        orgId,
        provider: 'mercadopago',
        providerEventId: `checkout:${preapproval.id}`,
        eventType: 'subscription.checkout_started',
        payload: { plan: plan.id, preapprovalId: preapproval.id },
      });

      return R.ok(res, { initPoint: preapproval.initPoint, preapprovalId: preapproval.id, plan: plan.id });
    } catch (e) {
      logBillingError('POST /subscription/checkout', e, { orgId: req.user?.orgId, plan: req.body?.plan });
      next(e);
    }
  }
);

router.post('/cancel', requireOrgAdmin, async (req, res, next) => {
  try {
    const orgId = req.user.orgId;
    const row = await subscriptions.getSubscription(orgId);
    if (!row) return R.notFound(res, 'La organización no tiene una suscripción asociada');
    if (!['active', 'past_due'].includes(row.status)) {
      return R.badRequest(res, 'No hay una suscripción activa para cancelar');
    }

    if (row.payment_provider === 'mercadopago' && row.mp_preapproval_id) {
      await mp.cancelPreapproval(row.mp_preapproval_id);
    }
    await subscriptions.applyProviderUpdate(orgId, {
      status: 'cancelled',
      cancelledAt: new Date(),
      // Sin fecha de fin conocida, el acceso pago se mantiene hasta fin de mes.
      currentPeriodEnd: row.current_period_end || addMonths(new Date(), 1),
    });
    await subscriptions.recordEvent({ orgId, provider: row.payment_provider || 'manual', eventType: 'subscription.cancelled' });
    await afterSubscriptionChange(orgId);
    return R.ok(res, { status: 'cancelled' });
  } catch (e) {
    logBillingError('POST /subscription/cancel', e, { orgId: req.user?.orgId });
    next(e);
  }
});

// ── Webhook de MercadoPago ───────────────────────────────────────────────────
function parseExternalReference(ref) {
  const match = String(ref || '').match(/^org:(\d+):plan:([a-z_]+)$/);
  if (!match) return null;
  return { orgId: Number(match[1]), plan: match[2] };
}

async function findSubscriptionForPreapproval(preapproval) {
  const ref = parseExternalReference(preapproval.external_reference);
  const row = await db.queryOne(
    'SELECT * FROM tenants WHERE mp_preapproval_id = :preapprovalId',
    { preapprovalId: String(preapproval.id) }
  );
  if (!row) return null;
  // La referencia externa la generamos nosotros: si no coincide con la fila, se ignora.
  if (ref && ref.orgId !== Number(row.org_id)) {
    log.warn('MP preapproval: external_reference no coincide con la organización', { preapprovalId: preapproval.id });
    return null;
  }
  return { row, plan: ref && subscriptions.isPaidPlan(ref.plan) ? ref.plan : row.pending_plan };
}

async function handlePreapproval(preapprovalId) {
  const preapproval = await mp.getPreapproval(preapprovalId);
  const match = await findSubscriptionForPreapproval(preapproval);
  if (!match) return;
  const orgId = Number(match.row.org_id);
  const status = mp.mapPreapprovalStatus(preapproval.status);
  if (!status) return;

  const { duplicate } = await subscriptions.recordEvent({
    orgId,
    provider: 'mercadopago',
    providerEventId: `preapproval:${preapproval.id}:${preapproval.status}:${preapproval.last_modified || ''}`,
    eventType: `subscription.${status}`,
    payload: { status: preapproval.status, nextPaymentDate: preapproval.next_payment_date || null },
  });
  if (duplicate) return;

  const update = { status };
  if (status === 'active') {
    update.plan = match.plan;
    update.pendingPlan = null;
    update.cancelledAt = null;
    if (preapproval.next_payment_date) {
      update.currentPeriodEnd = new Date(preapproval.next_payment_date);
      update.nextBillingDate = new Date(preapproval.next_payment_date);
    }
  }
  if (status === 'cancelled') update.cancelledAt = new Date();
  await subscriptions.applyProviderUpdate(orgId, update);
  await afterSubscriptionChange(orgId);
}

async function handleAuthorizedPayment(authorizedPaymentId) {
  const payment = await mp.getAuthorizedPayment(authorizedPaymentId);
  if (!payment?.preapproval_id) return;
  const preapproval = await mp.getPreapproval(payment.preapproval_id);
  const match = await findSubscriptionForPreapproval(preapproval);
  if (!match) return;
  const orgId = Number(match.row.org_id);
  const paymentStatus = payment.payment?.status || payment.status;

  const { duplicate } = await subscriptions.recordEvent({
    orgId,
    provider: 'mercadopago',
    providerEventId: `authorized_payment:${payment.id}:${paymentStatus}`,
    eventType: paymentStatus === 'approved' ? 'subscription.payment_approved' : 'subscription.payment_failed',
    payload: { amount: payment.transaction_amount, status: paymentStatus },
  });
  if (duplicate) return;

  if (paymentStatus === 'approved') {
    await subscriptions.applyProviderUpdate(orgId, {
      status: 'active',
      plan: match.plan,
      pendingPlan: null,
      ...(preapproval.next_payment_date ? {
        currentPeriodEnd: new Date(preapproval.next_payment_date),
        nextBillingDate: new Date(preapproval.next_payment_date),
      } : {}),
    });
  } else if (paymentStatus === 'rejected') {
    await subscriptions.applyProviderUpdate(orgId, { status: 'past_due' });
  }
  await afterSubscriptionChange(orgId);
}

const webhookRouter = Router();

webhookRouter.post('/', async (req, res, next) => {
  try {
    const xSig = req.headers['x-signature'] || '';
    const xReqId = req.headers['x-request-id'] || '';
    const dataId = req.query['data.id'] || req.body?.data?.id || '';
    if (!mp.validateWebhookSignature(xSig, xReqId, dataId)) {
      return R.error(res, 401, 'Firma inválida', null, 'AUTH_012');
    }

    const type = req.body?.type || req.query?.type || req.query?.topic;
    if (!dataId) return res.status(200).json({ received: true });

    if (type === 'subscription_preapproval') await handlePreapproval(dataId);
    else if (type === 'subscription_authorized_payment') await handleAuthorizedPayment(dataId);

    return res.status(200).json({ received: true });
  } catch (e) {
    logBillingError('POST /subscription/mp/webhook', e, { type: req.body?.type });
    next(e);
  }
});

module.exports = {
  subscriptionRouter: router,
  subscriptionWebhookRouter: webhookRouter,
  _private: { parseExternalReference, isDemoMode },
};
