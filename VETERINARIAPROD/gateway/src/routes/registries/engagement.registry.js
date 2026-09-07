'use strict';

const { authMiddleware, requireGatewayPerm } = require('../../middleware/auth');
const { tenantLimiter } = require('../../middleware/rateLimiter');
const { tenantMismatchGuard } = require('../../middleware/subdomain');
const { makeServiceProxy } = require('../proxy.factory');

function registerEngagementRoutes(app, registerVersioned) {
  registerVersioned(app, 'use', 'tele', authMiddleware, tenantMismatchGuard, tenantLimiter, makeServiceProxy('telemedicine'));
  registerVersioned(app, 'use', 'follow-ups', authMiddleware, tenantMismatchGuard, tenantLimiter, makeServiceProxy('telemedicine'));
  registerVersioned(app, 'use', 'grooming', authMiddleware, tenantMismatchGuard, tenantLimiter, makeServiceProxy('grooming'));
  // OT-103: gateway-level permission gate — defense-in-depth before proxying
  registerVersioned(app, 'use', 'reports', authMiddleware, requireGatewayPerm('reports:read'), tenantMismatchGuard, tenantLimiter, makeServiceProxy('reports'));
  registerVersioned(app, 'use', 'notifications/fcm/send', authMiddleware, requireGatewayPerm('notifications:send'), tenantMismatchGuard, tenantLimiter, makeServiceProxy('notifications'));
  registerVersioned(app, 'use', 'notifications/fcm/broadcast', authMiddleware, requireGatewayPerm('notifications:send'), tenantMismatchGuard, tenantLimiter, makeServiceProxy('notifications'));
  registerVersioned(app, 'use', 'notifications/fcm', authMiddleware, tenantMismatchGuard, tenantLimiter, makeServiceProxy('notifications'));
  registerVersioned(app, 'use', 'notifications/messages/send', authMiddleware, requireGatewayPerm('notifications:send'), tenantMismatchGuard, tenantLimiter, makeServiceProxy('notifications'));
  registerVersioned(app, 'use', 'notifications/messages/template', authMiddleware, requireGatewayPerm('notifications:send'), tenantMismatchGuard, tenantLimiter, makeServiceProxy('notifications'));
  registerVersioned(app, 'use', 'notifications/messages/bulk-reminders', authMiddleware, requireGatewayPerm('notifications:send'), tenantMismatchGuard, tenantLimiter, makeServiceProxy('notifications'));
  registerVersioned(app, 'use', 'notifications/messages/reminder', authMiddleware, requireGatewayPerm('notifications:send'), tenantMismatchGuard, tenantLimiter, makeServiceProxy('notifications'));
  registerVersioned(app, 'use', 'notifications/messages', authMiddleware, requireGatewayPerm('notifications:send'), tenantMismatchGuard, tenantLimiter, makeServiceProxy('notifications'));
  registerVersioned(app, 'use', 'notifications/push', authMiddleware, requireGatewayPerm('notifications:send'), tenantMismatchGuard, tenantLimiter, makeServiceProxy('notifications'));
  registerVersioned(app, 'use', 'notifications/retries', authMiddleware, requireGatewayPerm('notifications:send'), tenantMismatchGuard, tenantLimiter, makeServiceProxy('notifications'));
  registerVersioned(app, 'use', 'notifications/reminders/generate', authMiddleware, requireGatewayPerm('notifications:send'), tenantMismatchGuard, tenantLimiter, makeServiceProxy('notifications'));
  registerVersioned(app, 'use', 'notifications', authMiddleware, tenantMismatchGuard, tenantLimiter, makeServiceProxy('notifications'));
  registerVersioned(app, 'use', 'documents', authMiddleware, tenantMismatchGuard, tenantLimiter, makeServiceProxy('documents'));
}

module.exports = { registerEngagementRoutes };
