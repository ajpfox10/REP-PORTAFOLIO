'use strict';

describe('gateway proxy tracing propagation', () => {
  let capturedOptions;
  let proxyReq;
  let exportClientSpan;

  beforeEach(() => {
    jest.resetModules();
    capturedOptions = null;
    exportClientSpan = jest.fn().mockResolvedValue(undefined);
    proxyReq = {
      removed: [],
      headers: {},
      path: '/patients?x=1',
      removeHeader(name) {
        this.removed.push(name);
      },
      setHeader(name, value) {
        this.headers[name] = value;
      },
      write: jest.fn(),
    };

    jest.doMock('http-proxy-middleware', () => ({
      createProxyMiddleware: jest.fn((options) => {
        capturedOptions = options;
        return jest.fn();
      }),
    }));
    jest.doMock('../../shared/circuitBreaker', () => ({
      getBreaker: jest.fn().mockReturnValue(null),
    }));
    jest.doMock('../../shared/internalAuth', () => ({
      signRequest: jest.fn().mockReturnValue('sig'),
      HEADER: 'x-internal-sig',
    }));
    jest.doMock('../../shared/serviceTargets', () => ({
      SERVICE_FALLBACKS: { patients: 'http://patients:4052' },
      resolveRuntimeServiceTarget: jest.fn().mockResolvedValue('http://patients:4052'),
    }));
    jest.doMock('../../shared/tracing', () => ({
      buildOutgoingTraceHeaders: jest.fn().mockReturnValue({
        'X-Trace-Id': 'trace-123',
        'X-Parent-Span-Id': 'span-parent',
        'X-Span-Id': 'span-child',
        traceparent: '00-trace-123-span-child-01',
      }),
      exportClientSpan,
    }));
    jest.doMock('../../gateway/src/middleware/logger', () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    }));
  });

  test('sets trace headers on proxied request and emits client span on response', async () => {
    const { makeServiceProxy } = require('../../gateway/src/routes/proxy.factory');
    makeServiceProxy('patients');

    const req = {
      method: 'GET',
      originalUrl: '/api/v1/patients',
      path: '/api/v1/patients',
      headers: { 'x-request-id': 'req-1' },
      requestId: 'req-1',
      traceId: 'trace-123',
      spanId: 'span-parent',
      ip: '127.0.0.1',
      user: { userId: 10, orgId: 20, branchId: 30, roles: ['org_admin'], email: 'a@b.c', jti: 'j1' },
    };

    capturedOptions.on.proxyReq(proxyReq, req);

    expect(proxyReq.headers['X-Trace-Id']).toBe('trace-123');
    expect(proxyReq.headers['X-Parent-Span-Id']).toBe('span-parent');
    expect(proxyReq.headers['X-Span-Id']).toBe('span-child');
    expect(proxyReq.headers.traceparent).toBe('00-trace-123-span-child-01');

    capturedOptions.on.proxyRes({ statusCode: 200 }, req);
    expect(exportClientSpan).toHaveBeenCalledWith(expect.objectContaining({
      serviceName: 'gateway',
      targetService: 'patients',
      traceId: 'trace-123',
      parentSpanId: 'span-parent',
      statusCode: 200,
    }));
  });

  test('strips the /api/v1/auth prefix before proxying auth requests', () => {
    const { STRIP_AUTH_PREFIX } = require('../../gateway/src/routes/registries/auth.registry');

    expect(STRIP_AUTH_PREFIX('', { originalUrl: '/api/v1/auth/api-keys' })).toBe('/api-keys');
    expect(STRIP_AUTH_PREFIX('', { originalUrl: '/api/v2/auth/admin/rbac/security-alerts' })).toBe('/admin/rbac/security-alerts');
    expect(STRIP_AUTH_PREFIX('', { originalUrl: '/api/v1/auth' })).toBe('/');
  });
});
