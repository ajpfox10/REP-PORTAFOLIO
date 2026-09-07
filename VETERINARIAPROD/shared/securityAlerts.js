'use strict';

const db = require('./db');

// Maximum byte length for serialised metadata stored in DB.
const MAX_METADATA_BYTES = 8192;

async function createAlert({ orgId, userId = null, type, severity = 'warning', description, metadata = null }) {
  let serialisedMetadata = null;
  if (metadata) {
    const raw = JSON.stringify(metadata);
    // Truncate oversized metadata to avoid unbounded DB writes
    serialisedMetadata = Buffer.byteLength(raw, 'utf8') > MAX_METADATA_BYTES
      ? JSON.stringify({ _truncated: true, preview: raw.slice(0, MAX_METADATA_BYTES) })
      : raw;
  }

  await db.query(
    `INSERT INTO security_alerts
       (org_id, user_id, alert_type, severity, details, created_at)
     VALUES
       (:orgId, :userId, :type, :severity, :details, NOW())`,
    {
      orgId,
      userId,
      type,
      severity,
      details: serialisedMetadata,
    }
  ).catch(() => {});
}

async function scanSuspiciousAccessPatterns(windowMinutes = 1) {
  const rows = await db.query(
    `SELECT org_id,
            user_id,
            COUNT(*) AS read_count,
            SUM(CASE WHEN action = 'EXPORT' THEN 1 ELSE 0 END) AS export_count
     FROM audit_logs
     WHERE created_at >= DATE_SUB(NOW(), INTERVAL :windowMinutes MINUTE)
       AND action IN ('READ', 'EXPORT')
     GROUP BY org_id, user_id
     HAVING COUNT(*) >= 200 OR SUM(CASE WHEN action = 'EXPORT' THEN 1 ELSE 0 END) >= 5`,
    { windowMinutes }
  ).catch(() => []);

  for (const row of rows) {
    await createAlert({
      orgId: row.org_id,
      userId: row.user_id,
      type: row.export_count >= 5 ? 'mass_export' : 'high_volume_read',
      severity: row.export_count >= 5 ? 'critical' : 'warning',
      description: row.export_count >= 5
        ? `Usuario con ${row.export_count} exportaciones en ${windowMinutes} minuto(s)`
        : `Usuario con ${row.read_count} lecturas en ${windowMinutes} minuto(s)`,
      metadata: {
        readCount: row.read_count,
        exportCount: row.export_count,
        windowMinutes,
      },
    });
  }

  return rows.length;
}

module.exports = {
  createAlert,
  scanSuspiciousAccessPatterns,
};
