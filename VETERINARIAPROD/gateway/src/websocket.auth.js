'use strict';

const { verifyAccess } = require('../../shared/jwt');
const { getRedisSingleton } = require('../../shared/redis');
const {
  getDependencyMode,
  recordDependencyDegradation,
  logDependencyIssue,
} = require('../../shared/dependencyPolicy');
const { logger } = require('./middleware/logger');
const { extractSlug, resolveSlug } = require('./middleware/subdomain');

function isAllowedOrigin(origin) {
  if (!origin) return false;

  const allowedRaw = process.env.ALLOWED_ORIGINS || '';

  if (process.env.NODE_ENV !== 'production') {
    try {
      const { hostname } = new URL(origin);
      if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
    } catch (error) {
      logger.warn('WS: invalid origin URL', { origin, error: error?.message });
      return false;
    }
  }

  if (!allowedRaw) return false;

  const allowed = allowedRaw.split(',').map((o) => o.trim().toLowerCase()).filter(Boolean);
  const originLower = origin.toLowerCase().replace(/\/$/, '');
  return allowed.some((a) => originLower === a);
}

function readCookie(req, name) {
  const header = req.headers?.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [rawKey, ...rest] = part.trim().split('=');
    if (rawKey === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function getTokenFromRequest(req) {
  const header = req.headers['authorization'];
  if (header?.startsWith('Bearer ')) return header.slice(7);

  const cookieToken = readCookie(req, 'accessToken');
  if (cookieToken) return cookieToken;

  if (process.env.NODE_ENV === 'production') return null;
  try {
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    // Log the path without the query string to avoid token leakage in log files
    if (token) {
      logger.debug('WS: token extracted from query string (dev only)', { path: url.pathname });
      return token;
    }
  } catch (error) {
    logger.warn('WS: failed parsing request URL for token fallback', { error: error?.message, path: req.url?.split('?')[0] });
  }

  return null;
}

function getRevocationMode() {
  return getDependencyMode(
    'auth_revocation',
    process.env.NODE_ENV === 'production' ? 'strict' : 'degraded'
  );
}

async function verifyWsRequest(req) {
  const origin = req.headers.origin;
  if (!isAllowedOrigin(origin)) {
    return {
      ok: false,
      code: 4003,
      reason: 'Origin not allowed',
      log: { message: 'WS: connection rejected - invalid origin', meta: { origin, ip: req.socket.remoteAddress } },
    };
  }

  const token = getTokenFromRequest(req);
  if (!token) {
    return {
      ok: false,
      code: 4001,
      reason: 'Missing token',
      log: { message: 'WS: connection rejected - missing token', meta: { origin, ip: req.socket.remoteAddress } },
    };
  }

  let user;
  try {
    user = verifyAccess(token);
  } catch (error) {
    return {
      ok: false,
      code: 4001,
      reason: 'Invalid or expired token',
      log: { message: 'WS: connection rejected - invalid token', meta: { error: error?.message, ip: req.socket.remoteAddress } },
    };
  }

  if (user.jti) {
    const revocationMode = getRevocationMode();
    try {
      const revokeCheck = await getRedisSingleton('gateway-auth', 'gateway-auth');
      if (!revokeCheck.isReady) {
        if (revocationMode === 'strict') {
          recordDependencyDegradation('auth_revocation', revocationMode, 'blocked', { service: 'gateway-ws' });
          return {
            ok: false,
            code: 1013,
            reason: 'Token revocation backend unavailable',
            log: { message: 'WS: connection rejected - revocation backend unavailable', meta: { userId: user.userId } },
          };
        }
        return { ok: true, user };
      }
      const revoked = await revokeCheck.get(`revoked:${user.jti}`);
      if (revoked) {
        return {
          ok: false,
          code: 4001,
          reason: 'Token revoked',
          log: { message: 'WS: connection rejected - revoked token', meta: { userId: user.userId } },
        };
      }
    } catch (error) {
      recordDependencyDegradation('auth_revocation', revocationMode, revocationMode === 'strict' ? 'blocked' : 'degraded', { service: 'gateway-ws' });
      logDependencyIssue(logger, 'auth_revocation', revocationMode, 'WS: revocation check failed', error, { userId: user.userId });
      if (revocationMode === 'strict') {
        return {
          ok: false,
          code: 1013,
          reason: 'Token revocation backend unavailable',
          log: { message: 'WS: connection rejected - revocation check failed', meta: { userId: user.userId } },
        };
      }
    }
  }

  if (origin) {
    try {
      const { hostname } = new URL(origin);
      const slug = extractSlug(hostname);
      if (slug) {
        const tenantOrgId = await resolveSlug(slug);
        if (!tenantOrgId) {
          return {
            ok: false,
            code: 1013,
            reason: 'Tenant temporarily unavailable',
            log: { message: 'WS: connection rejected - tenant resolution failed', meta: { slug, userId: user.userId } },
          };
        }
        if (!user.roles?.includes('superadmin') && String(user.orgId) !== String(tenantOrgId)) {
          return {
            ok: false,
            code: 4003,
            reason: 'Token does not belong to this tenant',
            log: { message: 'WS: connection rejected - tenant mismatch', meta: { slug, userOrgId: user.orgId, tenantOrgId } },
          };
        }
      }
    } catch (error) {
      logger.warn('WS: tenant validation error — continuing', { error: error?.message, origin });
    }
  }

  return { ok: true, user };
}

module.exports = {
  isAllowedOrigin,
  getTokenFromRequest,
  verifyWsRequest,
};
