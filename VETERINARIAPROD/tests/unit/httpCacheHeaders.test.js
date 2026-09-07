'use strict';

const { httpCacheHeaders } = require('../../shared/cache');

function makeReqRes(method = 'GET') {
  const headers = {};
  const req = { method };
  const res = {
    setHeader: jest.fn((k, v) => { headers[k.toLowerCase()] = v; }),
    _headers: headers,
  };
  const next = jest.fn();
  return { req, res, next, headers };
}

describe('httpCacheHeaders()', () => {
  test('GET public 600s → Cache-Control correcto', () => {
    const { req, res, next, headers } = makeReqRes();
    httpCacheHeaders({ maxAge: 600, scope: 'public' })(req, res, next);
    expect(headers['cache-control']).toContain('public');
    expect(headers['cache-control']).toContain('max-age=600');
    expect(headers['cache-control']).toContain('s-maxage=600');
    expect(next).toHaveBeenCalled();
  });

  test('GET private 300s → Cache-Control private sin s-maxage', () => {
    const { req, res, next, headers } = makeReqRes();
    httpCacheHeaders({ maxAge: 300, scope: 'private' })(req, res, next);
    expect(headers['cache-control']).toContain('private');
    expect(headers['cache-control']).toContain('max-age=300');
    expect(headers['cache-control']).not.toContain('s-maxage');
    expect(next).toHaveBeenCalled();
  });

  test('no-store → solo Cache-Control: no-store', () => {
    const { req, res, next, headers } = makeReqRes();
    httpCacheHeaders({ scope: 'no-store' })(req, res, next);
    expect(headers['cache-control']).toBe('no-store');
    expect(next).toHaveBeenCalled();
  });

  test('POST → pasa sin setear headers', () => {
    const { req, res, next, headers } = makeReqRes('POST');
    httpCacheHeaders({ maxAge: 60 })(req, res, next);
    expect(res.setHeader).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  test('Vary header incluye Accept-Encoding por defecto', () => {
    const { req, res, headers } = makeReqRes();
    httpCacheHeaders()(req, res, jest.fn());
    expect(headers['vary']).toContain('Accept-Encoding');
  });

  test('Vary header personalizable', () => {
    const { req, res, headers } = makeReqRes();
    httpCacheHeaders({ vary: ['Accept-Encoding', 'Accept-Language'] })(req, res, jest.fn());
    expect(headers['vary']).toContain('Accept-Language');
  });

  test('HEAD también recibe headers', () => {
    const { req, res, next, headers } = makeReqRes('HEAD');
    httpCacheHeaders({ maxAge: 60, scope: 'public' })(req, res, next);
    expect(headers['cache-control']).toContain('public');
    expect(next).toHaveBeenCalled();
  });
});
