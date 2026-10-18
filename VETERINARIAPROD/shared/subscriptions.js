'use strict';

/**
 * Subscriptions — plan comercial de cada organización (modelo SaaS).
 *
 * La suscripción vive en la tabla `tenants` (una fila por organización):
 *   plan        — 'basic' | 'pro' | 'enterprise'
 *   status      — 'trialing' | 'active' | 'past_due' | 'cancelled' | 'expired'
 *   trial_ends_at, current_period_end, payment_provider, mp_preapproval_id...
 *
 * El "tier efectivo" es el que aplican los límites de uso (shared/usageLimits):
 *   - prueba vigente            → TRIAL_TIER (pro)
 *   - activa / pago atrasado    → el plan contratado (con días de gracia)
 *   - cancelada con período pago→ el plan hasta current_period_end
 *   - prueba vencida / expirada → 'free'
 *   - organización sin fila     → DEFAULT_PLAN_TIER (compatibilidad con orgs previas al SaaS)
 */

const db = require('./db');

const TRIAL_DAYS = parseInt(process.env.TRIAL_DAYS || '14', 10);
const TRIAL_TIER = 'pro';
const PAST_DUE_GRACE_DAYS = parseInt(process.env.SUBSCRIPTION_GRACE_DAYS || '5', 10);
const LEGACY_TIER = process.env.DEFAULT_PLAN_TIER || 'free';
const CURRENCY = process.env.PLAN_CURRENCY || 'ARS';

const STATUSES = ['trialing', 'active', 'past_due', 'cancelled', 'expired'];

function price(envVar, fallback) {
  const value = Number(process.env[envVar]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

// Catálogo comercial. Los montos se pueden ajustar por entorno sin tocar código.
const PLANS = {
  basic: {
    id: 'basic',
    name: 'Esencial',
    description: 'Para consultorios con un equipo chico.',
    monthlyPrice: price('PLAN_PRICE_BASIC', 29900),
    highlights: [
      '1 sucursal y hasta 3 usuarios',
      'Turnos, historia clínica y vacunas',
      'Facturación y cobros con MercadoPago',
      'Reportes esenciales',
    ],
    limits: { branches: 1, users: 3 },
  },
  pro: {
    id: 'pro',
    name: 'Profesional',
    description: 'Para clínicas con varias áreas y equipo completo.',
    monthlyPrice: price('PLAN_PRICE_PRO', 59900),
    highlights: [
      'Hasta 3 sucursales y 15 usuarios',
      'Laboratorio, imágenes, cirugías e internación',
      'Telemedicina y portal para dueños',
      'Reportes avanzados y envíos programados',
      'Asistente de IA',
    ],
    limits: { branches: 3, users: 15 },
    recommended: true,
  },
  enterprise: {
    id: 'enterprise',
    name: 'Red de clínicas',
    description: 'Para redes y hospitales veterinarios.',
    monthlyPrice: price('PLAN_PRICE_ENTERPRISE', 119900),
    highlights: [
      'Sucursales y usuarios ilimitados',
      'Inventario y transferencias entre sucursales',
      'SSO, auditoría exportable y API',
      'Soporte prioritario',
    ],
    limits: { branches: null, users: null },
  },
};

// Cupos por tier efectivo (null = sin límite). La prueba usa los del plan Profesional.
const SEAT_LIMITS = {
  free: { branches: 1, users: 2 },
  basic: { branches: PLANS.basic.limits.branches, users: PLANS.basic.limits.users },
  pro: { branches: PLANS.pro.limits.branches, users: PLANS.pro.limits.users },
  enterprise: { branches: null, users: null },
};

function isPaidPlan(plan) {
  return Object.prototype.hasOwnProperty.call(PLANS, plan);
}

function listPlans() {
  return Object.values(PLANS).map((plan) => ({ ...plan, currency: CURRENCY }));
}

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Calcula el tier efectivo a partir de la fila de `tenants`.
 * @param {object|null} row
 * @param {Date} [now]
 * @returns {string} tier de shared/usageLimits.PLAN_LIMITS
 */
function effectiveTier(row, now = new Date()) {
  if (!row) return LEGACY_TIER;
  const plan = isPaidPlan(row.plan) ? row.plan : null;
  const trialEnds = toDate(row.trial_ends_at);
  const periodEnd = toDate(row.current_period_end);

  switch (row.status) {
    case 'trialing':
      return trialEnds && trialEnds > now ? TRIAL_TIER : 'free';
    case 'active':
      return plan || 'free';
    case 'past_due':
      if (!plan) return 'free';
      if (!periodEnd) return plan;
      return addDays(periodEnd, PAST_DUE_GRACE_DAYS) > now ? plan : 'free';
    case 'cancelled':
      return plan && periodEnd && periodEnd > now ? plan : 'free';
    default:
      return 'free';
  }
}

/**
 * Resumen de la suscripción para la API / la UI.
 */
function summarize(row, now = new Date()) {
  if (!row) {
    return {
      plan: null,
      status: 'legacy',
      effectiveTier: LEGACY_TIER,
      trialEndsAt: null,
      trialDaysLeft: 0,
      currentPeriodEnd: null,
      provider: null,
      pendingPlan: null,
      billingEmail: null,
    };
  }
  const trialEnds = toDate(row.trial_ends_at);
  const msLeft = trialEnds ? trialEnds.getTime() - now.getTime() : 0;
  const status = row.status === 'trialing' && trialEnds && trialEnds <= now ? 'expired' : row.status;
  return {
    plan: row.plan || null,
    status,
    effectiveTier: effectiveTier(row, now),
    trialEndsAt: trialEnds ? trialEnds.toISOString() : null,
    trialDaysLeft: row.status === 'trialing' && msLeft > 0 ? Math.ceil(msLeft / (24 * 60 * 60 * 1000)) : 0,
    currentPeriodEnd: toDate(row.current_period_end)?.toISOString() || null,
    provider: row.payment_provider || null,
    pendingPlan: row.pending_plan || null,
    billingEmail: row.billing_email || null,
  };
}

async function getSubscription(orgId, conn = db) {
  if (!orgId) return null;
  return conn.queryOne('SELECT * FROM tenants WHERE org_id = :orgId', { orgId });
}

/**
 * Crea la suscripción en período de prueba para una organización nueva.
 */
async function startTrial(conn, { orgId, subdomain, billingEmail, now = new Date() }) {
  // DATETIME redondea los milisegundos: se truncan antes para que la prueba dure
  // exactamente TRIAL_DAYS y el contador no muestre un día de más.
  const trialEndsAt = addDays(new Date(Math.floor(now.getTime() / 1000) * 1000), TRIAL_DAYS);
  await conn.query(
    `INSERT INTO tenants (org_id, plan, status, subdomain, billing_email, trial_ends_at)
     VALUES (:orgId, :plan, 'trialing', :subdomain, :billingEmail, :trialEndsAt)`,
    { orgId, plan: TRIAL_TIER, subdomain, billingEmail: billingEmail || null, trialEndsAt }
  );
  return { plan: TRIAL_TIER, status: 'trialing', trialEndsAt };
}

/**
 * Registra el resultado de un cobro/autorización del proveedor de pagos.
 */
async function applyProviderUpdate(orgId, update, conn = db) {
  const fields = [];
  const params = { orgId };
  const allowed = {
    plan: 'plan',
    status: 'status',
    currentPeriodEnd: 'current_period_end',
    nextBillingDate: 'next_billing_date',
    provider: 'payment_provider',
    mpPreapprovalId: 'mp_preapproval_id',
    pendingPlan: 'pending_plan',
    billingEmail: 'billing_email',
    cancelledAt: 'cancelled_at',
  };
  for (const [key, column] of Object.entries(allowed)) {
    if (update[key] === undefined) continue;
    if (key === 'status' && !STATUSES.includes(update.status)) {
      throw Object.assign(new Error(`Estado de suscripción inválido: ${update.status}`), { code: 'SUBSCRIPTION_STATUS_INVALID' });
    }
    if (key === 'plan' && update.plan !== null && !isPaidPlan(update.plan)) {
      throw Object.assign(new Error(`Plan inválido: ${update.plan}`), { code: 'SUBSCRIPTION_PLAN_INVALID' });
    }
    fields.push(`${column} = :${key}`);
    params[key] = update[key];
  }
  if (!fields.length) return;
  await conn.query(`UPDATE tenants SET ${fields.join(', ')} WHERE org_id = :orgId`, params);
}

async function recordEvent({ orgId, provider, providerEventId, eventType, payload }, conn = db) {
  const [result] = await conn.query(
    `INSERT IGNORE INTO subscription_events (org_id, provider, provider_event_id, event_type, payload)
     VALUES (:orgId, :provider, :providerEventId, :eventType, :payload)`,
    {
      orgId: orgId || null,
      provider,
      providerEventId: providerEventId || null,
      eventType,
      payload: payload ? JSON.stringify(payload) : null,
    }
  );
  return { duplicate: providerEventId ? result?.affectedRows === 0 : false };
}

/**
 * Verifica si la organización puede sumar una sucursal o un usuario más.
 * Las organizaciones previas al SaaS (sin fila en tenants) no tienen cupo.
 * @param {number} orgId
 * @param {'branches'|'users'} resource
 * @returns {Promise<{ allowed: boolean, limit: number|null, current: number, tier: string }>}
 */
async function checkSeatLimit(orgId, resource, conn = db) {
  const row = await getSubscription(orgId, conn);
  const tier = effectiveTier(row);
  const limit = row ? (SEAT_LIMITS[tier] || SEAT_LIMITS.free)[resource] : null;
  if (limit === null || limit === undefined) return { allowed: true, limit: null, current: 0, tier };

  const counted = resource === 'branches'
    ? await conn.queryOne(
      'SELECT COUNT(*) AS total FROM branches WHERE organization_id = :orgId AND is_active = 1',
      { orgId }
    )
    : await conn.queryOne(
      `SELECT COUNT(*) AS total FROM users u JOIN branches b ON b.id = u.branch_id
        WHERE b.organization_id = :orgId AND u.is_active = 1`,
      { orgId }
    );
  const current = Number(counted?.total || 0);
  return { allowed: current < limit, limit, current, tier };
}

function seatLimitMessage(resource, check) {
  const singular = check.limit === 1;
  const what = resource === 'branches'
    ? (singular ? 'sucursal' : 'sucursales')
    : (singular ? 'usuario activo' : 'usuarios activos');
  return `Tu plan permite hasta ${check.limit} ${what}. Pasá a un plan superior desde Suscripción para sumar más.`;
}

async function listEvents(orgId, limit = 20) {
  return db.query(
    `SELECT id, provider, event_type, created_at
       FROM subscription_events
      WHERE org_id = :orgId
      ORDER BY created_at DESC, id DESC
      LIMIT ${Math.max(1, Math.min(100, Number(limit) || 20))}`,
    { orgId }
  );
}

module.exports = {
  PLANS,
  STATUSES,
  TRIAL_DAYS,
  TRIAL_TIER,
  CURRENCY,
  isPaidPlan,
  listPlans,
  effectiveTier,
  summarize,
  getSubscription,
  checkSeatLimit,
  seatLimitMessage,
  SEAT_LIMITS,
  startTrial,
  applyProviderUpdate,
  recordEvent,
  listEvents,
};
