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
const app = require('../../services/grooming/src/index');

const USER_HEADERS = {
  'x-user-id': '1',
  'x-org-id': '10',
  'x-branch-id': '5',
  'x-user-roles': 'org_admin',
  'x-user-email': 'admin@clinic.com',
};

describe('Contract - grooming catalogs', () => {
  it('exposes GET /grooming/groomers', async () => {
    db.query.mockResolvedValueOnce([
      { id: 1, name: 'Ana Lopez', email: 'ana@clinic.com', phone: '123', is_active: 1 },
    ]);

    const res = await request(app)
      .get('/grooming/groomers')
      .set(USER_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0].name).toBe('Ana Lopez');
  });

  it('exposes GET /grooming/service-types', async () => {
    db.query.mockResolvedValueOnce([
      { id: 1, name: 'Baño', is_active: 1 },
    ]);

    const res = await request(app)
      .get('/grooming/service-types')
      .set(USER_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0].name).toBe('Baño');
  });
});
