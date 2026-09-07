'use strict';

const { verifyAccess } = require('../../../shared/jwt');
const { getRedisSingleton } = require('../../../shared/redis');
const { callInternalService, buildSignedInternalHeaders } = require('../../../shared/internalService');
const {
  getDependencyMode,
  recordDependencyDegradation,
  logDependencyIssue,
  dependencyFailureResponse,
} = require('../../../shared/dependencyPolicy');
const { logger } = require('./logger');
const { checkDeviceFingerprint } = require('../../../shared/deviceFingerprint');
const R = require('../../../shared/response');

async function getRedis() {
  return getRedisSingleton('gateway-auth', 'gateway-auth');
}

function getRevocationMode() {
  return getDependencyMode(
    'auth_revocation',
    process.env.NODE_ENV === 'production' ? 'strict' : 'degraded'
  );
}

function extractToken(req) {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  if (req.cookies?.accessToken) return req.cookies.accessToken;
  return null;
}

async function authenticate(req, res, next) {
  const token = extractToken(req);
  if (!token) return R.unauthorized(res, 'Missing authorization token', 'AUTH_001');

  let decoded;
  try {
    decoded = verifyAccess(token);
  } catch (err) {
    const msg = err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token';
    return R.unauthorized(res, msg, err.name === 'TokenExpiredError' ? 'AUTH_003' : 'AUTH_002');
  }

  // Defense in depth: pending 2FA and refresh tokens must never reach protected routes.
  if (decoded.tokenType !== 'access' || decoded.scope === '2fa_pending') {
    return R.unauthorized(res, 'Invalid token', 'AUTH_002');
  }

  if (!decoded.jti) return R.unauthorized(res, 'Token missing identifier', 'AUTH_005');

  if (decoded.jti) {
    const revocationMode = getRevocationMode();
    try {
      const redis = await getRedis();
      if (redis.isReady) {
        const revoked = await redis.get(`revoked:${decoded.jti}`);
        if (revoked) return R.unauthorized(res, 'Token has been revoked', 'AUTH_004');
      } else if (revocationMode === 'strict') {
        recordDependencyDegradation('auth_revocation', revocationMode, 'blocked', { service: 'gateway' });
        return dependencyFailureResponse(res, {
          statusCode: 503,
          message: 'Token revocation backend unavailable',
          code: 'AUTH_013',
        });
      }
    } catch (err) {
      recordDependencyDegradation('auth_revocation', revocationMode, revocationMode === 'strict' ? 'blocked' : 'degraded', { service: 'gateway' });
      logDependencyIssue(logger, 'auth_revocation', revocationMode, 'Redis revocation check failed', err, { traceId: req.traceId });
      if (revocationMode === 'strict') {
        return dependencyFailureResponse(res, {
          statusCode: 503,
          message: 'Token revocation backend unavailable',
          code: 'AUTH_013',
        });
      }
    }
  }

  req.user = decoded;
  req.token = token;
  return checkDeviceFingerprint(req, res, next);
}

async function authenticateApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return next();

  // Validar longitud mínima para evitar llamadas internas con valores triviales
  if (typeof apiKey !== 'string' || apiKey.length < 16) {
    return R.unauthorized(res, 'Invalid API key', 'AUTH_012');
  }

  let networkError = false;
  try {
    const path = '/internal/validate-api-key';
    // El API key se envía como header X-Api-Key-Value en vez de en el body
    // para evitar que sea capturado en logs de body por el servicio interno.
    const response = await callInternalService('auth', {
      method: 'POST',
      path,
      body: {},
      headers: {
        'X-Trace-Id':    req.traceId || '',
        'X-Api-Key-Value': apiKey,
        ...buildSignedInternalHeaders('POST', path, ''),
      },
      traceContext: { traceId: req.traceId, spanId: req.spanId, serviceName: 'gateway' },
      timeoutMs: 3000,
    });

    if (response.ok) {
      const { data } = await response.json();
      req.user = data;
      req.isApiKey = true;
      return next();
    }

    // El servicio auth respondió pero rechazó la clave → 401
    return R.unauthorized(res, 'Invalid API key', 'AUTH_012');
  } catch (err) {
    networkError = true;
    logger.error('API key validation error', { error: err.message, traceId: req.traceId });
  }

  // Error de red/timeout → 503 para no confundir con credenciales incorrectas
  if (networkError) {
    return res.status(503).json({
      success: false,
      error: { message: 'Authentication service temporarily unavailable', code: 'AUTH_014' },
    });
  }

  return R.unauthorized(res, 'Invalid API key', 'AUTH_012');
}

async function authMiddleware(req, res, next) {
  if (req.headers['x-api-key']) return authenticateApiKey(req, res, next);
  return authenticate(req, res, next);
}

async function optionalAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) return next();
  try {
    const decoded = verifyAccess(token);
    if (decoded.tokenType !== 'access' || decoded.scope === '2fa_pending') return next();
    if (decoded.jti) {
      try {
        const redis = await getRedis();
        if (redis.isReady) {
          const revoked = await redis.get(`revoked:${decoded.jti}`);
          if (!revoked) req.user = decoded;
        } else {
          req.user = decoded;
        }
      } catch (err) {
        logDependencyIssue(logger, 'auth_revocation', getRevocationMode(), 'optionalAuth revocation check failed', err, {});
        req.user = decoded;
      }
    }
    // Tokens sin jti no se aceptan en optionalAuth — no hay forma de revocarlos.
  } catch (_) {}
  next();
}

/**
 * OT-103: Gateway-level permission enforcement (defense-in-depth).
 * Downstream services also enforce permissions via requirePerm, but this
 * prevents even reaching them when the user clearly lacks the base permission.
 *
 * Checks req.user.permissions (expanded in JWT) and supports wildcards:
 *   'resource:*'  → any action on that resource
 *   '*'           → all permissions (superadmin)
 *
 * Must be placed AFTER authMiddleware so req.user is populated.
 *
 * @param {string} perm — e.g. 'reports:read', 'users:*', 'audit:read'
 */
function requireGatewayPerm(perm) {
  return (req, res, next) => {
    const perms = req.user?.permissions;
    if (!Array.isArray(perms)) return R.forbidden(res, 'Insufficient gateway permissions', 'AUTH_PERM_DENIED');

    if (perms.includes('*') || perms.includes(perm)) return next();

    const [resource] = perm.split(':');
    if (perms.includes(`${resource}:*`)) return next();

    return R.forbidden(res, 'Insufficient gateway permissions', 'AUTH_PERM_DENIED');
  };
}

module.exports = { authMiddleware, authenticate, optionalAuth, getRedis, requireGatewayPerm };
