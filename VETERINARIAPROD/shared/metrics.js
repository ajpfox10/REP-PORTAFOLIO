'use strict';

/**
 * Prometheus metrics — mirrors apipersonal observability stack.
 * Exposes: httpDuration, httpTotal, rbacDenials, activeConnections,
 *          dbQueryDuration, cacheHits/Misses, businessMetrics (patients, appointments, invoices)
 */

const client = require('prom-client');

// Enable default process metrics (CPU, memory, GC, event loop lag, etc.)
const register = new client.Registry();
client.collectDefaultMetrics({ register });

// ── HTTP metrics ──────────────────────────────────────────────────────────────
const httpRequestDuration = new client.Histogram({
  name:    'http_request_duration_seconds',
  help:    'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code', 'service'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

const httpRequestTotal = new client.Counter({
  name:    'http_requests_total',
  help:    'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code', 'service'],
  registers: [register],
});

const httpActiveRequests = new client.Gauge({
  name:    'http_active_requests',
  help:    'Number of active HTTP requests',
  labelNames: ['service'],
  registers: [register],
});

// ── RBAC metrics ──────────────────────────────────────────────────────────────
const rbacDenials = new client.Counter({
  name:    'rbac_denials_total',
  help:    'Total number of RBAC permission denials',
  labelNames: ['permission', 'role', 'service'],
  registers: [register],
});

// ── DB metrics ────────────────────────────────────────────────────────────────
const dbQueryDuration = new client.Histogram({
  name:    'db_query_duration_seconds',
  help:    'Duration of database queries in seconds',
  labelNames: ['operation', 'table'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
  registers: [register],
});

const dbConnectionPool = new client.Gauge({
  name:    'db_connection_pool_size',
  help:    'Current database connection pool size',
  labelNames: ['state'],   // 'active' | 'idle' | 'waiting'
  registers: [register],
});

// ── Cache metrics ─────────────────────────────────────────────────────────────
const cacheHits = new client.Counter({
  name:    'cache_hits_total',
  help:    'Total cache hits',
  labelNames: ['key_prefix'],
  registers: [register],
});

const cacheMisses = new client.Counter({
  name:    'cache_misses_total',
  help:    'Total cache misses',
  labelNames: ['key_prefix'],
  registers: [register],
});

// ── Auth metrics ──────────────────────────────────────────────────────────────
const authAttempts = new client.Counter({
  name:    'auth_attempts_total',
  help:    'Total authentication attempts',
  labelNames: ['result'],   // 'success' | 'failure' | 'locked'
  registers: [register],
});

const activeTokens = new client.Gauge({
  name:    'active_refresh_tokens',
  help:    'Approximate number of active refresh tokens',
  registers: [register],
});

// ── Business metrics ──────────────────────────────────────────────────────────
const patientsCreated = new client.Counter({
  name:    'vet_patients_created_total',
  help:    'Total patients registered',
  labelNames: ['org_id'],
  registers: [register],
});

const appointmentsBooked = new client.Counter({
  name:    'vet_appointments_booked_total',
  help:    'Total appointments booked',
  labelNames: ['org_id', 'service_type'],
  registers: [register],
});

const invoicesIssued = new client.Counter({
  name:    'vet_invoices_issued_total',
  help:    'Total invoices issued',
  labelNames: ['org_id'],
  registers: [register],
});

const invoiceAmount = new client.Counter({
  name:    'vet_invoice_amount_total',
  help:    'Total invoice amount (cents)',
  labelNames: ['org_id', 'currency'],
  registers: [register],
});

const webhookDeliveries = new client.Counter({
  name:    'webhook_deliveries_total',
  help:    'Total webhook delivery attempts',
  labelNames: ['event', 'result'],   // result: 'success' | 'failure'
  registers: [register],
});

const dependencyDegradations = new client.Counter({
  name:    'dependency_degradations_total',
  help:    'Total degraded/open/strict dependency outcomes',
  labelNames: ['dependency', 'mode', 'outcome', 'service'],
  registers: [register],
});

const eventBusMessages = new client.Counter({
  name:    'event_bus_messages_total',
  help:    'Total event bus publish/consume outcomes',
  labelNames: ['topic', 'direction', 'result'],
  registers: [register],
});

const serviceRegistryOperations = new client.Counter({
  name:    'service_registry_operations_total',
  help:    'Total service registry operations by result',
  labelNames: ['operation', 'result'],
  registers: [register],
});

// ── HTTP instrumentation middleware ───────────────────────────────────────────
/**
 * Express middleware that records HTTP request metrics.
 * @param {string} serviceName
 */
function httpMetrics(serviceName = 'unknown') {
  return function(req, res, next) {
    const start = process.hrtime.bigint();
    httpActiveRequests.inc({ service: serviceName });

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e9;
      // Normalise dynamic route segments to avoid cardinality explosion
      const route = normaliseRoute(req.route?.path || req.path || 'unknown');

      const labels = {
        method:      req.method,
        route,
        status_code: String(res.statusCode),
        service:     serviceName,
      };

      httpRequestDuration.observe(labels, durationMs);
      httpRequestTotal.inc(labels);
      httpActiveRequests.dec({ service: serviceName });
    });

    next();
  };
}

/** Normalise dynamic path segments to reduce Prometheus cardinality. */
function normaliseRoute(path) {
  return path
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:uuid') // UUIDs
    .replace(/\/\d+/g, '/:id')                   // numeric IDs
    .replace(/\/[A-Z0-9]{10,}/gi, '/:token');     // long tokens/hashes in path
}

// ── /metrics endpoint handler ─────────────────────────────────────────────────
/**
 * Expone las métricas de Prometheus.
 *
 * Seguridad:
 *   - METRICS_BEARER_TOKEN configurado → requiere Bearer token (preferido en producción).
 *   - METRICS_INTERNAL_ONLY=true       → solo permite IPs RFC-1918 + loopback.
 *   - Sin ninguna configuración en producción → bloquea con 403 y loguea advertencia.
 *   - En desarrollo sin configuración → permite acceso con advertencia en log.
 */
const METRICS_INTERNAL_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^::1$/,
];

function isInternalIp(ip) {
  const clean = (ip || '').replace('::ffff:', '');
  return METRICS_INTERNAL_RANGES.some((re) => re.test(clean));
}

async function metricsHandler(req, res) {
  const metricsToken = process.env.METRICS_BEARER_TOKEN;
  const internalOnly = process.env.METRICS_INTERNAL_ONLY === 'true';

  // Autenticación por Bearer token (máxima prioridad)
  if (metricsToken) {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) {
      res.status(401).set('WWW-Authenticate', 'Bearer').end('Unauthorized');
      return;
    }
    // Comparación timing-safe para evitar timing attack en el token
    const provided = Buffer.from(auth.slice(7));
    const expected = Buffer.from(metricsToken);
    const valid = provided.length === expected.length &&
      require('crypto').timingSafeEqual(provided, expected);
    if (!valid) {
      res.status(401).set('WWW-Authenticate', 'Bearer').end('Unauthorized');
      return;
    }
  } else if (internalOnly) {
    // Solo IPs internas (Prometheus scraper en la misma red)
    const ip = req.ip || req.socket?.remoteAddress || '';
    if (!isInternalIp(ip)) {
      res.status(403).end('Forbidden');
      return;
    }
  } else {
    // Sin ninguna protección configurada
    if (process.env.NODE_ENV === 'production') {
      // En producción: bloquear para evitar fuga de datos operacionales
      const log = require('./logger').createLogger('metrics');
      log.error('METRICS_BEARER_TOKEN o METRICS_INTERNAL_ONLY no configurados — endpoint /metrics bloqueado en producción');
      res.status(403).end('Forbidden: configure METRICS_BEARER_TOKEN or METRICS_INTERNAL_ONLY');
      return;
    }
    // En desarrollo: advertir pero permitir
    const log = require('./logger').createLogger('metrics');
    log.warn('ADVERTENCIA: /metrics expuesto sin autenticación. Configurá METRICS_BEARER_TOKEN en producción.');
  }

  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
}

module.exports = {
  register,
  // Metrics objects (for direct .inc/.observe in services)
  httpRequestDuration,
  httpRequestTotal,
  httpActiveRequests,
  rbacDenials,
  dbQueryDuration,
  dbConnectionPool,
  cacheHits,
  cacheMisses,
  authAttempts,
  activeTokens,
  patientsCreated,
  appointmentsBooked,
  invoicesIssued,
  invoiceAmount,
  webhookDeliveries,
  dependencyDegradations,
  eventBusMessages,
  serviceRegistryOperations,
  // Middleware
  httpMetrics,
  metricsHandler,
};
