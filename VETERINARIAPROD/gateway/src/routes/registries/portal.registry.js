'use strict';

const { makeServiceProxy } = require('../proxy.factory');
const { authMiddleware } = require('../../middleware/auth');
const { tenantMismatchGuard } = require('../../middleware/subdomain');
const { authLimiter, tenantLimiter } = require('../../middleware/rateLimiter');

function registerPortalRoutes(app, registerVersioned) {
  // portal/auth is public (no JWT required) but must be rate-limited to prevent brute-force
  registerVersioned(app, 'use', 'portal/auth', authLimiter, makeServiceProxy('portal'));
  registerVersioned(app, 'use', 'portal', authMiddleware, tenantMismatchGuard, tenantLimiter, makeServiceProxy('portal'));
}

module.exports = { registerPortalRoutes };
