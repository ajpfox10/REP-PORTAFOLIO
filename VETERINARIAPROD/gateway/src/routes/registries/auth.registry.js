'use strict';

const { authMiddleware, optionalAuth } = require('../../middleware/auth');
const { authLimiter, authBackoffLimiter, passwordResetLimiter, twoFaLimiter, tenantLimiter } = require('../../middleware/rateLimiter');
const { tenantMismatchGuard } = require('../../middleware/subdomain');
const { makeServiceProxy } = require('../proxy.factory');

const AUTH_PUBLIC = ['/captcha', '/login', '/refresh', '/logout', '/password-reset', '/2fa/challenge', '/google', '/sso', '/.well-known'];
// Ancla de límite de palabra (\b o /) para evitar que /api/v1/auth@evil.com
// coincida y deje "@evil.com/..." como path reescrito.
const STRIP_AUTH_PREFIX = (_path, req) => req.originalUrl.replace(/^\/api\/v[12]\/auth(?=\/|$|\?)/, '') || '/';

function blockPublicInternalAuth(req, res, next) {
  if (req.path === '/internal' || req.path.startsWith('/internal/')) {
    return res.status(404).json({
      success: false,
      error: { message: 'Not found', code: 'NOT_FOUND' },
    });
  }
  return next();
}

function registerAuthRoutes(app, registerVersioned) {
  // OT-105: authBackoffLimiter adds exponential backoff on top of the base authLimiter
  registerVersioned(app, 'use', 'auth/login', authBackoffLimiter, authLimiter);
  registerVersioned(app, 'use', 'auth/refresh', authLimiter);
  registerVersioned(app, 'use', 'auth/password-reset', passwordResetLimiter);
  registerVersioned(app, 'use', 'auth/2fa/challenge', twoFaLimiter);

  const authProxy = makeServiceProxy('auth', STRIP_AUTH_PREFIX);
  registerVersioned(app, 'use', 'auth', blockPublicInternalAuth);
  registerVersioned(app, 'use', 'auth/logout', optionalAuth, authProxy);
  registerVersioned(app, 'use', 'auth', (req, res, next) => {
    if (AUTH_PUBLIC.some((p) => req.path === p || req.path.startsWith(`${p}/`))) {
      return authProxy(req, res, next);
    }
    next();
  });
  registerVersioned(app, 'use', 'auth', authMiddleware, tenantMismatchGuard, tenantLimiter, authProxy);
}

module.exports = { registerAuthRoutes, AUTH_PUBLIC, STRIP_AUTH_PREFIX };
