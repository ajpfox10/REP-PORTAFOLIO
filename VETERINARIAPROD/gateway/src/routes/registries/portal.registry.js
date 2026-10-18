'use strict';

const { makeServiceProxy } = require('../proxy.factory');
const { authMiddleware } = require('../../middleware/auth');
const { tenantMismatchGuard } = require('../../middleware/subdomain');
const { authLimiter, tenantLimiter } = require('../../middleware/rateLimiter');

// La sesión web del portal viaja en una cookie httpOnly. Si no hay header
// Authorization, se usa esa cookie para autenticar y se reenvía al servicio.
function portalCookieToBearer(req, _res, next) {
  const token = req.cookies?.portalAccessToken;
  if (token && !req.headers.authorization) req.headers.authorization = `Bearer ${token}`;
  next();
}

function registerPortalRoutes(app, registerVersioned) {
  // portal/auth is public (no JWT required) but must be rate-limited to prevent brute-force
  registerVersioned(app, 'use', 'portal/auth', authLimiter, makeServiceProxy('portal'));
  registerVersioned(app, 'use', 'portal', portalCookieToBearer, authMiddleware, tenantMismatchGuard, tenantLimiter, makeServiceProxy('portal'));
}

module.exports = { registerPortalRoutes, portalCookieToBearer };
