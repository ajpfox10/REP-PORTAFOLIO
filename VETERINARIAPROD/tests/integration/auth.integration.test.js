'use strict';

/**
 * Integration tests — Auth service
 *
 * Spins up the auth Express app in-process and drives it via supertest.
 * All external dependencies (DB, Redis) are mocked at module level.
 *
 * Coverage:
 *   - POST /login  — success, bad credentials, locked account (brute-force)
 *   - POST /refresh — token rotation, reuse detection
 *   - POST /logout
 */

jest.mock('../../shared/db', () => ({
  query:       jest.fn(),
  queryOne:    jest.fn(),
  callProc:    jest.fn(),
  transaction: jest.fn(),
  getPool:     jest.fn(() => ({ execute: jest.fn().mockResolvedValue([[]]) })),
}));
jest.mock('../../shared/twoFactor', () => ({
  setupTwoFactor:       jest.fn(),
  verifyTwoFactor:      jest.fn(),
  generateRecoveryCodes: jest.fn(() => []),
}));
jest.mock('../../shared/email', () => ({
  send2faEnabled:    jest.fn(),
  sendPasswordReset: jest.fn(),
  sendNewDeviceLogin: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('redis', () => {
  const store = new Map();
  const ttlStore = new Map();

  const client = {
    isReady:    true,
    connect:    jest.fn().mockResolvedValue(undefined),
    on:         jest.fn(),
    get:        jest.fn(async (k)       => store.get(k) ?? null),
    set:        jest.fn(async (k, v)    => { store.set(k, v); return 'OK'; }),
    setEx:      jest.fn(async (k, t, v) => { store.set(k, v); ttlStore.set(k, t); return 'OK'; }),
    del:        jest.fn(async (k)       => { store.delete(k); return 1; }),
    incr:       jest.fn(async (k)       => { const n = (parseInt(store.get(k) || 0)) + 1; store.set(k, String(n)); return n; }),
    incrBy:     jest.fn(async (k, a)    => { const n = (parseInt(store.get(k) || 0)) + a; store.set(k, String(n)); return n; }),
    expire:     jest.fn().mockResolvedValue(1),
    ttl:        jest.fn(async (k)       => ttlStore.get(k) ?? -1),
    multi:      jest.fn(() => ({
      incrBy: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec:   jest.fn().mockResolvedValue([1, 1]),
    })),
    _store: store,
    _ttlStore: ttlStore,
    _reset: () => { store.clear(); ttlStore.clear(); },
  };

  return { createClient: jest.fn(() => client) };
});

process.env.INTERNAL_SECRET = 'test-secret';

// These are populated in beforeAll after jest.resetModules()
// so that the test and the controller share the SAME module instances
// (same RSA key pair, same db mock, same redis mock client).
let request, bcrypt, db, jwt, redisClient, app;
let signRequest;

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  request     = require('supertest');
  bcrypt      = require('bcryptjs');
  db          = require('../../shared/db');
  jwt         = require('../../shared/jwt');
  ({ signRequest } = require('../../shared/internalAuth'));
  const { createClient } = require('redis');
  redisClient = createClient();  // same client instance the controller will use
  app         = require('../../services/auth/src/index');
});

afterEach(() => {
  redisClient._reset();
  jest.clearAllMocks();
  db.callProc.mockResolvedValue([[]]);
  db.transaction.mockImplementation(async (callback) => callback({
    query: db.query,
    queryOne: db.queryOne,
    execute: db.query,
  }));
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function makePasswordHash(pw) {
  return bcrypt.hash(pw, 1); // cost=1 for test speed
}

function makeProcResult(locked = false) {
  return [[{ locked, locked_until: locked ? '2099-01-01 00:00:00' : null }]];
}

function makeUserRow(overrides = {}) {
  return {
    id:              1,
    email:           'vet@clinic.com',
    password_hash:   null, // filled in beforeEach
    is_active:       true,
    branch_id:       10,
    organization_id: 5,
    first_name:      'Vet',
    last_name:       'Pro',
    two_factor_enabled: false,
    ...overrides,
  };
}

function signedIdentityHeaders(method, path) {
  const identityHeaders = {
    'X-User-Id': '1',
    'X-Branch-Id': '10',
    'X-User-Roles': 'org_admin',
  };
  return {
    ...identityHeaders,
    'X-Org-Id': '5',
    'X-Internal-Sig': signRequest(method, path, '5', identityHeaders),
  };
}

// ── Tests: POST /login ─────────────────────────────────────────────────────────

describe('POST /login', () => {
  const PASSWORD = 'ValidPass1!';
  let user;

  beforeEach(async () => {
    user = makeUserRow({ password_hash: await makePasswordHash(PASSWORD) });
  });

  test('200 — successful login returns access + refresh tokens', async () => {
    db.callProc
      .mockResolvedValueOnce(makeProcResult(false))
      .mockResolvedValueOnce([[]]);
    db.queryOne.mockResolvedValueOnce(user);                       // user lookup
    db.query
      .mockResolvedValueOnce([{ name: 'veterinarian' }])           // roles
      .mockResolvedValueOnce([{ insertId: 1 }])                    // insert session
      .mockResolvedValueOnce([{ insertId: 2 }]);                   // login_history

    const res = await request(app).post('/login').send({ email: user.email, password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      accessToken:  expect.any(String),
    });
    expect(res.headers['set-cookie']).toEqual(expect.arrayContaining([
      expect.stringContaining('refreshToken='),
      expect.stringContaining('HttpOnly'),
      expect.stringContaining('SameSite=None'),
      expect.stringContaining('Path=/api/v1/auth/refresh'),
    ]));
    expect(res.body.data.user.orgId).toBe(5);
    expect(jwt.verifyAccess(res.body.data.accessToken).permissions).toEqual(
      expect.arrayContaining(['patients:read'])
    );
  });

  test('401 — wrong password', async () => {
    db.callProc.mockResolvedValueOnce(makeProcResult(false));
    db.queryOne.mockResolvedValueOnce(user);
    db.query.mockResolvedValueOnce([{ insertId: 99 }]); // login_history failure

    const res = await request(app).post('/login').send({ email: user.email, password: 'WrongPass1!' });
    expect(res.status).toBe(401);
  });

  test('200 - login falls back to the original lowercase email for legacy users', async () => {
    const legacyEmail = 'first.last+legacy@gmail.com';
    const legacyUser = makeUserRow({
      email: legacyEmail,
      password_hash: await makePasswordHash(PASSWORD),
    });
    db.callProc
      .mockResolvedValueOnce(makeProcResult(false))
      .mockResolvedValueOnce([[]]);
    db.queryOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(legacyUser)
      .mockResolvedValueOnce(null);
    db.query
      .mockResolvedValueOnce([{ name: 'veterinarian' }])
      .mockResolvedValueOnce([{ insertId: 2 }])
      .mockResolvedValueOnce([{ insertId: 1 }]);

    const res = await request(app).post('/login').send({ email: legacyEmail, password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(legacyEmail);
  });

  test('429 — account locked by SP', async () => {
    db.callProc.mockResolvedValueOnce(makeProcResult(true));

    const res = await request(app).post('/login').send({ email: user.email, password: PASSWORD });
    expect(res.status).toBe(429);
    expect(res.body.error.message).toMatch(/locked/i);
  });

  test('429 — Redis brute-force lock after repeated failures', async () => {
    // Simulate lock already set in Redis
    redisClient._store.set(`bf:lock:${user.email}:127.0.0.1`, '1');
    redisClient._ttlStore.set(`bf:lock:${user.email}:127.0.0.1`, 30);

    const res = await request(app).post('/login')
      .set('X-Forwarded-For', '127.0.0.1')
      .send({ email: user.email, password: 'anypassword' });
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
    // DB should not be called at all (blocked before SP)
    expect(db.callProc).not.toHaveBeenCalled();
  });

  test('400 — missing required fields', async () => {
    const res = await request(app).post('/login').send({ email: 'not-an-email', password: 'x' });
    expect(res.status).toBe(400);
  });
});

// ── Tests: POST /refresh ───────────────────────────────────────────────────────

describe('POST /refresh', () => {
  let refreshToken;
  let tokenHash;

  beforeEach(() => {
    const signed = jwt.signRefresh({ jti: 'test-jti', userId: 1 });
    refreshToken = signed;
    tokenHash    = jwt.hashToken(signed);
  });

  test('200 — valid token returns new pair', async () => {
    const session = {
      id: 10, user_id: 1, jti: 'test-jti',
      email: 'vet@clinic.com', branch_id: 10, organization_id: 5,
    };

    db.queryOne
      .mockResolvedValueOnce(session)                         // session lookup
      .mockResolvedValueOnce({ id: 10, jti: 'test-jti' });    // locked session
    db.query
      .mockResolvedValueOnce([{ name: 'veterinarian' }])      // roles
      .mockResolvedValueOnce([{ affectedRows: 1 }]);          // UPDATE session

    const res = await request(app).post('/refresh').set('Cookie', [`refreshToken=${refreshToken}`]).send({});

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.headers['set-cookie']).toEqual(expect.arrayContaining([
      expect.stringContaining('refreshToken='),
      expect.stringContaining('HttpOnly'),
      expect.stringContaining('SameSite=None'),
      expect.stringContaining('Path=/api/v1/auth/refresh'),
    ]));
    // Old hash should be stored in Redis as "used"
    expect(redisClient._store.get(`rt:used:${tokenHash}`)).toBe('10');
  });

  test('200 — refresh degrades gracefully when Redis is unavailable', async () => {
    const session = {
      id: 10, user_id: 1, jti: 'test-jti',
      email: 'vet@clinic.com', branch_id: 10, organization_id: 5,
    };

    redisClient.get.mockRejectedValueOnce(new Error('Redis down'));
    redisClient.setEx.mockRejectedValueOnce(new Error('Redis down'));
    redisClient.setEx.mockRejectedValueOnce(new Error('Redis down'));

    db.queryOne
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce({ id: 10, jti: 'test-jti' });
    db.query
      .mockResolvedValueOnce([{ name: 'veterinarian' }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const res = await request(app).post('/refresh').set('Cookie', [`refreshToken=${refreshToken}`]).send({});

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
  });

  test('401 — token not found in DB', async () => {
    db.queryOne.mockResolvedValueOnce(null); // session not found

    const res = await request(app).post('/refresh').set('Cookie', [`refreshToken=${refreshToken}`]).send({});
    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/not found/i);
  });

  test('401 — reuse detection: same token used twice', async () => {
    // Pre-seed Redis as if this token was already rotated
    redisClient._store.set(`rt:used:${tokenHash}`, '10');

    // Simulate the new (rotated) session in DB
    db.queryOne.mockResolvedValueOnce({ id: 10, jti: 'new-jti' });
    db.query.mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE revoke session

    const res = await request(app).post('/refresh').set('Cookie', [`refreshToken=${refreshToken}`]).send({});

    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/already used|theft/i);
    // Session should be revoked
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('is_revoked = TRUE'),
      expect.objectContaining({ id: '10' })
    );
  });

  test('401 — invalid JWT signature', async () => {
    const res = await request(app).post('/refresh').set('Cookie', ['refreshToken=bad.token.here']).send({});
    expect(res.status).toBe(401);
  });

  test('401 — missing refresh cookie', async () => {
    const res = await request(app).post('/refresh').send({});
    expect(res.status).toBe(401);
  });
});

// ── Tests: POST /logout ────────────────────────────────────────────────────────

describe('POST /logout', () => {
  test('204 — revokes JTI and session', async () => {
    db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

    const res = await request(app)
      .post('/logout')
      .set('X-User-Id',    '1')
      .set('X-Org-Id',     '5')
      .set('X-User-Roles', 'veterinarian')
      .set('X-Jti',        'some-jti')
      .set('X-Internal-Sig', signRequest('POST', '/logout', '5'));

    expect(res.status).toBe(204);
    expect(redisClient._store.get('revoked:some-jti')).toBe('1');
  });

  test('204 — logout still works if Redis revoke fails', async () => {
    redisClient.setEx.mockRejectedValueOnce(new Error('Redis down'));
    db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

    const res = await request(app)
      .post('/logout')
      .set('X-User-Id', '1')
      .set('X-Org-Id', '5')
      .set('X-User-Roles', 'veterinarian')
      .set('X-Jti', 'some-jti')
      .set('X-Internal-Sig', signRequest('POST', '/logout', '5'));

    expect(res.status).toBe(204);
  });

  test('204 — logout is idempotent without an active session', async () => {
    const res = await request(app).post('/logout');

    expect(res.status).toBe(204);
  });
});

// ── Tests: GET /health ─────────────────────────────────────────────────────────

describe('GET /health', () => {
  test('200 — health check always available', async () => {
    const res = await request(app).get('/health');
    expect([200, 503]).toContain(res.status);
    expect(typeof res.body.status).toBe('string');
    expect(res.body.service).toBe('auth');
  });
});

describe('Admin mounts', () => {
  test('401 — admin plugins requires internal signature', async () => {
    const res = await request(app)
      .get('/admin/plugins')
      .set('X-User-Id', '1')
      .set('X-Org-Id', '5')
      .set('X-User-Roles', 'org_admin');

    expect(res.status).toBe(401);
  });

  test('401 — ui schema requires internal signature', async () => {
    const res = await request(app)
      .get('/me/ui-schema')
      .set('X-User-Id', '1')
      .set('X-Org-Id', '5')
      .set('X-User-Roles', 'org_admin');

    expect(res.status).toBe(401);
  });

  test('401 — audit export requires internal signature', async () => {
    const res = await request(app)
      .get('/audit/export')
      .set('X-User-Id', '1')
      .set('X-Org-Id', '5')
      .set('X-User-Roles', 'org_admin');

    expect(res.status).toBe(401);
  });
});

describe('Internal auth routes', () => {
  test('200 — POST /internal/validate-api-key is reachable under OpenAPI validation', async () => {
    const apiKey = 'test-api-key';

    db.queryOne.mockResolvedValueOnce({
      id: 77,
      user_id: 1,
      email: 'vet@clinic.com',
      organization_id: 5,
      branch_id: 10,
      scopes: JSON.stringify(['patients:read']),
    });
    db.query.mockImplementation((sql) => {
      if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) {
        return Promise.resolve([{ COLUMN_NAME: 'is_active' }]);
      }
      if (sql.includes('UPDATE api_keys SET last_used_at = NOW()')) {
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      if (sql.includes('FROM roles r')) {
        return Promise.resolve([{ name: 'veterinarian' }]);
      }
      return Promise.resolve([]);
    });

    const res = await request(app)
      .post('/internal/validate-api-key')
      .set('X-Internal-Sig', signRequest('POST', '/internal/validate-api-key', ''))
      .send({ apiKey });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      userId: 1,
      email: 'vet@clinic.com',
      orgId: 5,
      branchId: 10,
    });
    expect(db.queryOne).toHaveBeenCalledWith(expect.stringContaining('api_keys'), expect.objectContaining({ hash: jwt.hashToken(apiKey) }));
  });

  test('200 — GET /internal/orgs/by-slug/:slug is reachable under OpenAPI validation', async () => {
    db.queryOne.mockResolvedValueOnce({
      org_id: 5,
      plan: 'pro',
      status: 'active',
    });

    const res = await request(app)
      .get('/internal/orgs/by-slug/vet-clinic')
      .set('X-Internal-Sig', signRequest('GET', '/internal/orgs/by-slug/vet-clinic', ''));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      orgId: 5,
      plan: 'pro',
    });
  });
});

describe('Protected auth routes', () => {
  test('200 — GET /api-keys is reachable with internal signature and user headers', async () => {
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM api_keys')) {
        return Promise.resolve([
          { id: 1, name: 'Primary key', key_prefix: 'pk_live_123', scopes: '[]', is_active: 1, revoked_at: null, created_at: '2026-05-14T00:00:00Z' },
        ]);
      }
      return Promise.resolve([]);
    });

    const res = await request(app)
      .get('/api-keys')
      .set(signedIdentityHeaders('GET', '/api-keys'));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
  });

  test('201 — POST /api-keys creates a key with internal signature and user headers', async () => {
    db.query.mockResolvedValueOnce([{ insertId: 1 }]);

    const res = await request(app)
      .post('/api-keys')
      .set(signedIdentityHeaders('POST', '/api-keys'))
      .send({ name: 'Automation key' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.rawKey).toEqual(expect.any(String));
  });

  test('200 — GET /admin/rbac/security-alerts is reachable with admin role and internal signature', async () => {
    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM security_alerts')) {
        return Promise.resolve([
          { id: 10, org_id: 5, alert_type: 'mass_export', severity: 'high' },
        ]);
      }
      return Promise.resolve([]);
    });

    const res = await request(app)
      .get('/admin/rbac/security-alerts')
      .set(signedIdentityHeaders('GET', '/admin/rbac/security-alerts'));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
  });
});
