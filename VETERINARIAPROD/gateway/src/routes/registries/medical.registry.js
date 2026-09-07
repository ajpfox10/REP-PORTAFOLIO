'use strict';

const { authMiddleware } = require('../../middleware/auth');
const { tenantLimiter } = require('../../middleware/rateLimiter');
const { tenantMismatchGuard } = require('../../middleware/subdomain');
const { makeServiceProxy } = require('../proxy.factory');

function registerMedicalRoutes(app, registerVersioned) {
  registerVersioned(app, 'use', 'appointments', authMiddleware, tenantMismatchGuard, tenantLimiter, makeServiceProxy('medical'));
  registerVersioned(app, 'use', 'medical-records', authMiddleware, tenantMismatchGuard, tenantLimiter, makeServiceProxy('medical'));
  registerVersioned(app, 'use', 'triage', authMiddleware, tenantMismatchGuard, tenantLimiter, makeServiceProxy('medical'));
  registerVersioned(app, 'use', 'prescriptions', authMiddleware, tenantMismatchGuard, tenantLimiter, makeServiceProxy('medical'));
  registerVersioned(app, 'use', 'rules', authMiddleware, tenantMismatchGuard, tenantLimiter, makeServiceProxy('medical'));
}

module.exports = { registerMedicalRoutes };
