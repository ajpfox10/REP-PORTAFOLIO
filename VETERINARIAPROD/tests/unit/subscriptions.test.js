'use strict';

jest.mock('../../shared/db', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
}));

const db = require('../../shared/db');
const subscriptions = require('../../shared/subscriptions');

const NOW = new Date('2026-10-18T12:00:00Z');
const days = (n) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000);

describe('subscriptions.effectiveTier', () => {
  test('organización sin suscripción conserva el tier por defecto (orgs previas al SaaS)', () => {
    expect(subscriptions.effectiveTier(null, NOW)).toBe(process.env.DEFAULT_PLAN_TIER || 'free');
  });

  test('prueba vigente usa el tier de prueba', () => {
    expect(subscriptions.effectiveTier({ status: 'trialing', plan: 'pro', trial_ends_at: days(3) }, NOW)).toBe('pro');
  });

  test('prueba vencida baja a free', () => {
    expect(subscriptions.effectiveTier({ status: 'trialing', plan: 'pro', trial_ends_at: days(-1) }, NOW)).toBe('free');
  });

  test('suscripción activa usa el plan contratado', () => {
    expect(subscriptions.effectiveTier({ status: 'active', plan: 'basic' }, NOW)).toBe('basic');
  });

  test('pago atrasado mantiene el plan durante los días de gracia', () => {
    const row = { status: 'past_due', plan: 'enterprise', current_period_end: days(-2) };
    expect(subscriptions.effectiveTier(row, NOW)).toBe('enterprise');
  });

  test('pago atrasado fuera de la gracia baja a free', () => {
    const row = { status: 'past_due', plan: 'enterprise', current_period_end: days(-30) };
    expect(subscriptions.effectiveTier(row, NOW)).toBe('free');
  });

  test('cancelada conserva el plan hasta el fin del período pago', () => {
    expect(subscriptions.effectiveTier({ status: 'cancelled', plan: 'pro', current_period_end: days(10) }, NOW)).toBe('pro');
    expect(subscriptions.effectiveTier({ status: 'cancelled', plan: 'pro', current_period_end: days(-1) }, NOW)).toBe('free');
  });

  test('plan desconocido nunca otorga un tier pago', () => {
    expect(subscriptions.effectiveTier({ status: 'active', plan: 'superadmin' }, NOW)).toBe('free');
  });
});

describe('subscriptions.summarize', () => {
  test('calcula los días de prueba restantes', () => {
    const summary = subscriptions.summarize({ status: 'trialing', plan: 'pro', trial_ends_at: days(4.5) }, NOW);
    expect(summary).toMatchObject({ status: 'trialing', effectiveTier: 'pro', trialDaysLeft: 5 });
  });

  test('marca como expirada una prueba vencida', () => {
    const summary = subscriptions.summarize({ status: 'trialing', plan: 'pro', trial_ends_at: days(-1) }, NOW);
    expect(summary).toMatchObject({ status: 'expired', effectiveTier: 'free', trialDaysLeft: 0 });
  });
});

describe('subscriptions.startTrial', () => {
  test('la prueba dura exactamente TRIAL_DAYS, sin milisegundos que redondeen a un día más', async () => {
    const conn = { query: jest.fn().mockResolvedValue([{ insertId: 1 }]) };
    const now = new Date('2026-10-18T21:54:11.640Z');
    const { trialEndsAt } = await subscriptions.startTrial(conn, { orgId: 5, subdomain: 'demo', now });
    expect(trialEndsAt.toISOString()).toBe('2026-11-01T21:54:11.000Z');
    expect(subscriptions.summarize({ status: 'trialing', trial_ends_at: trialEndsAt }, now).trialDaysLeft).toBe(14);
  });
});

describe('subscriptions.applyProviderUpdate', () => {
  beforeEach(() => jest.clearAllMocks());

  test('actualiza solo columnas permitidas', async () => {
    db.query.mockResolvedValue([{ affectedRows: 1 }]);
    await subscriptions.applyProviderUpdate(7, { plan: 'pro', status: 'active', provider: 'mercadopago', evil: 'x' });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toBe('UPDATE tenants SET plan = :plan, status = :status, payment_provider = :provider WHERE org_id = :orgId');
    expect(params).toEqual({ orgId: 7, plan: 'pro', status: 'active', provider: 'mercadopago' });
  });

  test('rechaza estados y planes inválidos', async () => {
    await expect(subscriptions.applyProviderUpdate(7, { status: 'hacked' })).rejects.toMatchObject({ code: 'SUBSCRIPTION_STATUS_INVALID' });
    await expect(subscriptions.applyProviderUpdate(7, { plan: 'free_forever' })).rejects.toMatchObject({ code: 'SUBSCRIPTION_PLAN_INVALID' });
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('subscriptions.recordEvent', () => {
  test('detecta eventos duplicados del proveedor', async () => {
    db.query.mockResolvedValueOnce([{ affectedRows: 0 }]);
    await expect(subscriptions.recordEvent({ orgId: 1, provider: 'mercadopago', providerEventId: 'evt-1', eventType: 'x' }))
      .resolves.toEqual({ duplicate: true });
  });
});
