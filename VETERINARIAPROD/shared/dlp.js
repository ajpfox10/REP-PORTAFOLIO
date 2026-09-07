'use strict';
/**
 * DLP — Data Loss Prevention
 *
 * Detecta y alerta sobre:
 *   1. Export masivo: usuario exporta >N registros en ventana corta
 *   2. Acceso cross-tenant: intento de acceder a recursos de otro org
 *   3. Bulk delete: eliminación masiva de registros
 *
 * Configuración (env):
 *   DLP_EXPORT_THRESHOLD   = 1000  (registros en la ventana)
 *   DLP_EXPORT_WINDOW_SECS = 300   (5 minutos)
 */

const db     = require('./db');
const cache  = require('./cache');
const logger = require('./logger');

const EXPORT_THRESHOLD   = parseInt(process.env.DLP_EXPORT_THRESHOLD   || '1000');
const EXPORT_WINDOW_SECS = parseInt(process.env.DLP_EXPORT_WINDOW_SECS || '300');

/**
 * Registra cuántos registros exportó un usuario en la ventana de tiempo.
 * @returns {{ exceeded: boolean, count: number, threshold: number }}
 */
async function trackExport(userId, orgId, recordCount) {
  if (!userId || recordCount <= 0) return { exceeded: false, count: 0, threshold: EXPORT_THRESHOLD };

  let client;
  try {
    client = await cache.getClient();
    const key = `dlp:export:${orgId}:${userId}`;
    const multi = client.multi();
    multi.incrBy(key, recordCount);
    multi.expire(key, EXPORT_WINDOW_SECS);
    const results = await multi.exec();
    const total = results[0];

    if (total > EXPORT_THRESHOLD) {
      await createAlert(orgId, userId, 'mass_export', 'high', {
        records_exported: total,
        threshold:        EXPORT_THRESHOLD,
        window_secs:      EXPORT_WINDOW_SECS,
      });
      logger.warn('[dlp] Mass export detected', { userId, orgId, total, threshold: EXPORT_THRESHOLD });
      return { exceeded: true, count: total, threshold: EXPORT_THRESHOLD };
    }

    return { exceeded: false, count: total, threshold: EXPORT_THRESHOLD };
  } catch (err) {
    logger.warn('[dlp] trackExport failed', { err: err.message });
    return { exceeded: false, count: 0, threshold: EXPORT_THRESHOLD };
  }
}

/**
 * Registra un intento de acceso cross-tenant (org_id mismatch).
 */
async function recordCrossOrgAttempt(userId, requestedOrgId, actualOrgId, ip) {
  logger.warn('[dlp] Cross-org access attempt', { userId, requestedOrgId, actualOrgId, ip });

  await createAlert(requestedOrgId || actualOrgId, userId, 'cross_tenant_attempt', 'critical', {
    user_org_id:      actualOrgId,
    requested_org_id: requestedOrgId,
    ip,
  });
}

/**
 * Crea una alerta de seguridad en la DB.
 */
async function createAlert(orgId, userId, alertType, severity, details) {
  try {
    await db.query(
      `INSERT INTO security_alerts (org_id, user_id, alert_type, severity, details)
       VALUES (:orgId, :userId, :alertType, :severity, :details)`,
      {
        orgId,
        userId:    userId || null,
        alertType,
        severity,
        details:   JSON.stringify(details),
      },
    );
  } catch (err) {
    // La tabla puede no existir en ambientes de test
    logger.warn('[dlp] Could not create alert', { err: err.message, alertType });
  }
}

/**
 * Obtiene alertas de seguridad de un org (para el panel admin).
 */
async function getAlerts(orgId, { limit = 50, onlyUnacknowledged = false } = {}) {
  // Validate limit to prevent large result sets and ensure it is a safe integer
  // before embedding in the query. Named placeholder :limit is used for binding.
  const safeLimit = Math.min(Math.max(1, parseInt(limit, 10) || 50), 500);

  // Use two separate queries instead of string-concatenating the WHERE clause
  // so there is never any user-controlled text interpolated into the SQL.
  if (onlyUnacknowledged) {
    return db.query(
      `SELECT * FROM security_alerts
       WHERE org_id = :orgId AND acknowledged = FALSE
       ORDER BY created_at DESC LIMIT :limit`,
      { orgId, limit: safeLimit },
    );
  }
  return db.query(
    `SELECT * FROM security_alerts
     WHERE org_id = :orgId
     ORDER BY created_at DESC LIMIT :limit`,
    { orgId, limit: safeLimit },
  );
}

/**
 * Reconoce (ack) una alerta.
 */
async function acknowledgeAlert(alertId, adminUserId, orgId) {
  // SEC: scope por org para impedir que un admin reconozca alertas de otra organización (IDOR).
  return db.query(
    `UPDATE security_alerts
     SET acknowledged = TRUE, acknowledged_by = :adminUserId, acknowledged_at = NOW()
     WHERE id = :alertId AND org_id = :orgId`,
    { alertId, adminUserId, orgId },
  );
}

module.exports = { trackExport, recordCrossOrgAttempt, createAlert, getAlerts, acknowledgeAlert };
