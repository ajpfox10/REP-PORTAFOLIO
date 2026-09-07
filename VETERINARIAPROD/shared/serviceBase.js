'use strict';

/**
 * Creates a standard Express service app with:
 * - JSON parsing
 * - User injection from gateway headers
 * - RBAC helper
 * - Health endpoint
 * - Error handler
 */

const express = require('express');
const { hasPermissionDynamic } = require('./rbac');
const { createLogger }        = require('./logger');
const { appErrorHandler }     = require('./errors');
const { requireInternalSig }  = require('./internalAuth');
const { fromHeaders }         = require('./requestContext');
const { httpMetrics, metricsHandler } = require('./metrics');
const { tracingMiddleware } = require('./tracing');
const { validateCriticalEnv } = require('./validateEnv');

// Global registry for optional per-service health checks (e.g. worker queue stats)
const _healthCheckers = new Map();

function registerHealthChecker(name, fn) {
  _healthCheckers.set(String(name), fn);
}

function matchesPathRule(rule, req) {
  if (!rule) return false;
  const path = req.path || req.originalUrl || '';
  if (rule instanceof RegExp) return rule.test(path);
  if (typeof rule === 'function') return rule(req) === true;
  if (typeof rule === 'string') return path === rule;
  return false;
}

function shouldSkipInternalAuth(req, publicPaths = []) {
  return publicPaths.some((rule) => matchesPathRule(rule, req));
}

function matchesOpenApiIgnore(rule, pathname, req) {
  if (!rule) return false;
  if (rule instanceof RegExp) return rule.test(pathname);
  if (typeof rule === 'function') return rule(pathname, req) === true;
  if (typeof rule === 'string') return pathname === rule || pathname.startsWith(`${rule}/`);
  return false;
}

function buildOpenApiIgnorePaths(extraIgnorePaths) {
  const extraRules = Array.isArray(extraIgnorePaths)
    ? extraIgnorePaths
    : (extraIgnorePaths ? [extraIgnorePaths] : []);

  return (pathname, req) => {
    const path = pathname || req?.path || req?.originalUrl || '';
    if (/^\/health(?:\/|$)/.test(path) || path === '/metrics') return true;
    return extraRules.some((rule) => matchesOpenApiIgnore(rule, path, req));
  };
}

function hasScopePermission(scopes, perm) {
  if (!Array.isArray(scopes) || scopes.length === 0) return false;
  if (scopes.includes('*') || scopes.includes(perm)) return true;
  const [resource] = perm.split(':');
  if (scopes.includes(`${resource}:*`)) return true;
  if (perm.startsWith('crud:')) {
    const [, table] = perm.split(':');
    if (scopes.includes(`crud:${table}:*`)) return true;
  }
  return false;
}

function requestAllowsPermissionScope(req, perm) {
  if (req.user?.authType !== 'api_key') return true;
  return hasScopePermission(req.user.apiKeyScopes || [], perm);
}

function requirePerm(perm) {
  return async (req, res, next) => {
    const allowed = await hasPermissionDynamic(req.user?.roles || [], perm, req.user?.orgId || null);
    if (!allowed || !requestAllowsPermissionScope(req, perm)) {
      // OT-058: log estructurado de denegaciones para auditoría y alertas
      const log = createLogger('rbac');
      log.warn('RBAC denied', {
        permission: perm,
        userId:  req.user?.userId  || null,
        orgId:   req.user?.orgId   || null,
        roles:   req.user?.roles   || [],
        method:  req.method,
        path:    req.originalUrl || req.path,
        traceId: req.traceId || null,
        ip:      req.ip || null,
      });
      return res.status(403).json({
        success: false,
        error:   {
          message: `Forbidden: requires '${perm}'`,
          code: 'RBAC_003',
          ...(req.requestId ? { requestId: req.requestId } : {}),
          ...(req.traceId ? { traceId: req.traceId } : {}),
        },
      });
    }
    next();
  };
}

/**
 * Method-based write guard.
 * Complements the base `:read` check applied at router mount level.
 *
 *   GET / HEAD / OPTIONS → pass through (covered by the :read check above)
 *   POST   → resource:create
 *   PUT    → resource:update
 *   PATCH  → resource:update
 *   DELETE → resource:delete
 *
 * Usage:
 *   app.use('/clients', requirePerm('clients:read'), guardWrite('clients'), clientsRouter);
 */
function guardWrite(resource) {
  const map = {
    POST  : `${resource}:create`,
    PUT   : `${resource}:update`,
    PATCH : `${resource}:update`,
    DELETE: `${resource}:delete`,
  };
  return async (req, res, next) => {
    const needed = map[req.method];
    if (!needed) return next();
    const allowed = await hasPermissionDynamic(req.user?.roles || [], needed, req.user?.orgId || null);
    if (!allowed || !requestAllowsPermissionScope(req, needed)) {
      return res.status(403).json({
        success: false,
        error:   {
          message: `Forbidden: requires '${needed}'`,
          code: 'RBAC_003',
          ...(req.requestId ? { requestId: req.requestId } : {}),
          ...(req.traceId ? { traceId: req.traceId } : {}),
        },
      });
    }
    next();
  };
}

/**
 * Attach OpenAPI request validation to an Express app if a spec file exists.
 * Silently skips when express-openapi-validator is not installed or spec not found.
 *
 * @param {Express}  app
 * @param {string}   specPath  — absolute path to openapi.yaml / openapi.json
 * @param {object}   [opts]    — express-openapi-validator options overrides
 */
function withOpenApiValidation(app, specPath, opts = {}, log = console) {
  if (process.env.OPENAPI_VALIDATE === 'false') return;
  try {
    const fs = require('fs');
    if (!fs.existsSync(specPath)) return;
    const { middleware: openApiValidator } = require('express-openapi-validator');
    const { ignorePaths, ...validatorOpts } = opts || {};
    app.use(openApiValidator({
      apiSpec:           specPath,
      validateRequests:  { allowUnknownQueryParameters: true, coerceTypes: false },
      validateResponses: false,
      validateSecurity:  false,   // security enforced by HMAC + RBAC, not by spec
      ignorePaths:       buildOpenApiIgnorePaths(ignorePaths),
      ...validatorOpts,
    }));
    // Map validation errors to standard error envelope
    app.use((err, _req, res, next) => {
      if (err.status === 400 && err.errors) {
        return res.status(400).json({
          success: false,
          error: {
            message: 'Request validation failed',
            code: 'VALIDATION_ERROR',
            details: err.errors,
            ...(res.locals.requestId ? { requestId: res.locals.requestId } : {}),
            ...(res.locals.traceId ? { traceId: res.locals.traceId } : {}),
          },
        });
      }
      next(err);
    });
  } catch (error) {
    log.warn('OpenAPI validation disabled for service', {
      specPath,
      error: error.message,
    });
  }
}

function buildApp(serviceName, routesFn, opts = {}) {
  const log = createLogger(serviceName);
  const app = express();
  const publicHealthPath = /^\/health(?:\/(?:live|ready|deep))?$/;
  const metricsToken = process.env.METRICS_TOKEN || '';
  const publicMetricsPath = /^\/metrics$/;
  if (opts.trustProxy !== undefined) {
    app.set('trust proxy', opts.trustProxy);
  }

  const preJsonMiddlewares = Array.isArray(opts.preJsonMiddlewares)
    ? opts.preJsonMiddlewares
    : (opts.preJsonMiddlewares ? [opts.preJsonMiddlewares] : []);
  for (const middleware of preJsonMiddlewares) {
    app.use(middleware);
  }

  app.use(tracingMiddleware(serviceName));
  app.use(express.json({ limit: opts.jsonLimit || '10mb' }));
  if (opts.urlencoded) {
    app.use(express.urlencoded({
      extended: opts.urlencodedExtended !== undefined ? opts.urlencodedExtended : true,
    }));
  }

  const postJsonMiddlewares = Array.isArray(opts.postJsonMiddlewares)
    ? opts.postJsonMiddlewares
    : (opts.postJsonMiddlewares ? [opts.postJsonMiddlewares] : []);
  for (const middleware of postJsonMiddlewares) {
    app.use(middleware);
  }

  // Zero-trust: all routes except /health require a valid gateway HMAC signature
  const publicPaths = [publicHealthPath, publicMetricsPath].concat(opts.publicPaths || []);
  app.use((req, res, next) => {
    if (shouldSkipInternalAuth(req, publicPaths)) return next();
    return requireInternalSig(req, res, next);
  });
  app.use(fromHeaders);
  app.use(httpMetrics(serviceName));

  // OT-055: structured HTTP access log (method, route, status, latency, userId)
  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on('finish', () => {
      const ms = Date.now() - startedAt;
      const route = req.route?.path || req.path || 'unknown';
      const entry = {
        method: req.method,
        route,
        status: res.statusCode,
        ms,
        userId: req.user?.userId || null,
        orgId:  req.user?.orgId  || null,
        traceId: req.traceId || req.headers?.['x-trace-id'] || null,
        ip: req.ip || null,
      };
      if (res.statusCode >= 500) log.error('HTTP request', entry);
      else if (res.statusCode >= 400) log.warn('HTTP request', entry);
      else log.info('HTTP request', entry);
    });
    next();
  });

  // OpenAPI request validation (if specPath provided)
  if (opts.specPath) withOpenApiValidation(app, opts.specPath, opts.openApiOpts || {}, log);

  // ── Healthcheck real — verifica DB, Redis, circuit breakers y memoria ────
  async function runHealthChecks({ external = false } = {}) {
    const checks  = {};
    const latency = {};
    let healthy   = true;

    // Ping DB
    try {
      const t0 = Date.now();
      const db = require('./db');
      await db.getPool().execute('SELECT 1');
      checks.db  = 'ok';
      latency.db = Date.now() - t0;
    } catch (error) {
      checks.db  = 'error';
      healthy    = false;
      log.warn('Healthcheck DB probe failed', { error: error.message });
    }

    // Ping Redis
    try {
      const t0    = Date.now();
      const cache = require('./cache');
      const redis = await cache.getClient();
      await redis.ping();
      checks.redis  = 'ok';
      latency.redis = Date.now() - t0;
    } catch (error) {
      checks.redis = 'degraded'; // Redis degradado no mata el servicio
      log.warn('Healthcheck Redis probe degraded', { error: error.message });
    }

    // Circuit breakers
    try {
      const { getAllStatus } = require('./circuitBreaker');
      const breakers = getAllStatus();
      checks.circuitBreakers = breakers.length === 0
        ? 'none'
        : breakers.map(b => ({ name: b.name, state: b.state, failures: b.failures }));
      // Any OPEN circuit makes service degraded (but not unhealthy)
      if (breakers.some(b => b.state === 'OPEN')) checks._circuitOpen = true;
    } catch (error) {
      checks.circuitBreakers = 'unavailable';
      log.warn('Healthcheck circuit breaker probe unavailable', { error: error.message });
    }

    // Memory
    const mem = process.memoryUsage();
    checks.memory = {
      heapUsedMb:  Math.round(mem.heapUsed  / 1024 / 1024),
      heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
      rssMb:       Math.round(mem.rss       / 1024 / 1024),
    };

    // OT-059: dependencias externas — solo en health profundo para no degradar readiness.
    if (external && process.env.STRIPE_SECRET_KEY) {
      try {
        const t0 = Date.now();
        await fetch('https://api.stripe.com/v1/charges?limit=1', {
          headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
          signal: AbortSignal.timeout(5000),
        });
        checks.stripe  = 'ok';
        latency.stripe = Date.now() - t0;
      } catch {
        checks.stripe = 'degraded';
      }
    }

    if (external && process.env.MP_ACCESS_TOKEN) {
      try {
        const t0 = Date.now();
        await fetch('https://api.mercadopago.com/v1/payment_methods', {
          headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` },
          signal: AbortSignal.timeout(5000),
        });
        checks.mercadopago  = 'ok';
        latency.mercadopago = Date.now() - t0;
      } catch {
        checks.mercadopago = 'degraded';
      }
    }

    if (external && process.env.OPENAI_API_KEY) {
      try {
        const t0 = Date.now();
        await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
          signal: AbortSignal.timeout(5000),
        });
        checks.openai  = 'ok';
        latency.openai = Date.now() - t0;
      } catch {
        checks.openai = 'degraded';
      }
    }

    // Optional per-service checkers (worker queue stats, etc.)
    for (const [name, fn] of _healthCheckers) {
      try {
        checks[name] = await fn();
      } catch (err) {
        checks[name] = 'unavailable';
        log.warn(`Healthcheck '${name}' failed`, { error: err.message });
      }
    }

    return { healthy, checks, latency };
  }

  app.get('/health', async (req, res) => {
    const { healthy, checks, latency } = await runHealthChecks();
    res.status(healthy ? 200 : 503).json({
      status:  healthy ? 'ok' : 'degraded',
      service: serviceName,
      version: process.env.APP_VERSION || '1.0.0',
      uptime:  Math.floor(process.uptime()),
      ts:      new Date().toISOString(),
      traceId: req.traceId || req.headers['x-trace-id'] || null,
      checks,
      latency,
    });
  });

  // /health/deep — alias explícito para load balancers avanzados
  // Requires the same METRICS_TOKEN as /metrics to prevent information disclosure
  // (the response reveals which external APIs are configured and their latency).
  app.get('/health/deep', (req, res, next) => {
    if (!metricsToken) return next();
    if (req.get('authorization') !== `Bearer ${metricsToken}`) {
      return res.status(401).json({ success: false, error: { message: 'Unauthorized', code: 'METRICS_AUTH_REQUIRED' } });
    }
    return next();
  }, async (req, res) => {
    const { healthy, checks, latency } = await runHealthChecks({ external: true });
    const hasOpenCircuit = checks._circuitOpen === true;
    delete checks._circuitOpen;
    res.status(healthy ? 200 : 503).json({
      status:  healthy ? 'ok' : (hasOpenCircuit ? 'degraded' : 'error'),
      service: serviceName,
      version: process.env.APP_VERSION || '1.0.0',
      uptime:  Math.floor(process.uptime()),
      ts:      new Date().toISOString(),
      traceId: req.traceId || req.headers['x-trace-id'] || null,
      checks,
      latency,
    });
  });

  app.get('/health/live', (_req, res) => {
    res.status(200).json({
      status:  'ok',
      service: serviceName,
      ts:      new Date().toISOString(),
    });
  });

  app.get('/health/ready', async (req, res) => {
    const { healthy, checks, latency } = await runHealthChecks();
    res.status(healthy ? 200 : 503).json({
      status:  healthy ? 'ready' : 'not_ready',
      service: serviceName,
      ts:      new Date().toISOString(),
      checks,
      latency,
      traceId: req.traceId || req.headers['x-trace-id'] || null,
    });
  });

  app.get('/metrics', (req, res, next) => {
    if (!metricsToken) return next();
    if (req.get('authorization') !== `Bearer ${metricsToken}`) {
      return res.status(401).json({ success: false, error: { message: 'Unauthorized', code: 'METRICS_AUTH_REQUIRED' } });
    }
    return next();
  }, metricsHandler);

  function logNotFound(req, err) {
    log.warn('Route not found', {
      service: serviceName,
      method: req.method,
      originalUrl: req.originalUrl,
      baseUrl: req.baseUrl,
      path: req.path,
      requestId: req.requestId || req.headers['x-request-id'] || null,
      userId: req.user?.userId || req.user?.id || null,
      error: err?.message || 'not found',
    });
  }

  function isNotFoundLike(err) {
    return err?.status === 404
      || err?.statusCode === 404
      || err?.name === 'NotFoundError'
      || err?.code === 'NOT_FOUND'
      || /(^|\s)not found(\s|$)/i.test(err?.message || '');
  }

  routesFn(app, requirePerm);

  const customErrorHandlers = Array.isArray(opts.errorHandlers)
    ? opts.errorHandlers
    : (opts.errorHandlers ? [opts.errorHandlers] : []);
  for (const errorHandler of customErrorHandlers) {
    app.use(errorHandler);
  }

  // 404
  app.use((req, res) =>
    res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found',
        path: req.originalUrl,
        method: req.method,
        ...(req.requestId ? { requestId: req.requestId } : {}),
        ...(req.traceId ? { traceId: req.traceId } : {}),
      },
    })
  );

  // AppError handler — convierte errores tipados a responses estándar
  app.use(appErrorHandler);

  // Error handler — nunca filtrar stack traces ni queries SQL en producción
  app.use((err, req, res, _next) => {
    const isProd = process.env.NODE_ENV === 'production';
    const explicitStatus = Number(err.httpStatus || err.http || err.status || err.statusCode || 0) || null;
    log.error(err.message, { stack: err.stack, traceId: req.traceId || req.headers['x-trace-id'] });

    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Invalid JSON body',
          code: 'VAL_008',
          ...(req.requestId ? { requestId: req.requestId } : {}),
          ...(req.traceId ? { traceId: req.traceId } : {}),
        },
      });
    }

    if (isNotFoundLike(err)) {
      logNotFound(req, err);
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Route not found',
          path: req.originalUrl,
          method: req.method,
          ...(req.requestId ? { requestId: req.requestId } : {}),
          ...(req.traceId ? { traceId: req.traceId } : {}),
        },
      });
    }

    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        success: false,
        error: {
          message: 'Duplicate entry',
          code: 'DUPLICATE_ENTRY',
          ...(req.requestId ? { requestId: req.requestId } : {}),
          ...(req.traceId ? { traceId: req.traceId } : {}),
        },
      });
    }
    if (err.code === 'ER_NO_REFERENCED_ROW_2') {
      return res.status(422).json({
        success: false,
        error: {
          message: 'Referenced resource not found',
          code: 'FK_VIOLATION',
          ...(req.requestId ? { requestId: req.requestId } : {}),
          ...(req.traceId ? { traceId: req.traceId } : {}),
        },
      });
    }

    if (explicitStatus && explicitStatus >= 400 && explicitStatus < 500) {
      return res.status(explicitStatus).json({
        success: false,
        error: {
          message: err.message || 'Request failed',
          code: err.code || (explicitStatus === 401 ? 'UNAUTHORIZED' : explicitStatus === 403 ? 'FORBIDDEN' : explicitStatus === 404 ? 'NOT_FOUND' : 'REQUEST_ERROR'),
          ...(req.requestId ? { requestId: req.requestId } : {}),
          ...(req.traceId ? { traceId: req.traceId } : {}),
        },
      });
    }

    const message = isProd ? 'Internal server error' : (err.message || 'Internal server error');
    res.status(explicitStatus && explicitStatus >= 500 ? explicitStatus : 500).json({
      success: false,
      error: {
        message,
        code: err.code || 'INTERNAL_ERROR',
        ...(req.requestId ? { requestId: req.requestId } : {}),
        ...(req.traceId ? { traceId: req.traceId } : {}),
      },
    });
  });

  return app;
}

/**
 * Start a service with graceful shutdown.
 * Handles SIGTERM + SIGINT: stops accepting new requests, waits for in-flight
 * requests, then closes DB pool and exits cleanly.
 *
 * @param {Express} app
 * @param {string}  serviceName
 * @param {number}  port
 * @param {object}  [opts]
 * @param {number}  [opts.drainMs=10000]  Max ms to wait for in-flight requests
 * @returns {http.Server}
 */
function startService(app, serviceName, port, { drainMs = 10_000, onStarted = null, onShutdown = null } = {}) {
  const http   = require('http');
  const log    = createLogger(serviceName);
  validateCriticalEnv(log);
  const server = http.createServer(app);
  const registryIntervalMs = Math.max(15000, parseInt(process.env.SERVICE_REGISTRY_HEARTBEAT_MS || '20000', 10));
  let registryTimer = null;
  let startupState = null;

  server.listen(port, async () => {
    log.info(`${serviceName} running on port ${port}`, { env: process.env.NODE_ENV });

    // OT-083: run index verification in background at startup (non-blocking)
    try {
      const db = require('./db');
      db.verifyIndexes().catch(() => {}); // fire-and-forget, warnings logged inside
    } catch (_) { /* db not available in all services */ }

    if (typeof onStarted === 'function') {
      try {
        startupState = await onStarted({ server, port, serviceName, log });
      } catch (error) {
        log.error('Service startup hook failed', { error: error.message });
      }
    }
  });

  async function heartbeat() {
    try {
      const { registerService } = require('./serviceRegistry');
      const serviceUrl = process.env.SERVICE_PUBLIC_URL || `http://localhost:${port}`;
      await registerService(serviceName, {
        url: serviceUrl,
        healthUrl: `${serviceUrl}/health/ready`,
        instanceId: process.env.SERVICE_INSTANCE_ID || process.env.HOSTNAME || `${serviceName}-${process.pid}`,
        weight: parseInt(process.env.SERVICE_INSTANCE_WEIGHT || '1', 10),
        zone: process.env.SERVICE_INSTANCE_ZONE || process.env.RAILWAY_REGION || process.env.AWS_REGION || null,
        pid: process.pid,
        env: process.env.NODE_ENV || 'development',
      });
    } catch (error) {
      log.warn('Service registry heartbeat failed', { error: error.message });
    }
  }

  heartbeat().catch(() => {});
  registryTimer = setInterval(() => {
    heartbeat().catch(() => {});
  }, registryIntervalMs);

  function shutdown(signal) {
    if (registryTimer) clearInterval(registryTimer);
    log.info(`${signal} received — starting graceful shutdown`);

    // Stop accepting new connections
    server.close(async () => {
      log.info('HTTP server closed — draining resources');

      if (typeof onShutdown === 'function') {
        try {
          await onShutdown({ server, port, serviceName, log, startupState });
        } catch (error) {
          log.warn('Custom shutdown hook failed', { error: error.message });
        }
      }

      // Close DB pool
      try {
        const db = require('./db');
        await db.getPool().end();
        log.info('DB pool closed');
      } catch (error) {
        log.warn('DB pool close skipped or failed', { error: error.message });
      }

      // Disconnect Redis client
      try {
        const cache = require('./cache');
        const redis = await cache.getClient();
        await redis.quit();
        log.info('Redis connection closed');
      } catch (error) {
        log.warn('Redis close skipped or failed', { error: error.message });
      }

      log.info('Graceful shutdown complete');
      process.exit(0);
    });

    // Force exit if drain takes too long
    setTimeout(() => {
      log.error('Graceful shutdown timed out — forcing exit');
      process.exit(1);
    }, drainMs).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    // Log fuerte pero NO matar el proceso: con express-async-errors los errores de ruta
    // ya se capturan; una promesa background suelta no debe tumbar a todos los usuarios.
    // El orquestador (Railway) reinicia ante crashes reales (uncaughtException).
    log.error('Unhandled rejection (proceso continúa)', { reason: String(reason?.stack || reason?.message || reason) });
  });
  // uncaughtException sí es fatal: estado indefinido -> salir y dejar que el orquestador reinicie.
  process.on('uncaughtException', (err) => {
    log.error('Uncaught exception — exiting process', { error: String(err?.stack || err?.message || err) });
    process.exit(1);
  });

  return server;
}

module.exports = { buildApp, fromHeaders, requirePerm, guardWrite, startService, withOpenApiValidation, registerHealthChecker };
