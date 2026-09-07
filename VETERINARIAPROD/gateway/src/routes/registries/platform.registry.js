'use strict';

const { authMiddleware, requireGatewayPerm } = require('../../middleware/auth');
const { getAllStatus } = require('../../../../shared/circuitBreaker');
const { listServices } = require('../../../../shared/serviceRegistry');

function registerPlatformRoutes(app, registerVersioned) {
  // Restringido a usuarios con permiso platform:read (admins/superadmins).
  // Expone estado interno de circuit breakers — no debe ser visible a usuarios normales.
  registerVersioned(app, 'get', 'health/services', authMiddleware, requireGatewayPerm('platform:read'), (_req, res) =>
    res.json({ success: true, data: getAllStatus() })
  );
  registerVersioned(app, 'get', 'platform/services', authMiddleware, requireGatewayPerm('platform:read'), async (_req, res) =>
    res.json({ success: true, data: await listServices().catch(() => []) })
  );
}

module.exports = { registerPlatformRoutes };
