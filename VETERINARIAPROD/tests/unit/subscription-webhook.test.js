'use strict';

const express = require('express');
const request = require('supertest');

const mockMp = {
  validateWebhookSignature: jest.fn(() => true),
  getPreapproval: jest.fn(),
  getAuthorizedPayment: jest.fn(),
  mapPreapprovalStatus: jest.requireActual('../../shared/mercadopago').mapPreapprovalStatus,
  isConfigured: jest.fn(() => true),
};
const mockDb = { query: jest.fn(), queryOne: jest.fn() };

jest.mock('../../services/billing/src/routes/billing.common', () => ({
  db: mockDb,
  mp: mockMp,
  validate: (_req, _res, next) => next(),
  logBillingError: jest.fn(),
}));
jest.mock('../../shared/db', () => mockDb);
jest.mock('../../shared/usageLimits', () => ({
  invalidatePlanTier: jest.fn().mockResolvedValue(undefined),
  checkLimit: jest.fn(),
  checkStorageLimit: jest.fn(),
}));

const usageLimits = require('../../shared/usageLimits');
const { subscriptionWebhookRouter, _private } = require('../../services/billing/src/routes/subscription.routes');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/webhook', subscriptionWebhookRouter);
  return a;
}

const TENANT = { org_id: 42, mp_preapproval_id: 'pre-1', pending_plan: 'pro', plan: 'pro', status: 'trialing' };

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.query.mockReset();
  mockDb.queryOne.mockReset();
  mockMp.validateWebhookSignature.mockReturnValue(true);
});

describe('subscription webhook (MercadoPago)', () => {
  test('rechaza notificaciones con firma inválida', async () => {
    mockMp.validateWebhookSignature.mockReturnValue(false);
    const res = await request(app()).post('/webhook').send({ type: 'subscription_preapproval', data: { id: 'pre-1' } });
    expect(res.status).toBe(401);
    expect(mockMp.getPreapproval).not.toHaveBeenCalled();
  });

  test('activa el plan cuando la persona autoriza el débito', async () => {
    mockMp.getPreapproval.mockResolvedValue({
      id: 'pre-1', status: 'authorized', external_reference: 'org:42:plan:pro', next_payment_date: '2026-11-18T00:00:00Z',
    });
    mockDb.queryOne.mockResolvedValue(TENANT);
    mockDb.query
      .mockResolvedValueOnce([{ affectedRows: 1 }])   // subscription_events
      .mockResolvedValueOnce([{ affectedRows: 1 }]);  // UPDATE tenants

    const res = await request(app()).post('/webhook').send({ type: 'subscription_preapproval', data: { id: 'pre-1' } });

    expect(res.status).toBe(200);
    const [sql, params] = mockDb.query.mock.calls[1];
    expect(sql).toMatch(/^UPDATE tenants SET plan = :plan, status = :status/);
    expect(params).toMatchObject({ orgId: 42, plan: 'pro', status: 'active', pendingPlan: null });
    expect(usageLimits.invalidatePlanTier).toHaveBeenCalledWith(42);
  });

  test('ignora eventos duplicados', async () => {
    mockMp.getPreapproval.mockResolvedValue({ id: 'pre-1', status: 'authorized', external_reference: 'org:42:plan:pro' });
    mockDb.queryOne.mockResolvedValue(TENANT);
    mockDb.query.mockResolvedValueOnce([{ affectedRows: 0 }]); // evento ya registrado

    await request(app()).post('/webhook').send({ type: 'subscription_preapproval', data: { id: 'pre-1' } });

    expect(mockDb.query).toHaveBeenCalledTimes(1);
    expect(usageLimits.invalidatePlanTier).not.toHaveBeenCalled();
  });

  test('no toca nada si la referencia externa apunta a otra organización', async () => {
    mockMp.getPreapproval.mockResolvedValue({ id: 'pre-1', status: 'authorized', external_reference: 'org:7:plan:enterprise' });
    mockDb.queryOne.mockResolvedValue(TENANT);

    await request(app()).post('/webhook').send({ type: 'subscription_preapproval', data: { id: 'pre-1' } });

    expect(mockDb.query).not.toHaveBeenCalled();
  });

  test('un cobro rechazado deja la suscripción con pago atrasado', async () => {
    mockMp.getAuthorizedPayment.mockResolvedValue({ id: 99, preapproval_id: 'pre-1', payment: { status: 'rejected' } });
    mockMp.getPreapproval.mockResolvedValue({ id: 'pre-1', status: 'authorized', external_reference: 'org:42:plan:pro' });
    mockDb.queryOne.mockResolvedValue({ ...TENANT, status: 'active' });
    mockDb.query.mockResolvedValue([{ affectedRows: 1 }]);

    await request(app()).post('/webhook').send({ type: 'subscription_authorized_payment', data: { id: '99' } });

    const [sql, params] = mockDb.query.mock.calls[1];
    expect(sql).toBe('UPDATE tenants SET status = :status WHERE org_id = :orgId');
    expect(params).toEqual({ orgId: 42, status: 'past_due' });
  });
});

describe('subscription helpers', () => {
  test('parsea solo referencias externas generadas por la app', () => {
    expect(_private.parseExternalReference('org:12:plan:basic')).toEqual({ orgId: 12, plan: 'basic' });
    expect(_private.parseExternalReference('inv:12:org:3')).toBeNull();
    expect(_private.parseExternalReference('org:12:plan:basic; DROP TABLE')).toBeNull();
  });

  test('el modo demo nunca se activa en producción', () => {
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    mockMp.isConfigured.mockReturnValue(false);
    expect(_private.isDemoMode()).toBe(false);
    process.env.NODE_ENV = env;
  });
});
