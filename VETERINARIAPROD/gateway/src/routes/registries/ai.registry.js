'use strict';

const { authMiddleware } = require('../../middleware/auth');
const { tenantLimiter } = require('../../middleware/rateLimiter');
const { tenantMismatchGuard } = require('../../middleware/subdomain');
const { requireFeature } = require('../../../../shared/featureFlags');
const { makeServiceProxy } = require('../proxy.factory');

function registerAiRoutes(app, registerVersioned) {
  registerVersioned(app, 'use', 'ai/diagnosis', authMiddleware, tenantMismatchGuard, tenantLimiter, requireFeature('ai_diagnosis'), makeServiceProxy('ai'));
  registerVersioned(app, 'use', 'ai/images', authMiddleware, tenantMismatchGuard, tenantLimiter, requireFeature('ai_image_analysis'), makeServiceProxy('ai'));
  registerVersioned(app, 'use', 'ai/chat', authMiddleware, tenantMismatchGuard, tenantLimiter, requireFeature('ai_chatbot'), makeServiceProxy('ai'));
  registerVersioned(app, 'use', 'ai/patients', authMiddleware, tenantMismatchGuard, tenantLimiter, requireFeature('ai_risk_assessment'), makeServiceProxy('ai'));
  registerVersioned(app, 'use', 'ai', authMiddleware, tenantMismatchGuard, tenantLimiter, makeServiceProxy('ai'));
}

module.exports = { registerAiRoutes };
