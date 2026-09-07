'use strict';

jest.mock('../../shared/redis', () => ({
  getRedisSingleton: jest.fn().mockResolvedValue({
    set: jest.fn().mockResolvedValue('OK'),
  }),
}));

const { signRequest, verifySignature, requireInternalSig, HEADER } = require('../../shared/internalAuth');

const SECRET = 'test-secret-abc123';

beforeAll(() => { process.env.INTERNAL_SECRET = SECRET; });
afterAll(() => {
  delete process.env.INTERNAL_SECRET;
  delete process.env.DEPENDENCY_MODE_INTERNAL_AUTH;
});

describe('signRequest()', () => {
  test('returns non-empty string when secret exists', () => {
    const sig = signRequest('GET', '/api/v1/patients', '42');
    expect(typeof sig).toBe('string');
    expect(sig.length).toBeGreaterThan(0);
  });

  test('format: t={timestamp}.n={nonce}.s={hex}', () => {
    const sig = signRequest('POST', '/api/v1/clients', '7');
    expect(sig).toMatch(/^t=\d+\.n=[0-9a-f]+\.s=[0-9a-f]+$/);
  });

  test('generates unique signatures for repeated requests in the same second', () => {
    const first = signRequest('GET', '/api/v1/auth/me', '5');
    const second = signRequest('GET', '/api/v1/auth/me', '5');
    expect(second).not.toBe(first);
  });

  test('returns empty string without secret', () => {
    const saved = process.env.INTERNAL_SECRET;
    delete process.env.INTERNAL_SECRET;
    jest.resetModules();
    const { signRequest: sr } = require('../../shared/internalAuth');
    expect(sr('GET', '/', '')).toBe('');
    process.env.INTERNAL_SECRET = saved;
    jest.resetModules();
  });
});

describe('verifySignature()', () => {
  test('valid signature => ok:true', () => {
    const sig = signRequest('GET', '/api/v1/patients', '42');
    const result = verifySignature('GET', '/api/v1/patients', '42', sig);
    expect(result.ok).toBe(true);
  });

  test('different method => invalid_signature', () => {
    const sig = signRequest('GET', '/api/v1/patients', '42');
    const result = verifySignature('POST', '/api/v1/patients', '42', sig);
    expect(result.ok).toBe(false);
  });

  test('different path => invalid_signature', () => {
    const sig = signRequest('GET', '/api/v1/patients', '42');
    const result = verifySignature('GET', '/api/v1/clients', '42', sig);
    expect(result.ok).toBe(false);
  });

  test('different orgId => invalid_signature', () => {
    const sig = signRequest('GET', '/api/v1/patients', '42');
    const result = verifySignature('GET', '/api/v1/patients', '99', sig);
    expect(result.ok).toBe(false);
  });

  test('modified identity headers => invalid_signature', () => {
    const headers = { 'x-user-id': '7', 'x-user-roles': 'veterinarian' };
    const sig = signRequest('GET', '/api/v1/patients', '42', headers);
    const result = verifySignature(
      'GET',
      '/api/v1/patients',
      '42',
      sig,
      { ...headers, 'x-user-roles': 'org_admin' }
    );
    expect(result).toMatchObject({ ok: false, reason: 'invalid_signature' });
  });

  test('signature without nonce is rejected', () => {
    const result = verifySignature('GET', '/', '42', 't=123.s=abc');
    expect(result).toMatchObject({ ok: false, reason: 'malformed_header' });
  });

  test('missing header => missing_header', () => {
    const result = verifySignature('GET', '/api/v1/patients', '42', '');
    expect(result).toMatchObject({ ok: false, reason: 'missing_header' });
  });

  test('malformed header => malformed_header', () => {
    const result = verifySignature('GET', '/', '42', 'invalid-format');
    expect(result).toMatchObject({ ok: false, reason: 'malformed_header' });
  });

  test('without secret and strict mode => missing_secret', () => {
    const savedSecret = process.env.INTERNAL_SECRET;
    delete process.env.INTERNAL_SECRET;
    process.env.DEPENDENCY_MODE_INTERNAL_AUTH = 'strict';
    jest.resetModules();
    const { verifySignature: verifyStrict } = require('../../shared/internalAuth');
    expect(verifyStrict('GET', '/', '42', '')).toMatchObject({ ok: false, reason: 'missing_secret' });
    process.env.INTERNAL_SECRET = savedSecret;
    delete process.env.DEPENDENCY_MODE_INTERNAL_AUTH;
    jest.resetModules();
  });

  test('HEADER export is correct', () => {
    expect(HEADER).toBe('x-internal-sig');
  });
});

describe('requireInternalSig()', () => {
  test('allows the same request object to pass repeated internal auth middleware', async () => {
    const sig = signRequest('GET', '/me', '5');
    const req = {
      method: 'GET',
      baseUrl: '',
      path: '/me',
      originalUrl: '/me',
      headers: {
        'x-org-id': '5',
        [HEADER]: sig,
      },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    await requireInternalSig(req, res, next);
    await requireInternalSig(req, res, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(res.status).not.toHaveBeenCalled();
  });
});
