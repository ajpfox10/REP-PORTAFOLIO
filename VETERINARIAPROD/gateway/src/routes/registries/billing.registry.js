'use strict';

const { authMiddleware, requireGatewayPerm } = require('../../middleware/auth');
const { tenantLimiter, apiLimiter } = require('../../middleware/rateLimiter');
const { tenantMismatchGuard } = require('../../middleware/subdomain');
const { makeServiceProxy } = require('../proxy.factory');

function requireMethodPerm({ read, write }) {
  return (req, res, next) => {
    const perm = ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? read : write;
    return requireGatewayPerm(perm)(req, res, next);
  };
}

function requirePaymentsPerm(req, res, next) {
  if (/\/payments\/mp\/(?:webhook\/)?[^/]+\/refund(?:\/|$)/.test(req.path || req.originalUrl || '')) {
    return requireGatewayPerm('payments:refund')(req, res, next);
  }
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return requireGatewayPerm('payments:read')(req, res, next);
  }
  return requireGatewayPerm('payments:create')(req, res, next);
}

function registerBillingRoutes(app, registerVersioned) {
  // OT-103: gateway-level permission gates on sensitive billing routes
  registerVersioned(app, 'use', 'billing/subscriptions', authMiddleware, requireGatewayPerm('billing:read'), tenantMismatchGuard, tenantLimiter, makeServiceProxy('billing'));
  registerVersioned(app, 'use', 'billing/consolidated', authMiddleware, requireGatewayPerm('invoices:read'), tenantMismatchGuard, tenantLimiter, makeServiceProxy('billing'));
  registerVersioned(app, 'use', 'invoices', authMiddleware, requireGatewayPerm('invoices:read'), tenantMismatchGuard, tenantLimiter, makeServiceProxy('billing'));
  // Webhook endpoints are public (no JWT) but must be rate-limited to prevent flooding
  registerVersioned(app, 'post', 'payments/mp/webhook', apiLimiter, makeServiceProxy('billing'));
  registerVersioned(app, 'post', 'payments/stripe/webhook', apiLimiter, makeServiceProxy('billing'));
  registerVersioned(app, 'use', 'payments', authMiddleware, requirePaymentsPerm, tenantMismatchGuard, tenantLimiter, makeServiceProxy('billing'));
  registerVersioned(app, 'use', 'price-lists', authMiddleware, requireMethodPerm({ read: 'invoices:read', write: 'invoices:write' }), tenantMismatchGuard, tenantLimiter, makeServiceProxy('billing'));
  registerVersioned(app, 'use', 'inventory', authMiddleware, requireMethodPerm({ read: 'inventory:read', write: 'inventory:write' }), tenantMismatchGuard, tenantLimiter, makeServiceProxy('billing'));
  registerVersioned(app, 'use', 'suppliers', authMiddleware, requireMethodPerm({ read: 'inventory:read', write: 'inventory:write' }), tenantMismatchGuard, tenantLimiter, makeServiceProxy('billing'));
  registerVersioned(app, 'use', 'purchase-orders', authMiddleware, requireMethodPerm({ read: 'inventory:read', write: 'inventory:write' }), tenantMismatchGuard, tenantLimiter, makeServiceProxy('billing'));
}

module.exports = { registerBillingRoutes };
