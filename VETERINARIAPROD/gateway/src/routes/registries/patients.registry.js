'use strict';

const { authMiddleware } = require('../../middleware/auth');
const { tenantLimiter } = require('../../middleware/rateLimiter');
const { tenantMismatchGuard } = require('../../middleware/subdomain');
const { makeServiceProxy } = require('../proxy.factory');

function registerPatientsRoutes(app, registerVersioned) {
  registerVersioned(app, 'use', 'clients', authMiddleware, tenantMismatchGuard, tenantLimiter, makeServiceProxy('patients'));
  registerVersioned(app, 'use', 'patients', authMiddleware, tenantMismatchGuard, tenantLimiter, makeServiceProxy('patients'));
  // tenantMismatchGuard añadido: previene que un token de tenant A acceda a datos
  // de tenant B a través de acceso directo por IP/host sin subdomain.
  registerVersioned(app, 'use', 'species', authMiddleware, tenantMismatchGuard, tenantLimiter, makeServiceProxy('patients'));
  registerVersioned(app, 'use', 'breeds', authMiddleware, tenantMismatchGuard, tenantLimiter, makeServiceProxy('patients'));
  registerVersioned(app, 'use', 'branches', authMiddleware, tenantMismatchGuard, tenantLimiter, makeServiceProxy('patients'));
  registerVersioned(app, 'use', 'clients/signatures/public-key', authMiddleware, tenantMismatchGuard, tenantLimiter, makeServiceProxy('patients'));
  registerVersioned(app, 'use', 'clients/signatures/verify', authMiddleware, tenantMismatchGuard, tenantLimiter, makeServiceProxy('patients'));
}

module.exports = { registerPatientsRoutes };
