'use strict';

/**
 * GET /audit/export
 *
 * Exporta audit logs del tenant autenticado.
 * Requiere rol 'owner' o 'admin'.
 * Soporta formato JSON (default) y CSV (Accept: text/csv o ?format=csv).
 *
 * Query params:
 *   dateFrom  — YYYY-MM-DD (default: últimos 30 días)
 *   dateTo    — YYYY-MM-DD (default: hoy)
 *   resource  — e.g. 'patients', 'invoices'
 *   action    — CREATE | UPDATE | DELETE | READ
 *   userId    — filtrar por usuario
 *   format    — 'json' | 'csv' (también respetado vía Accept header)
 *   limit     — máximo registros (cap en 10 000)
 */

const { Router } = require('express');
const { exportAuditLogs, rowsToCsv, rowsToNdjson } = require('../../../../shared/audit');
const { scanSuspiciousAccessPatterns } = require('../../../../shared/securityAlerts');
const db = require('../../../../shared/db');
const R = require('../../../../shared/response');
const { fromHeaders, requireOrgContext } = require('../../../../shared/requestContext');
const { requireAdminRole } = require('../../../../shared/adminAuth');
const { requireInternalSig } = require('../../../../shared/internalAuth');

const router = Router();
let securityAlertsSchemaPromise;

async function getSecurityAlertsColumns() {
  if (!securityAlertsSchemaPromise) {
    securityAlertsSchemaPromise = db.query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'security_alerts'`
    ).then((rows) => new Set(rows.map((row) => row.COLUMN_NAME)));
  }
  return securityAlertsSchemaPromise;
}

router.get('/export', requireInternalSig, fromHeaders, requireOrgContext, requireAdminRole, async (req, res, next) => {
  try {
    const orgId = req.user.orgId;
    if (!orgId) return R.unauthorized(res, 'Missing org context');

    const wantsCsv =
      req.query.format === 'csv' ||
      (req.headers['accept'] || '').includes('text/csv');
    const wantsNdjson =
      req.query.format === 'ndjson' ||
      (req.headers['accept'] || '').includes('application/x-ndjson');
    const source = req.query.source === 'immutable' ? 'immutable' : 'audit_logs';

    // B-5: la fuente inmutable solo puede ser accedida por owner o superadmin
    if (source === 'immutable') {
      const roles = req.user?.roles || [];
      if (!roles.includes('owner') && !roles.includes('superadmin')) {
        return R.forbidden(res, 'El acceso a la fuente inmutable requiere rol owner', 'IMMUTABLE_OWNER_ONLY');
      }
    }

    // Sanitizar limit para evitar que NaN llegue a Math.min dentro de exportAuditLogs
    const rawLimit  = parseInt(req.query.limit, 10);
    const safeLimit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 10000) : 1000;

    const { rows, format } = await exportAuditLogs({
      orgId,
      dateFrom: req.query.dateFrom,
      dateTo:   req.query.dateTo,
      resource: req.query.resource,
      action:   req.query.action,
      userId:   req.query.userId ? parseInt(req.query.userId, 10) : undefined,
      format:   wantsNdjson ? 'ndjson' : (wantsCsv ? 'csv' : 'json'),
      limit:    safeLimit,
      source,
    });

    if (wantsNdjson) {
      const filename = `audit-${source}-${orgId}-${new Date().toISOString().slice(0,10)}.ndjson`;
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(rowsToNdjson(rows));
    }

    if (format === 'csv') {
      const filename = `audit-${source}-${orgId}-${new Date().toISOString().slice(0,10)}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(rowsToCsv(rows));
    }

    return R.ok(res, { total: rows.length, rows });
  } catch (e) { next(e); }
});

router.get('/alerts', requireInternalSig, fromHeaders, requireOrgContext, requireAdminRole, async (req, res, next) => {
  try {
    const cols = await getSecurityAlertsColumns();
    const orgColumn = cols.has('organization_id') ? 'organization_id' : (cols.has('org_id') ? 'org_id' : null);
    if (!orgColumn) return R.serverError(res, 'security_alerts schema missing org column', 'SCHEMA_MISMATCH');
    const descriptionExpr = cols.has('description')
      ? 'description'
      : (cols.has('details') ? 'details AS description' : 'NULL AS description');
    const metadataExpr = cols.has('metadata')
      ? 'metadata'
      : (cols.has('details') ? 'details AS metadata' : 'NULL AS metadata');
    const rows = await db.query(
      `SELECT id, alert_type, severity, ${descriptionExpr}, ${metadataExpr}, created_at
       FROM security_alerts
       WHERE ${orgColumn} = :orgId
       ORDER BY created_at DESC
       LIMIT 200`,
      { orgId: req.user.orgId }
    );
    return R.ok(res, rows);
  } catch (e) { next(e); }
});

// SEC: requireInternalSig faltaba aqui (a diferencia de /export y /alerts). Sin la firma
// interna del gateway, fromHeaders confiaria en X-User-Roles/X-Org-Id spoofeables si el
// servicio fuese alcanzable directo -> permitiria disparar scans pesados (DoS) y poblar
// security_alerts. El cron interno llama scanSuspiciousAccessPatterns() como funcion, no
// por HTTP, asi que agregar la firma no afecta al scan programado.
router.post('/alerts/scan', requireInternalSig, fromHeaders, requireOrgContext, requireAdminRole, async (req, res, next) => {
  try {
    const generated = await scanSuspiciousAccessPatterns(parseInt(req.body?.windowMinutes || '1', 10));
    return R.ok(res, { generated });
  } catch (e) { next(e); }
});

module.exports = router;
