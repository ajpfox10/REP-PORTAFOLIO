'use strict';

const { authMiddleware } = require('../../middleware/auth');
const { tenantLimiter } = require('../../middleware/rateLimiter');
const { tenantMismatchGuard } = require('../../middleware/subdomain');
const { makeServiceProxy } = require('../proxy.factory');

function registerLabRoutes(app, registerVersioned) {
  registerVersioned(app, 'use', 'lab', authMiddleware, tenantMismatchGuard, tenantLimiter, makeServiceProxy('lab'));
  registerVersioned(app, 'use', 'imaging', authMiddleware, tenantMismatchGuard, tenantLimiter, makeServiceProxy('lab'));
  registerVersioned(app, 'use', 'pathology', authMiddleware, tenantMismatchGuard, tenantLimiter, makeServiceProxy('lab'));
  registerVersioned(app, 'use', 'surgeries', authMiddleware, tenantMismatchGuard, tenantLimiter, makeServiceProxy('lab'));
  registerVersioned(app, 'use', 'hospitalizations', authMiddleware, tenantMismatchGuard, tenantLimiter, makeServiceProxy('lab'));
  registerVersioned(app, 'use', 'vaccinations', authMiddleware, tenantMismatchGuard, tenantLimiter, makeServiceProxy('lab'));
  registerVersioned(app, 'use', 'deworming', authMiddleware, tenantMismatchGuard, tenantLimiter, makeServiceProxy('lab'));
}

module.exports = { registerLabRoutes };
