'use strict';

const { createProxyMiddleware } = require('http-proxy-middleware');
const { getBreaker } = require('../../../shared/circuitBreaker');
const { signRequest, HEADER: INTERNAL_SIG_HEADER } = require('../../../shared/internalAuth');
const { SERVICE_FALLBACKS, resolveRuntimeServiceTarget } = require('../../../shared/serviceTargets');
const { buildOutgoingTraceHeaders, exportClientSpan } = require('../../../shared/tracing');
const { logger } = require('../middleware/logger');

const SERVICES = SERVICE_FALLBACKS;

const DANGEROUS_BROWSER_HEADERS = [
  'x-user-id',
  'x-user-email',
  'x-user-roles',
  'x-user-permissions',
  'x-jti',
  'x-org-id',
  'x-tenant-id',
  'x-branch-id',
  'x-api-key-scopes',
  'x-auth-type',
  'x-internal-sig',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-forwarded-port',
];

function resolveOrgContext(req) {
  return req.user?.orgId || req.tenantOrgId || req.publicOrgIdHint || '';
}

// OT-073: deduplicate exportClientSpan calls (was duplicated in on.error and on.proxyRes)
function emitProxySpan(req, name, { error, statusCode } = {}) {
  return exportClientSpan({
    serviceName:  'gateway',
    operation:    `${req?.method || 'GET'} ${req?.originalUrl || '/'}`,
    targetService: name || 'unknown',
    traceId:      req?.traceId,
    parentSpanId: req?.spanId,
    startedAt:    req?._proxyStartedAtHr || process.hrtime.bigint(),
    ...(error      ? { error }      : {}),
    ...(statusCode ? { statusCode } : {}),
    tags: { path: req?.originalUrl || '/' },
  }).catch(() => {});
}

function makeProxy(target, pathRewrite = {}, name) {
  const breaker = name ? getBreaker(name) : null;

  const proxy = createProxyMiddleware({
    target,
    router: async () => {
      if (!name) return target;
      return resolveRuntimeServiceTarget(name);
    },
    changeOrigin: true,
    timeout: parseInt(process.env.GATEWAY_PROXY_TIMEOUT_MS || '30000', 10),
    proxyTimeout: parseInt(process.env.GATEWAY_PROXY_TIMEOUT_MS || '30000', 10),
    pathRewrite,
    on: {
      error(_err, req, res) {
        breaker?.onFailure();
        emitProxySpan(req, name, { error: _err });
        logger.error('Gateway proxy upstream error', {
          service: name || 'unknown',
          target,
          method: req?.method,
          path: req?.originalUrl,
          requestId: req?.requestId,
          error: _err?.message,
        });
        res.status(502).json({
          success: false,
          error: {
            message: 'Service temporarily unavailable',
            code: 'UPSTREAM_ERROR',
            ...(req?.requestId ? { requestId: req.requestId } : {}),
            ...(req?.traceId ? { traceId: req.traceId } : {}),
          },
        });
      },
      proxyRes(proxyRes, req) {
        if (proxyRes.statusCode >= 500) breaker?.onFailure();
        else breaker?.onSuccess();
        emitProxySpan(req, name, { statusCode: proxyRes.statusCode });
        logger.info('Gateway proxy response', {
          service: name || 'unknown',
          method: req.method,
          path: req.originalUrl,
          upstreamStatus: proxyRes.statusCode,
          latencyMs: Date.now() - (req._proxyStartedAt || Date.now()),
          requestId: req.requestId,
        });
      },
      proxyReq(proxyReq, req) {
        req._proxyStartedAt = Date.now();
        req._proxyStartedAtHr = process.hrtime.bigint();
        for (const header of DANGEROUS_BROWSER_HEADERS) {
          proxyReq.removeHeader(header);
        }

        const identityHeaders = {};
        const setIdentityHeader = (name, value) => {
          proxyReq.setHeader(name, value);
          identityHeaders[name.toLowerCase()] = String(value ?? '');
        };

        if (req.user) {
          setIdentityHeader('X-User-Id', req.user.userId || '');
          proxyReq.setHeader('X-Org-Id', resolveOrgContext(req));
          setIdentityHeader('X-Branch-Id', req.user.branchId || '');
          setIdentityHeader('X-User-Roles', (req.user.roles || []).join(','));
          setIdentityHeader('X-User-Permissions', (req.user.permissions || []).join(','));
          setIdentityHeader('X-User-Email', req.user.email || '');
          setIdentityHeader('X-JTI', req.user.jti || '');
          if (req.isApiKey) {
            setIdentityHeader('X-Auth-Type', 'api_key');
            setIdentityHeader('X-Api-Key-Scopes', (req.user.scopes || []).join(','));
          }
        } else if (req.tenantOrgId) {
          proxyReq.setHeader('X-Org-Id', req.tenantOrgId);
        } else if (req.publicOrgIdHint) {
          proxyReq.setHeader('X-Org-Id', req.publicOrgIdHint);
        }

        proxyReq.setHeader('X-Request-Id', req.requestId || Date.now().toString());
        const traceHeaders = buildOutgoingTraceHeaders(req);
        proxyReq.setHeader('X-Trace-Id', traceHeaders['X-Trace-Id']);
        proxyReq.setHeader('X-Parent-Span-Id', traceHeaders['X-Parent-Span-Id']);
        proxyReq.setHeader('X-Span-Id', traceHeaders['X-Span-Id']);
        proxyReq.setHeader('traceparent', traceHeaders.traceparent);
        proxyReq.setHeader('X-Forwarded-For', req.clientIp || req.ip);
        // Use req.hostname (parsed by Express from the Host header, validated) rather than
        // the raw req.headers.host which is attacker-controlled and enables Host Header Injection
        // in downstream services that trust X-Forwarded-Host.
        proxyReq.setHeader('X-Forwarded-Host', req.hostname || '');
        proxyReq.setHeader('X-Forwarded-Proto', req.secure ? 'https' : 'http');
        if (req.socket?.localPort) {
          proxyReq.setHeader('X-Forwarded-Port', String(req.socket.localPort));
        }

        const sigPath = (proxyReq.path || req.path).split('?')[0];
        const sig = signRequest(req.method, sigPath, resolveOrgContext(req), identityHeaders);
        if (sig) proxyReq.setHeader(INTERNAL_SIG_HEADER, sig);

        if (req.rawBody && ['POST', 'PUT', 'PATCH'].includes(req.method)) {
          proxyReq.setHeader('Content-Length', req.rawBody.length);
          proxyReq.write(req.rawBody);
        } else if (req.body && ['POST', 'PUT', 'PATCH'].includes(req.method)) {
          const ct = (req.headers['content-type'] || '').toLowerCase();
          if (ct.includes('multipart/form-data') || ct.includes('application/x-www-form-urlencoded')) {
            // rawBody is required for non-JSON content types — skip re-serialization to avoid corruption
            return;
          }
          const bodyData = JSON.stringify(req.body);
          proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
          proxyReq.write(bodyData);
        }
      },
    },
  });

  if (!breaker) return proxy;

  return (req, res, next) => {
    if (!breaker.canRequest()) {
      logger.warn('Gateway proxy circuit open', {
        service: name,
        method: req.method,
        path: req.originalUrl,
        requestId: req.requestId,
      });
      return res.status(503).json({
        success: false,
        error: {
          message: 'Service temporarily unavailable',
          code: 'CIRCUIT_OPEN',
          service: name,
          ...(req.requestId ? { requestId: req.requestId } : {}),
          ...(req.traceId ? { traceId: req.traceId } : {}),
        },
      });
    }
    proxy(req, res, next);
  };
}

const STRIP_API_VERSION = (_path, req) => req.originalUrl.replace(/^\/api\/v[12]\//, '/');

function makeServiceProxy(name, pathRewrite) {
  const rw = pathRewrite !== undefined ? pathRewrite : STRIP_API_VERSION;
  return makeProxy(SERVICES[name], rw, name);
}

module.exports = {
  SERVICES,
  STRIP_API_VERSION,
  resolveOrgContext,
  makeProxy,
  makeServiceProxy,
};
