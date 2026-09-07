'use strict';

const crypto = require('crypto');
const { createLogger } = require('./logger');

const log = createLogger('tracing');

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

function parseTraceparent(value) {
  if (!value || typeof value !== 'string') return null;
  const match = value.trim().match(/^([\da-f]{2})-([\da-f]{32})-([\da-f]{16})-([\da-f]{2})$/i);
  if (!match) return null;
  return {
    version: match[1].toLowerCase(),
    traceId: match[2].toLowerCase(),
    parentSpanId: match[3].toLowerCase(),
    flags: match[4].toLowerCase(),
  };
}

function buildTraceparent({ traceId, spanId, flags = '01' }) {
  return `00-${traceId}-${spanId}-${flags}`;
}

function createTraceContext(headers = {}) {
  const parsed = parseTraceparent(headers.traceparent || headers.Traceparent || headers['traceparent']);
  const traceId = parsed?.traceId || randomHex(16);
  const parentSpanId = parsed?.parentSpanId || null;
  const spanId = randomHex(8);
  const flags = parsed?.flags || '01';
  return {
    traceId,
    spanId,
    parentSpanId,
    flags,
    traceparent: buildTraceparent({ traceId, spanId, flags }),
  };
}

function tracingMiddleware(serviceName = 'unknown') {
  return function tracing(req, res, next) {
    const context = createTraceContext(req.headers);
    req.traceId = req.traceId || context.traceId;
    req.spanId = context.spanId;
    req.parentSpanId = context.parentSpanId;
    req.traceparent = context.traceparent;
    req.headers.traceparent = context.traceparent;
    req.headers['x-trace-id'] = req.traceId;
    req._traceStartedAt = process.hrtime.bigint();

    res.locals.traceId = req.traceId;
    res.locals.spanId = req.spanId;
    res.setHeader('traceparent', context.traceparent);
    res.setHeader('X-Trace-Id', req.traceId);

    res.on('finish', () => {
      exportServerSpan({
        serviceName,
        req,
        res,
        startedAt: req._traceStartedAt,
      }).catch(() => {});
    });

    next();
  };
}

function buildZipkinEndpoint(serviceName) {
  return {
    serviceName,
    ipv4: process.env.TRACING_SERVICE_IPV4 || undefined,
  };
}

function shouldExportTraces() {
  return String(process.env.TRACING_ENABLED || 'false').toLowerCase() === 'true'
    && Boolean(process.env.TRACING_EXPORTER_URL);
}

async function exportZipkinSpan(span) {
  if (!shouldExportTraces()) return;
  const endpoint = process.env.TRACING_EXPORTER_URL;
  try {
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([span]),
      signal: AbortSignal.timeout(parseInt(process.env.TRACING_EXPORT_TIMEOUT_MS || '1500', 10)),
    });
  } catch (err) {
    log.warn('Trace export failed', { message: err.message, endpoint });
  }
}

function toMicros(startedAt, durationNs) {
  const nowMs = Date.now();
  const durationMicros = Math.max(1, Math.round(Number(durationNs) / 1000));
  const startMicros = Math.max(1, Math.round(nowMs * 1000) - durationMicros);
  return { startMicros, durationMicros };
}

async function exportServerSpan({ serviceName, req, res, startedAt }) {
  const durationNs = process.hrtime.bigint() - startedAt;
  const { startMicros, durationMicros } = toMicros(startedAt, durationNs);
  return exportZipkinSpan({
    traceId: req.traceId,
    id: req.spanId,
    parentId: req.parentSpanId || undefined,
    name: `${req.method} ${req.route?.path || req.path || req.originalUrl || '/'}`,
    kind: 'SERVER',
    timestamp: startMicros,
    duration: durationMicros,
    localEndpoint: buildZipkinEndpoint(serviceName),
    tags: {
      'http.method': req.method,
      'http.path': req.originalUrl || req.path || '/',
      'http.status_code': String(res.statusCode),
      'request.id': req.requestId || '',
      'tenant.org_id': req.user?.orgId || req.headers['x-org-id'] || '',
    },
  });
}

async function exportClientSpan({
  serviceName = 'unknown',
  operation,
  targetService,
  traceId,
  parentSpanId,
  startedAt,
  statusCode,
  error,
  tags = {},
}) {
  const durationNs = process.hrtime.bigint() - startedAt;
  const { startMicros, durationMicros } = toMicros(startedAt, durationNs);
  return exportZipkinSpan({
    traceId,
    id: randomHex(8),
    parentId: parentSpanId || undefined,
    name: operation,
    kind: 'CLIENT',
    timestamp: startMicros,
    duration: durationMicros,
    localEndpoint: buildZipkinEndpoint(serviceName),
    remoteEndpoint: buildZipkinEndpoint(targetService || 'upstream'),
    tags: {
      'http.status_code': statusCode ? String(statusCode) : '',
      error: error?.message || '',
      ...tags,
    },
  });
}

function buildOutgoingTraceHeaders(reqOrContext = {}, extraHeaders = {}) {
  const traceId = reqOrContext.traceId || randomHex(16);
  const parentSpanId = reqOrContext.spanId || null;
  const spanId = randomHex(8);
  return {
    ...extraHeaders,
    traceparent: buildTraceparent({ traceId, spanId, flags: '01' }),
    'X-Trace-Id': traceId,
    'X-Parent-Span-Id': parentSpanId || '',
    'X-Span-Id': spanId,
  };
}

module.exports = {
  parseTraceparent,
  buildTraceparent,
  createTraceContext,
  tracingMiddleware,
  exportClientSpan,
  buildOutgoingTraceHeaders,
};
