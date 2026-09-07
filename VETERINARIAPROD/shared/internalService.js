'use strict';

const { HEADER: INTERNAL_SIG_HEADER, signRequest } = require('./internalAuth');
const { resolveRuntimeServiceTarget } = require('./serviceTargets');
const { buildOutgoingTraceHeaders, exportClientSpan } = require('./tracing');

const RETRYABLE_ERRORS = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT']);
const MAX_RETRIES = parseInt(process.env.INTERNAL_SERVICE_MAX_RETRIES || '3', 10);
const RETRY_BASE_DELAY_MS = parseInt(process.env.INTERNAL_SERVICE_RETRY_BASE_MS || '100', 10);

function isRetryable(error, status) {
  if (status && status < 500) return false;
  if (status === 501 || status === 505) return false;
  if (error?.name === 'TimeoutError') return false;
  return !status || RETRYABLE_ERRORS.has(error?.cause?.code || error?.code || '');
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callInternalService(serviceName, { method, path, body = null, headers = {}, timeoutMs = 3000, traceContext = null, retries = MAX_RETRIES, orgId = null }) {
  const target = await resolveRuntimeServiceTarget(serviceName);
  const startedAt = process.hrtime.bigint();
  // SEC: firmar automáticamente todas las solicitudes internas con HMAC para que
  // los servicios destino puedan verificar que la llamada viene de un servicio legítimo.
  const internalAuthHeader = {
    [INTERNAL_SIG_HEADER]: signRequest(method.toUpperCase(), path, orgId || '', headers),
  };
  const requestHeaders = {
    'Content-Type': 'application/json',
    ...buildOutgoingTraceHeaders(traceContext || headers, {}),
    ...internalAuthHeader,
    ...headers,  // headers explícitos del caller tienen precedencia
  };

  // Always replace any caller-provided signature with one generated for the
  // final request context.
  requestHeaders[INTERNAL_SIG_HEADER] = internalAuthHeader[INTERNAL_SIG_HEADER];

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1) * (0.5 + Math.random() * 0.5);
      await sleep(delay);
    }
    try {
      const response = await fetch(`${target}${path}`, {
        method,
        headers: requestHeaders,
        body: body === null ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (attempt === retries || !isRetryable(null, response.status)) {
        exportClientSpan({
          serviceName: traceContext?.serviceName || 'internal-service',
          operation: `${method.toUpperCase()} ${path}`,
          targetService: serviceName,
          traceId: requestHeaders['X-Trace-Id'],
          parentSpanId: traceContext?.spanId || headers['X-Span-Id'] || null,
          startedAt,
          statusCode: response.status,
          tags: { 'http.url': `${target}${path}`, retryAttempt: attempt },
        }).catch(() => {});
        return response;
      }
      lastError = new Error(`Retryable HTTP ${response.status}`);
      lastError.status = response.status;
    } catch (error) {
      lastError = error;
      if (!isRetryable(error, null)) {
        exportClientSpan({
          serviceName: traceContext?.serviceName || 'internal-service',
          operation: `${method.toUpperCase()} ${path}`,
          targetService: serviceName,
          traceId: requestHeaders['X-Trace-Id'],
          parentSpanId: traceContext?.spanId || headers['X-Span-Id'] || null,
          startedAt,
          error,
          tags: { 'http.url': `${target}${path}`, retryAttempt: attempt },
        }).catch(() => {});
        throw error;
      }
    }
  }

  exportClientSpan({
    serviceName: traceContext?.serviceName || 'internal-service',
    operation: `${method.toUpperCase()} ${path}`,
    targetService: serviceName,
    traceId: requestHeaders['X-Trace-Id'],
    parentSpanId: traceContext?.spanId || headers['X-Span-Id'] || null,
    startedAt,
    error: lastError,
    tags: { 'http.url': `${target}${path}`, retryAttempt: retries },
  }).catch(() => {});
  throw lastError;
}

function buildSignedInternalHeaders(method, path, orgId, extraHeaders = {}) {
  return {
    ...extraHeaders,
    [INTERNAL_SIG_HEADER]: signRequest(method, path, orgId || '', extraHeaders),
  };
}

module.exports = {
  callInternalService,
  buildSignedInternalHeaders,
  INTERNAL_SIG_HEADER,
};
