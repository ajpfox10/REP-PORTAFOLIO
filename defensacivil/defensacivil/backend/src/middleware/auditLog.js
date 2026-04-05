const { query } = require('../config/database');
const logger    = require('../config/logger');

function createAuditLog(action, entityType) {
  return async (req, res, next) => {
    const originalJson = res.json.bind(res);

    res.json = function (body) {
      res.auditBody = body;
      return originalJson(body);
    };

    res.on('finish', async () => {
      if (res.statusCode >= 400) return;
      try {
        const entityId = req.params.uuid
          || res.auditBody?.uuid
          || res.auditBody?.data?.uuid
          || null;

        await query(
          `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            req.user?.id        || null,
            action,
            entityType          || null,
            entityId,
            req.auditOld ? JSON.stringify(req.auditOld) : null,
            req.auditNew ? JSON.stringify(req.auditNew) : null,
            req.ip              || null,
            req.headers['user-agent']?.slice(0, 255) || null,
          ]
        );
      } catch (err) {
        logger.error('Error al registrar auditoría', { err: err.message, action });
      }
    });

    next();
  };
}

module.exports = { createAuditLog };
