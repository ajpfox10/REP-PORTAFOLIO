'use strict';

/**
 * Internal service-to-service authentication.
 *
 * Header: X-Internal-Sig: t={timestamp}.n={nonce}.s={hmac}
 * The signature binds routing, tenant and propagated user identity.
 */

const { createHmac, randomBytes, timingSafeEqual } = require('crypto');
const { createLogger } = require('./logger');
const { getSecret } = require('./secrets');
let _redis = null;
async function _getRedis() {
  if (!_redis) {
    try { _redis = await require('./redis').getRedisSingleton('internal-auth', 'internal-auth'); } catch { _redis = null; }
  }
  return _redis;
}
const {
  getDependencyMode,
  recordDependencyDegradation,
  logDependencyIssue,
  dependencyFailureResponse,
} = require('./dependencyPolicy');

const log = createLogger('internal-auth');

const _secret = () => getSecret('INTERNAL_SECRET', { defaultValue: '' }) || '';
const _ttl = () => parseInt(process.env.INTERNAL_SIG_TTL_S || '30', 10);
const HEADER = 'x-internal-sig';
const VALIDATED_MARK = Symbol.for('andromeda.internalAuth.validated');
const SIGNED_IDENTITY_HEADERS = [
  'x-user-id',
  'x-user-email',
  'x-user-roles',
  'x-user-permissions',
  'x-branch-id',
  'x-jti',
  'x-auth-type',
  'x-api-key-scopes',
];

let _warnedOnce = false;

function getInternalAuthMode() {
  return getDependencyMode('internal_auth', process.env.NODE_ENV === 'production' ? 'strict' : 'open');
}

function _warn() {
  if (!_warnedOnce && process.env.NODE_ENV !== 'test') {
    log.warn('INTERNAL_SECRET not set - service-to-service auth degraded', { mode: getInternalAuthMode() });
    _warnedOnce = true;
  }
}

function _identityContext(headers = {}) {
  const normalized = {};
  for (const [key, value] of Object.entries(headers || {})) {
    normalized[String(key).toLowerCase()] = Array.isArray(value) ? value.join(',') : String(value ?? '');
  }
  return SIGNED_IDENTITY_HEADERS
    .map((header) => `${header}=${normalized[header] || ''}`)
    .join('&');
}

function _message(method, path, timestamp, orgId, nonce, identityHeaders = {}) {
  return `${method.toUpperCase()}:${path}:${timestamp}:${orgId || ''}:${nonce}:${_identityContext(identityHeaders)}`;
}

function signRequest(method, path, orgId, identityHeaders = {}) {
  const secret = _secret();
  if (!secret) return '';
  const t = Math.floor(Date.now() / 1000).toString();
  const n = randomBytes(16).toString('hex');
  const msg = _message(method, path, t, orgId, n, identityHeaders);
  const sig = createHmac('sha256', secret).update(msg).digest('hex');
  return `t=${t}.n=${n}.s=${sig}`;
}

function verifySignature(method, path, orgId, headerValue, identityHeaders = {}) {
  const secret = _secret();
  if (!secret) {
    const mode = getInternalAuthMode();
    _warn();
    recordDependencyDegradation('internal_auth', mode, mode === 'strict' ? 'blocked' : 'degraded', { service: 'shared' });
    if (mode === 'strict') return { ok: false, reason: 'missing_secret' };
    return { ok: true };
  }

  if (!headerValue) return { ok: false, reason: 'missing_header' };

  const match = headerValue.match(/^t=(\d+)\.n=([0-9a-f]+)\.s=([0-9a-f]+)$/);
  if (!match) return { ok: false, reason: 'malformed_header' };

  const [, t, nonce, sig] = match;
  const age = Math.floor(Date.now() / 1000) - parseInt(t, 10);
  if (age > _ttl() || age < -5) return { ok: false, reason: 'expired' };

  const expected = createHmac('sha256', secret)
    .update(_message(method, path, t, orgId, nonce, identityHeaders))
    .digest('hex');

  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return { ok: false, reason: 'invalid_signature' };
  if (!timingSafeEqual(a, b)) return { ok: false, reason: 'invalid_signature' };

  return { ok: true, _nonce: headerValue };
}

async function requireInternalSig(req, res, next) {
  if (!_secret() && getInternalAuthMode() !== 'strict') {
    _warn();
    return next();
  }

  const orgId = req.headers['x-org-id'] || '';
  const headerValue = req.headers[HEADER] || '';
  const validationPath = req.baseUrl + req.path;
  const identityContext = _identityContext(req.headers);
  const priorValidation = req[VALIDATED_MARK];
  if (
    priorValidation
    && priorValidation.method === req.method
    && priorValidation.path === validationPath
    && priorValidation.orgId === orgId
    && priorValidation.headerValue === headerValue
    && priorValidation.identityContext === identityContext
  ) {
    return next();
  }

  const result = verifySignature(
    req.method,
    validationPath,
    orgId,
    headerValue,
    req.headers
  );
  const { ok, reason } = result;

  if (ok && result._nonce) {
    // BUG-1: nonce store para prevenir replay dentro de la ventana TTL
    const ttl = _ttl() + 5;
    try {
      const redis = await _getRedis();
      if (redis) {
        const stored = await redis.set(`iauth:nonce:${result._nonce}`, '1', { NX: true, EX: ttl });
        if (stored === null) {
          log.warn('internal-auth: nonce replay detectado', { nonce: result._nonce, path: req.originalUrl });
          return res.status(401).json({
            success: false,
            error: { message: 'Unauthorized', code: 'INTERNAL_AUTH_REPLAY' },
          });
        }
      }
    } catch (redisErr) {
      log.warn('internal-auth: nonce Redis check failed', { err: redisErr.message });
    }
  }

  if (!ok) {
    if (reason === 'missing_secret') {
      logDependencyIssue(log, 'internal_auth', getInternalAuthMode(), 'Internal auth unavailable - rejecting request', null, {
        path: req.originalUrl,
        traceId: req.traceId,
        requestId: req.requestId,
      });
      return dependencyFailureResponse(res, {
        statusCode: 503,
        message: 'Internal authentication unavailable',
        code: 'INTERNAL_AUTH_UNAVAILABLE',
        details: { reason },
      });
    }

    // BUG-021: no exponer reason al cliente (información útil para atacantes)
    log.warn('internal-auth: signature validation failed', { reason, path: req.originalUrl });
    return res.status(401).json({
      success: false,
      error: { message: 'Unauthorized', code: 'INTERNAL_AUTH_FAILED' },
    });
  }

  req[VALIDATED_MARK] = {
    method: req.method,
    path: validationPath,
    orgId,
    headerValue,
    identityContext,
  };

  next();
}

module.exports = {
  signRequest,
  verifySignature,
  requireInternalSig,
  HEADER,
  getInternalAuthMode,
  SIGNED_IDENTITY_HEADERS,
};
