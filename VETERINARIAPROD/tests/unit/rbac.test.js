'use strict';

const { hasPermission, hasScopePermission, requirePermission, requireAny, requireAll } = require('../../shared/rbac');

describe('hasPermission', () => {
  test('superadmin has all permissions', () => {
    expect(hasPermission(['superadmin'], 'patients:delete')).toBe(true);
    expect(hasPermission(['superadmin'], 'anything:whatever')).toBe(true);
  });

  test('exact permission match', () => {
    expect(hasPermission(['receptionist'], 'appointments:read')).toBe(true);
    expect(hasPermission(['receptionist'], 'surgery:delete')).toBe(false);
  });

  test('wildcard resource:* match', () => {
    expect(hasPermission(['veterinarian'], 'appointments:delete')).toBe(true);
    expect(hasPermission(['receptionist'], 'invoices:delete')).toBe(false);
  });

  test('multiple roles — OR logic', () => {
    expect(hasPermission(['receptionist', 'groomer'], 'grooming:create')).toBe(true);
  });

  test('unknown role has no permissions', () => {
    expect(hasPermission(['ghost_role'], 'patients:read')).toBe(false);
  });
});

describe('hasScopePermission', () => {
  test('limits API key scopes to exact or resource wildcard grants', () => {
    expect(hasScopePermission(['patients:read'], 'patients:read')).toBe(true);
    expect(hasScopePermission(['patients:read'], 'patients:update')).toBe(false);
    expect(hasScopePermission(['patients:*'], 'patients:update')).toBe(true);
  });
});

// ── Middleware tests (using mock req/res/next) ────────────────────────────────

function mockRes() {
  const res = { _status: 200, _body: null };
  res.status = (code) => { res._status = code; return res; };
  res.json   = (body)  => { res._body = body; return res; };
  return res;
}

describe('requirePermission middleware', () => {
  test('calls next() when permission is granted', async () => {
    const req  = { user: { roles: ['veterinarian'] } };
    const res  = mockRes();
    const next = jest.fn();
    await requirePermission('appointments:read')(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res._status).toBe(200);
  });

  test('returns 403 when permission is denied', async () => {
    const req  = { user: { roles: ['groomer'] } };
    const res  = mockRes();
    const next = jest.fn();
    await requirePermission('surgery:create')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(403);
  });

  test('returns 403 when API key scope does not include granted role permission', async () => {
    const req  = { user: { roles: ['org_admin'], authType: 'api_key', apiKeyScopes: ['patients:read'] } };
    const res  = mockRes();
    const next = jest.fn();
    await requirePermission('patients:update')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(403);
  });
});

describe('requireAny middleware', () => {
  test('passes when any permission is met', async () => {
    const req  = { user: { roles: ['receptionist'] } };
    const res  = mockRes();
    const next = jest.fn();
    await requireAny('surgery:create', 'appointments:read')(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('blocks when no permission is met', async () => {
    const req  = { user: { roles: ['groomer'] } };
    const res  = mockRes();
    const next = jest.fn();
    await requireAny('surgery:create', 'lab:delete')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(403);
  });
});

describe('requireAll middleware', () => {
  test('passes when all permissions are met', async () => {
    const req  = { user: { roles: ['org_admin'] } };
    const res  = mockRes();
    const next = jest.fn();
    await requireAll('patients:read', 'invoices:create', 'reports:read')(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('blocks when any permission is missing', async () => {
    const req  = { user: { roles: ['groomer'] } };
    const res  = mockRes();
    const next = jest.fn();
    await requireAll('grooming:read', 'invoices:delete')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(403);
  });
});
