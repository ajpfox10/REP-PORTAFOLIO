'use strict';
/**
 * Plugin: Audit Enhanced
 * Enriquece el audit log con metadata adicional (user-agent, duración de request).
 */
const logger = require('../shared/logger');

module.exports = {
  id:          'audit-enhanced',
  name:        'Enhanced Audit Logging',
  version:     '1.0.0',
  description: 'Adds request duration and user-agent to audit logs',

  hooks: {
    before: (req, _res) => {
      req._pluginStartTime = Date.now();
      return null; // no abortar
    },

    after: (req, res) => {
      const duration = req._pluginStartTime ? Date.now() - req._pluginStartTime : null;

      // SECURITY: leer userId/orgId desde req.user (verificado por JWT) en lugar de
      // los headers crudos (x-user-id / x-org-id) que un atacante puede forjar para
      // contaminar el audit log con identidades falsas.
      const userId = req.user?.userId ?? req.user?.id ?? null;
      const orgId  = req.user?.orgId  ?? null;

      // Auditar tanto errores (>=400) como acciones exitosas sensibles (2xx en rutas de escritura)
      const isSensitive = res.statusCode >= 400
        || (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && res.statusCode < 300);

      if (isSensitive && userId) {
        logger.info('[audit-enhanced] Request completed', {
          userId, orgId,
          method:     req.method,
          path:       req.path,
          status:     res.statusCode,
          durationMs: duration,
          userAgent:  req.headers?.['user-agent']?.slice(0, 100),
        });
      }
    },
  },
};
