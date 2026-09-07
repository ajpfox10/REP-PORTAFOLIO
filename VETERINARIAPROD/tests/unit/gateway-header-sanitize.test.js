'use strict';

const { sanitizeIncomingHeaders } = require('../../gateway/middleware/sanitizeIncomingHeaders');

describe('sanitizeIncomingHeaders()', () => {
  test('removes browser-controlled trust headers before gateway processing', () => {
    const req = {
      headers: {
        'x-org-id': '123',
        'x-tenant-id': 'tenant-a',
        'x-branch-id': '9',
        'x-jti': 'client-jti',
        'x-user-permissions': 'admin:*',
        'x-forwarded-for': '1.2.3.4',
        'x-request-id': 'keep-me',
      },
      ip: '203.0.113.7',
    };

    const next = jest.fn();
    sanitizeIncomingHeaders(req, {}, next);

    expect(req.headers['x-org-id']).toBeUndefined();
    expect(req.headers['x-tenant-id']).toBeUndefined();
    expect(req.headers['x-branch-id']).toBeUndefined();
    expect(req.headers['x-jti']).toBeUndefined();
    expect(req.headers['x-user-permissions']).toBeUndefined();
    expect(req.headers['x-forwarded-for']).toBeUndefined();
    expect(req.headers['x-request-id']).toBe('keep-me');
    expect(req.clientIp).toBe('203.0.113.7');
    expect(next).toHaveBeenCalledTimes(1);
  });
});
