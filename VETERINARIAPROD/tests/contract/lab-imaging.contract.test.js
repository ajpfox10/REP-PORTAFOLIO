'use strict';

const request = require('supertest');

jest.mock('../../shared/db', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
  transaction: jest.fn(),
  callProc: jest.fn(),
  queryGrouped: jest.fn(),
  placeholders: jest.fn(arr => arr.map(() => '?').join(',')),
}));

jest.mock('../../shared/internalAuth', () => ({
  requireInternalSig: (_req, _res, next) => next(),
  signRequest: jest.fn(() => ''),
  verifySignature: jest.fn(() => ({ ok: true })),
  HEADER: 'x-internal-sig',
}));

jest.mock('redis', () => {
  const client = {
    connect: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    setEx: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    ping: jest.fn().mockResolvedValue('PONG'),
    quit: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    isReady: true,
  };
  return { createClient: jest.fn(() => client) };
});

const db = require('../../shared/db');
const app = require('../../services/lab-imaging/src/index');

const USER_HEADERS = {
  'x-user-id': '1',
  'x-org-id': '10',
  'x-branch-id': '5',
  'x-user-roles': 'org_admin',
  'x-user-email': 'admin@clinic.com',
};

describe('Contract - deworming alias', () => {
  it('maps GET /deworming to the deworming listing handler', async () => {
    db.query.mockResolvedValueOnce([
      { id: 1, product_name: 'Drontal', patient_name: 'Luna' },
    ]);

    const res = await request(app)
      .get('/deworming')
      .set(USER_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0].product_name).toBe('Drontal');
  });

  it('maps GET /deworming/products to the product catalog handler', async () => {
    db.query.mockResolvedValueOnce([
      { id: 1, name: 'Drontal', parasite_type: 'internal' },
    ]);

    const res = await request(app)
      .get('/deworming/products')
      .set(USER_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0].name).toBe('Drontal');
  });

  it('exposes GET /pathology/orders', async () => {
    db.query.mockResolvedValueOnce([
      { id: 10, order_number: 'PAT000010', status: 'pending', patient_name: 'Luna', pathology_type: 'Biopsia' },
    ]);

    const res = await request(app)
      .get('/pathology/orders')
      .set(USER_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0].order_number).toBe('PAT000010');
  });

  it('exposes GET /pathology/types', async () => {
    db.query.mockResolvedValueOnce([
      { id: 1, name: 'Biopsia', is_active: 1 },
    ]);

    const res = await request(app)
      .get('/pathology/types')
      .set(USER_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0].name).toBe('Biopsia');
  });
});
