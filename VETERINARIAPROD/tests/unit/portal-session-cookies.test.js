'use strict';

jest.mock('../../shared/db', () => ({ query: jest.fn(), queryOne: jest.fn() }));
jest.mock('../../shared/redis', () => ({ getRedisSingleton: jest.fn().mockRejectedValue(new Error('sin redis')) }));
jest.mock('../../shared/eventBus', () => ({ publish: jest.fn().mockResolvedValue(undefined) }));

const db = require('../../shared/db');
const common = require('../../services/portal/src/portal.common');
const { portalCookieToBearer } = require('../../gateway/src/routes/registries/portal.registry');

function mockRes() {
  const res = { cookies: {}, statusCode: 200 };
  res.cookie = jest.fn((name, value, opts) => { res.cookies[name] = { value, opts }; return res; });
  res.clearCookie = jest.fn(() => res);
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  return res;
}

describe('sesión del portal en cookies httpOnly', () => {
  test('el login deja los tokens en cookies httpOnly y no en el body', () => {
    const res = mockRes();
    common.sendOwnerSession({ headers: {} }, res, { accessToken: 'acc', refreshToken: 'ref' }, { owner: { id: 4 } });

    expect(res.cookies.portalAccessToken).toMatchObject({ value: 'acc', opts: { httpOnly: true, path: '/api' } });
    expect(res.cookies.portalRefreshToken).toMatchObject({ value: 'ref', opts: { httpOnly: true, path: '/api/v1/portal/auth' } });
    expect(res.body.data).toEqual({ owner: { id: 4 }, authenticated: true });
  });

  test('las apps nativas pueden pedir los tokens en el body', () => {
    const res = mockRes();
    common.sendOwnerSession({ headers: { 'x-portal-token-transport': 'body' } }, res, { accessToken: 'acc', refreshToken: 'ref' });
    expect(res.body.data).toMatchObject({ accessToken: 'acc', refreshToken: 'ref' });
  });

  test('readCookie encuentra la cookie pedida entre varias', () => {
    const req = { headers: { cookie: '_csrf=x; portalAccessToken=abc%3D; otra=1' } };
    expect(common.readCookie(req, 'portalAccessToken')).toBe('abc=');
    expect(common.readCookie(req, 'falta')).toBeNull();
  });

  test('portalAuth acepta el token desde la cookie', async () => {
    const token = common.buildOwnerToken({ id: 4, email: 'a@b.test', organization_id: 9 });
    db.queryOne.mockResolvedValueOnce({ id: 4 });
    const req = { headers: { cookie: `portalAccessToken=${token}` } };
    const next = jest.fn();

    await common.portalAuth(req, mockRes(), next);

    expect(next).toHaveBeenCalled();
    expect(req.owner).toMatchObject({ clientId: 4, role: 'owner' });
  });

  test('portalAuth rechaza si no hay token', async () => {
    const res = mockRes();
    await common.portalAuth({ headers: {} }, res, jest.fn());
    expect(res.statusCode).toBe(401);
  });

  test('el gateway pasa la cookie del portal como Bearer sin pisar un header existente', () => {
    const req = { cookies: { portalAccessToken: 'tok' }, headers: {} };
    portalCookieToBearer(req, {}, jest.fn());
    expect(req.headers.authorization).toBe('Bearer tok');

    const withHeader = { cookies: { portalAccessToken: 'tok' }, headers: { authorization: 'Bearer app' } };
    portalCookieToBearer(withHeader, {}, jest.fn());
    expect(withHeader.headers.authorization).toBe('Bearer app');
  });
});

