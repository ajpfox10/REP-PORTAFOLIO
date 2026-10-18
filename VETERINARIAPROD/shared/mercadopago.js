'use strict';

/**
 * MercadoPago — cliente compartido + helpers.
 *
 * Variables de entorno requeridas:
 *   MP_ACCESS_TOKEN   — Access token de producción o sandbox
 *   MP_WEBHOOK_SECRET — Secret para validar notificaciones (configurado en el panel MP)
 *   APP_URL           — URL pública de la API (para back_urls y notification_url)
 *
 * Docs: https://www.mercadopago.com.ar/developers/es/docs
 */

const { MercadoPagoConfig, Preference, Payment, Refund, PreApproval } = require('mercadopago');
const crypto = require('crypto');
const { createLogger } = require('./logger');
const { CircuitBreaker } = require('./circuitBreaker');

const log = createLogger('mercadopago');

const mpBreaker = new CircuitBreaker('mercadopago', { threshold: 3, timeout: 60000 });

// ── Cliente ───────────────────────────────────────────────────────────────────
function getClient() {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) throw new Error('MP_ACCESS_TOKEN no configurado');
  return new MercadoPagoConfig({ accessToken: token, options: { timeout: 10000 } });
}

// ── Crear preferencia de pago (Checkout Pro) ──────────────────────────────────
/**
 * Genera un link de pago en MercadoPago para una factura.
 *
 * @param {object} opts
 * @param {number}   opts.invoiceId
 * @param {string}   opts.invoiceNumber
 * @param {number}   opts.amount          Monto total
 * @param {string}   opts.currency        'ARS' | 'USD'
 * @param {string}   opts.payerEmail
 * @param {string}   opts.payerName
 * @param {string}   opts.description     Descripción en la pantalla de pago
 * @param {number}   opts.orgId
 * @param {number}   opts.branchId
 * @returns {{ preferenceId, initPoint, sandboxInitPoint }}
 */
async function createPreference(opts) {
  if (!mpBreaker.canRequest()) throw Object.assign(new Error('MercadoPago circuit open'), { code: 'MP_CIRCUIT_OPEN' });
  const {
    invoiceId, invoiceNumber, amount, currency = 'ARS',
    payerEmail, payerName, description, orgId, branchId,
    idempotencyKey,
  } = opts;

  const appUrl = process.env.APP_URL || 'http://localhost:4050';
  const V      = process.env.API_VERSION || 'v1';

  const preference = new Preference(getClient());

  const idemKey = idempotencyKey || `inv-${invoiceId}-org-${orgId}`;

  let result;
  try {
    result = await preference.create({
    body: {
      items: [{
        id:           String(invoiceId),
        title:        description || `Factura ${invoiceNumber}`,
        quantity:     1,
        unit_price:   Number(amount),
        currency_id:  currency,
      }],
      payer: {
        email: payerEmail,
        name:  payerName,
      },
      external_reference: `inv:${invoiceId}:org:${orgId}:branch:${branchId}`,
      notification_url:   `${appUrl}/api/${V}/payments/mp/webhook`,
      back_urls: {
        success: `${process.env.FRONTEND_URL || appUrl}/payments/success`,
        failure: `${process.env.FRONTEND_URL || appUrl}/payments/failure`,
        pending: `${process.env.FRONTEND_URL || appUrl}/payments/pending`,
      },
      auto_return: 'approved',
      statement_descriptor: 'Andromeda',
      expires: true,
      expiration_date_to: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    },
    requestOptions: { idempotencyKey: idemKey },
  });
  } catch (err) {
    mpBreaker.onFailure();
    throw err;
  }
  mpBreaker.onSuccess();

  return {
    preferenceId:      result.id,
    initPoint:         result.init_point,
    sandboxInitPoint:  result.sandbox_init_point,
  };
}

// ── Obtener información de un pago ────────────────────────────────────────────
/**
 * @param {string|number} mpPaymentId  — ID de pago de MercadoPago
 */
async function getPayment(mpPaymentId) {
  if (!mpBreaker.canRequest()) throw Object.assign(new Error('MercadoPago circuit open'), { code: 'MP_CIRCUIT_OPEN' });
  const payment = new Payment(getClient());
  try {
    const result = await payment.get({ id: mpPaymentId });
    mpBreaker.onSuccess();
    return result;
  } catch (err) {
    mpBreaker.onFailure();
    throw err;
  }
}

// ── Reembolso ─────────────────────────────────────────────────────────────────
/**
 * @param {string|number} mpPaymentId
 * @param {number}        [amount]     Si no se pasa, reembolso total
 */
async function refundPayment(mpPaymentId, amount) {
  if (!mpBreaker.canRequest()) throw Object.assign(new Error('MercadoPago circuit open'), { code: 'MP_CIRCUIT_OPEN' });
  const refund = new Refund(getClient());
  try {
    const result = await refund.create({
      payment_id: mpPaymentId,
      body: amount ? { amount } : undefined,
    });
    mpBreaker.onSuccess();
    return result;
  } catch (err) {
    mpBreaker.onFailure();
    throw err;
  }
}

// ── Suscripciones (débito automático / preapproval) ──────────────────────────
async function withBreaker(fn) {
  if (!mpBreaker.canRequest()) throw Object.assign(new Error('MercadoPago circuit open'), { code: 'MP_CIRCUIT_OPEN' });
  try {
    const result = await fn();
    mpBreaker.onSuccess();
    return result;
  } catch (err) {
    mpBreaker.onFailure();
    throw err;
  }
}

/**
 * Crea una suscripción mensual sin plan asociado. MercadoPago devuelve un
 * `init_point` donde la persona autoriza el débito con su cuenta o tarjeta.
 *
 * @param {object} opts
 * @param {number} opts.orgId
 * @param {string} opts.plan             id del plan comercial
 * @param {string} opts.reason           texto que ve la persona al pagar
 * @param {number} opts.amount           monto mensual
 * @param {string} [opts.currency='ARS']
 * @param {string} opts.payerEmail
 * @param {string} opts.backUrl          a dónde vuelve después de autorizar
 * @returns {Promise<{ id: string, initPoint: string, status: string }>}
 */
async function createPreapproval(opts) {
  const { orgId, plan, reason, amount, currency = 'ARS', payerEmail, backUrl } = opts;
  const appUrl = process.env.APP_URL || 'http://localhost:4050';
  const V = process.env.API_VERSION || 'v1';
  const result = await withBreaker(() => new PreApproval(getClient()).create({
    body: {
      reason,
      external_reference: `org:${orgId}:plan:${plan}`,
      payer_email: payerEmail,
      back_url: backUrl,
      notification_url: `${appUrl}/api/${V}/subscription/mp/webhook`,
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: Number(amount),
        currency_id: currency,
      },
      status: 'pending',
    },
    requestOptions: { idempotencyKey: `sub-${orgId}-${plan}-${Date.now()}` },
  }));
  return { id: result.id, initPoint: result.init_point, status: result.status };
}

async function getPreapproval(preapprovalId) {
  return withBreaker(() => new PreApproval(getClient()).get({ id: preapprovalId }));
}

async function cancelPreapproval(preapprovalId) {
  return withBreaker(() => new PreApproval(getClient()).update({ id: preapprovalId, body: { status: 'cancelled' } }));
}

/**
 * Cobro de una cuota de suscripción (topic subscription_authorized_payment).
 * El SDK no expone este recurso, se consulta la API REST directamente.
 */
async function getAuthorizedPayment(authorizedPaymentId) {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) throw new Error('MP_ACCESS_TOKEN no configurado');
  const id = encodeURIComponent(String(authorizedPaymentId));
  return withBreaker(async () => {
    const res = await fetch(`https://api.mercadopago.com/authorized_payments/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw Object.assign(new Error(`MercadoPago authorized_payments ${res.status}`), { status: res.status });
    return res.json();
  });
}

/**
 * Estado de preapproval de MercadoPago → estado de suscripción interno.
 */
function mapPreapprovalStatus(mpStatus) {
  switch (mpStatus) {
    case 'authorized': return 'active';
    case 'paused':     return 'past_due';
    case 'cancelled':  return 'cancelled';
    default:           return null; // pending: todavía no autorizó
  }
}

function isConfigured() {
  return Boolean(process.env.MP_ACCESS_TOKEN);
}

// ── Validar firma de webhook ──────────────────────────────────────────────────
/**
 * MercadoPago envía x-signature con ts y hash.
 * Formato: ts=<timestamp>,v1=<hmac_sha256>
 *
 * @param {string} xSignature   — Header x-signature
 * @param {string} xRequestId   — Header x-request-id
 * @param {string} dataId       — query param ?data.id o body.data.id
 * @returns {boolean}
 */
function parseSignatureHeader(xSignature) {
  return Object.fromEntries(
    String(xSignature || '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [key, ...rest] = part.split('=');
        return [key, rest.join('=')];
      })
  );
}

function validateWebhookSignature(xSignature, xRequestId, dataId, opts = {}) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      log.error('MP_WEBHOOK_SECRET missing in production; rejecting webhook');
      return false;
    }
    return true; // dev/local only
  }

  try {
    const toleranceSec = parseInt(opts.toleranceSec || process.env.MP_WEBHOOK_TOLERANCE_SEC || '60', 10);
    const parts    = parseSignatureHeader(xSignature);
    const ts       = parts.ts;
    const received = parts.v1;
    if (!ts || !received || !xRequestId || !dataId) return false;

    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - Number(ts)) > toleranceSec) return false;

    const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
    const expectedBuf = crypto.createHmac('sha256', secret).update(manifest).digest();
    // SEC: convertir el hash recibido a Buffer de 32 bytes para comparación en tiempo constante.
    // No comparar .length de strings primero — haría early-exit y filtraría timing sobre longitud.
    // Si received no es hex válido de 64 chars, substituir por un buffer de ceros (falla segura).
    let receivedBuf;
    if (typeof received === 'string' && /^[a-f0-9]{64}$/i.test(received)) {
      receivedBuf = Buffer.from(received, 'hex');
    } else {
      receivedBuf = Buffer.alloc(32, 0);  // longitud fija, falla segura
    }
    return crypto.timingSafeEqual(expectedBuf, receivedBuf);
  } catch (err) {
    log.warn('MercadoPago webhook signature validation failed', { error: err.message });
    return false;
  }
}

// ── Mapear estado MP → estado interno ────────────────────────────────────────
function mapMpStatus(mpStatus) {
  switch (mpStatus) {
    case 'approved':      return 'completed';
    case 'pending':
    case 'in_process':   return 'pending';
    case 'rejected':     return 'failed';
    case 'refunded':
    case 'charged_back': return 'refunded';
    case 'cancelled':    return 'cancelled';
    default:             return 'pending';
  }
}

module.exports = {
  createPreference,
  getPayment,
  refundPayment,
  validateWebhookSignature,
  mapMpStatus,
  createPreapproval,
  getPreapproval,
  cancelPreapproval,
  getAuthorizedPayment,
  mapPreapprovalStatus,
  isConfigured,
};
