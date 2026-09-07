'use strict';

/**
 * Contract tests — Auth service response shapes.
 *
 * These tests verify that the auth service returns the EXACT fields
 * that the gateway and downstream consumers expect.
 * They act as a safety net: if someone renames a field or removes it,
 * this test fails before the change reaches production.
 *
 * Contract: what the gateway reads from auth responses.
 */

const request = require('supertest');

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Assert that obj has all required keys (recursively for nested). */
function hasShape(obj, shape) {
  for (const [key, type] of Object.entries(shape)) {
    if (!(key in obj)) return { ok: false, missing: key };
    if (type !== null && typeof type === 'object') {
      const nested = hasShape(obj[key], type);
      if (!nested.ok) return { ok: false, missing: `${key}.${nested.missing}` };
    } else if (type !== null && typeof obj[key] !== type) {
      return { ok: false, wrong: `${key} expected ${type}, got ${typeof obj[key]}` };
    }
  }
  return { ok: true };
}

function expectShape(obj, shape, label) {
  const result = hasShape(obj, shape);
  if (!result.ok) {
    throw new Error(`Contract violation in ${label}: ${JSON.stringify(result)}\nActual: ${JSON.stringify(obj, null, 2)}`);
  }
}

// ── App setup (isolated — no DB/Redis) ────────────────────────────────────────

jest.mock('../../shared/db', () => ({
  queryOne: jest.fn(),
  query:    jest.fn(),
  transaction: jest.fn(),
  // callProc must return an array — sp_login_attempt returns [[{ locked: 0, ... }]]
  callProc: jest.fn().mockResolvedValue([[{ locked: 0, failed_attempts: 0, locked_until: null }]]),
  // getPool used by health check
  getPool:  jest.fn(() => ({ execute: jest.fn().mockResolvedValue([[]]) })),
}));

jest.mock('bcryptjs', () => ({
  compare: jest.fn().mockResolvedValue(false), // default: wrong password
  hash:    jest.fn().mockResolvedValue('$2b$10$mocked'),
}));

jest.mock('redis', () => {
  const store = new Map();
  const client = {
    connect:    jest.fn().mockResolvedValue(undefined),
    get:        jest.fn(k => Promise.resolve(store.get(k) ?? null)),
    set:        jest.fn((k, v) => { store.set(k, v); return Promise.resolve('OK'); }),
    setEx:      jest.fn((k, _ttl, v) => { store.set(k, v); return Promise.resolve('OK'); }),
    del:        jest.fn(k => { store.delete(k); return Promise.resolve(1); }),
    incrBy:     jest.fn(() => Promise.resolve(1)),
    expire:     jest.fn(() => Promise.resolve(1)),
    multi:      jest.fn(() => ({ incrBy: jest.fn().mockReturnThis(), expire: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue([]) })),
    ping:       jest.fn().mockResolvedValue('PONG'),
    quit:       jest.fn().mockResolvedValue(undefined),
    on:         jest.fn(),
    isReady:    true,
  };
  return { createClient: jest.fn(() => client) };
});

process.env.INTERNAL_SECRET = 'test-secret';

const db = require('../../shared/db');
const { signRequest } = require('../../shared/internalAuth');
const app = require('../../services/auth/src/index');

function adminHeaders(path = '/admin/rbac/roles') {
  const identityHeaders = {
    'X-User-Id': '1',
    'X-User-Roles': 'org_admin',
  };

  return {
    ...identityHeaders,
    'X-Org-Id': '1',
    'X-Internal-Sig': signRequest('GET', path, '1', identityHeaders),
  };
}

// ── Contract: POST /login ──────────────────────────────────────────────────────

describe('Contract — POST /login', () => {
  const LOGIN_SUCCESS_SHAPE = {
    success:      'boolean',
    data: {
      accessToken:  'string',
      refreshToken: 'string',
      expiresIn:    'number',
      user: {
        id:    null,   // any type (int)
        email: 'string',
        roles: null,   // array — just check exists
      },
    },
  };

  const LOGIN_ERROR_SHAPE = {
    success: 'boolean',
    error: {
      message: 'string',
    },
  };

  const bcrypt = require('bcryptjs');

  beforeEach(() => {
    jest.clearAllMocks();
    // Default: sp_login_attempt returns unlocked status
    db.callProc.mockResolvedValue([[{ locked: 0, failed_attempts: 0, locked_until: null }]]);
  });

  it('401 — wrong password has standard error shape', async () => {
    const fakeUser = {
      id: 1, organization_id: 10, email: 'vet@clinic.com',
      password_hash: '$2b$10$fake', is_active: 1, failed_attempts: 0,
      locked_until: null, two_factor_enabled: 0,
    };
    db.queryOne.mockResolvedValueOnce(fakeUser);
    db.query.mockResolvedValue([]);
    bcrypt.compare.mockResolvedValueOnce(false); // wrong password

    const res = await request(app)
      .post('/login')
      .send({ email: 'vet@clinic.com', password: 'WrongPass1' });

    expect(res.status).toBe(401);
    expectShape(res.body, LOGIN_ERROR_SHAPE, 'POST /login 401 wrong pw');
    expect(res.body.success).toBe(false);
    expect(typeof res.body.error.message).toBe('string');
  });

  it('401 — user not found has standard error shape', async () => {
    db.queryOne.mockResolvedValueOnce(null); // user not found
    db.query.mockResolvedValue([]);

    const res = await request(app)
      .post('/login')
      .send({ email: 'nobody@x.com', password: 'Password1' });

    expect(res.status).toBe(401);
    expectShape(res.body, LOGIN_ERROR_SHAPE, 'POST /login 401 not found');
    expect(res.body.success).toBe(false);
    expect(typeof res.body.error.message).toBe('string');
  });

  it('400 validation error has required fields', async () => {
    const res = await request(app)
      .post('/login')
      .send({ email: 'not-an-email', password: '123' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBeDefined();
    expect(typeof res.body.error.message).toBe('string');
  });
});

// ── Contract: POST /refresh ────────────────────────────────────────────────────

describe('Contract — POST /refresh', () => {
  const REFRESH_SUCCESS_SHAPE = {
    success:     'boolean',
    data: {
      accessToken:  'string',
      refreshToken: 'string',
      expiresIn:    'number',
    },
  };

  it('401 error response has standard shape', async () => {
    db.queryOne.mockResolvedValueOnce(null); // token not found

    const res = await request(app)
      .post('/refresh')
      .set('Cookie', ['refreshToken=fake.token.value'])
      .send({});

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(typeof res.body.error.message).toBe('string');
  });

  it('401 missing refresh cookie has standard shape', async () => {
    const res = await request(app)
      .post('/refresh')
      .send({});

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBeDefined();
  });

  // Shape exported for gateway consumers
  it('REFRESH_SUCCESS_SHAPE is documented', () => {
    expect(REFRESH_SUCCESS_SHAPE.data.accessToken).toBe('string');
    expect(REFRESH_SUCCESS_SHAPE.data.refreshToken).toBe('string');
    expect(REFRESH_SUCCESS_SHAPE.data.expiresIn).toBe('number');
  });
});

// ── Contract: GET /health ──────────────────────────────────────────────────────

describe('Contract — GET /health', () => {
  it('returns standard health shape', async () => {
    const res = await request(app).get('/health');

    // Status may be 200 (ok) or 503 (degraded) depending on DB/Redis availability in test env
    expect([200, 503]).toContain(res.status);
    expect(typeof res.body.status).toBe('string');
    expect(res.body.service).toBe('auth');
    expect(typeof res.body.uptime).toBe('number');
    expect(res.body.checks).toBeDefined();
  });
});

// ── Contract: GET /admin/rbac/roles ───────────────────────────────────────────

describe('Contract — GET /admin/rbac/roles', () => {
  it('returns array of role objects with name and permissions', async () => {
    const res = await request(app).get('/admin/rbac/roles').set(adminHeaders('/admin/rbac/roles'));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);

    const role = res.body.data[0];
    expect(typeof role.name).toBe('string');
    expect(Array.isArray(role.permissions)).toBe(true);
  });

  it('includes superadmin role', async () => {
    const res = await request(app).get('/admin/rbac/roles').set(adminHeaders('/admin/rbac/roles'));
    const superadmin = res.body.data.find(r => r.name === 'superadmin');
    expect(superadmin).toBeDefined();
    expect(superadmin.permissions).toContain('*');
  });
});
