'use strict';

/**
 * Admin RBAC routes â€” manage per-org role permission overrides.
 * All endpoints require superadmin or org_admin role.
 *
 * GET  /admin/rbac/roles                    â†’ list roles + static permissions
 * GET  /admin/rbac/orgs/:orgId/overrides    â†’ get all overrides for an org
 * PUT  /admin/rbac/orgs/:orgId/roles/:role  â†’ set override (grant/revoke)
 * DELETE /admin/rbac/orgs/:orgId/roles/:role â†’ remove override
 * POST /admin/rbac/orgs/:orgId/sync         â†’ reload DB â†’ Redis for this org
 */

const { Router } = require('express');
const { body, param } = require('express-validator');
const db   = require('../../../../shared/db');
const { requireInternalSig } = require('../../../../shared/internalAuth');
const { fromHeaders, requireOrgContext } = require('../../../../shared/requestContext');
const { requireAdminRole } = require('../../../../shared/adminAuth');
const { validateRequest } = require('../../../../shared/validation');
const {
  ROLE_PERMISSIONS,
  setRoleOverride,
  getEffectivePermissions,
  loadOrgOverridesFromDb,
} = require('../../../../shared/rbac');
const R = require('../../../../shared/response');
const { createLogger } = require('../../../../shared/logger');

const router = Router();
const log = createLogger('auth-admin-rbac');

/**
 * Verifies that the requesting user is allowed to operate on the given orgId.
 * Superadmins may operate on any org; org_admins are restricted to their own org.
 */
function assertOrgAccess(req, res, orgId) {
  const isSuperAdmin = req.user?.roles?.includes('superadmin') ?? false;
  if (!isSuperAdmin && parseInt(orgId, 10) !== parseInt(req.user?.orgId, 10)) {
    R.forbidden(res, 'Insufficient privileges for this organization');
    return false;
  }
  return true;
}

function parsePermissionList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function auditPermissionChange(req, {
  targetRoleName = null,
  actionType,
  previousValue = null,
  newValue = null,
}) {
  try {
    await db.query(
      `INSERT INTO permission_change_audit
         (org_id, actor_id, change_type, detail_json, ip_address)
       VALUES
         (:orgId, :actorId, :changeType, :detail, :ipAddress)`,
      {
        orgId     : req.user.orgId,
        actorId   : req.user.userId || null,
        changeType: actionType,
        detail    : JSON.stringify({ targetRoleName, previousValue: previousValue || null, newValue: newValue || null, requestId: req.headers['x-request-id'] || null }),
        ipAddress : req.ip || null,
      }
    );
  } catch (err) {
    log.warn('RBAC audit write failed', { error: err.message, orgId: req.user?.orgId, actionType });
  }
}

router.use(requireInternalSig, fromHeaders, requireOrgContext, requireAdminRole);

router.get('/roles', (req, res) => {
  const roles = Object.entries(ROLE_PERMISSIONS).map(([name, perms]) => ({ name, permissions: perms }));
  res.json({ success: true, data: roles });
});

router.get('/orgs/:orgId/overrides',
  param('orgId').isInt({ min: 1 }),
  validateRequest,
  async (req, res, next) => {
    try {
      const { orgId } = req.params;
      if (!assertOrgAccess(req, res, orgId)) return;
      const rows = await db.query(
        'SELECT role_name, added_permissions, removed_permissions, updated_at FROM org_role_overrides WHERE org_id = :orgId',
        { orgId }
      );
      const data = rows.map(r => ({
        role:    r.role_name,
        grant:   parsePermissionList(r.added_permissions),
        revoke:  parsePermissionList(r.removed_permissions),
        updated: r.updated_at,
      }));
      res.json({ success: true, data });
    } catch (err) { next(err); }
  }
);

router.get('/orgs/:orgId/roles/:role/effective',
  param('orgId').isInt({ min: 1 }),
  param('role').notEmpty(),
  validateRequest,
  async (req, res, next) => {
    try {
      const { orgId, role } = req.params;
      if (!assertOrgAccess(req, res, orgId)) return;
      const permissions = await getEffectivePermissions(role, orgId);
      res.json({ success: true, data: { role, orgId, permissions } });
    } catch (err) { next(err); }
  }
);

router.put('/orgs/:orgId/roles/:role',
  param('orgId').isInt({ min: 1 }),
  param('role').notEmpty(),
  body('grant').optional().isArray(),
  body('revoke').optional().isArray(),
  validateRequest,
  async (req, res, next) => {
    try {
      const { orgId, role } = req.params;
      if (!assertOrgAccess(req, res, orgId)) return;
      const grant  = req.body.grant  || [];
      const revoke = req.body.revoke || [];
      const previousRow = await db.queryOne(
        'SELECT added_permissions, removed_permissions FROM org_role_overrides WHERE org_id = :orgId AND role_name = :role',
        { orgId, role }
      );

      if (!ROLE_PERMISSIONS[role]) {
        return R.notFound(res, `Role '${role}' not found`, 'RBAC_002');
      }

      const allKnown = new Set(Object.values(ROLE_PERMISSIONS).flat());
      const permPattern = /^[\w*]+:[\w*]+$/;
      const unknown = [...grant, ...revoke].filter(
        (p) => p !== '*' && !allKnown.has(p) && !permPattern.test(p)
      );
      if (unknown.length) {
        return R.badRequest(res, `Unknown permissions: ${unknown.join(', ')}`);
      }
      const hasStar = [...grant, ...revoke].some((p) => p === '*' || p.includes('*'));
      if (hasStar && !req.user?.roles?.includes('superadmin')) {
        return R.forbidden(res, 'Wildcard permissions require superadmin');
      }

      await setRoleOverride(orgId, role, grant, revoke);
      const effective = await getEffectivePermissions(role, orgId);
      await auditPermissionChange(req, {
        targetRoleName: role,
        actionType: 'role_override_updated',
        previousValue: previousRow ? {
          grant: parsePermissionList(previousRow.added_permissions),
          revoke: parsePermissionList(previousRow.removed_permissions),
        } : null,
        newValue: { grant, revoke, effective },
      });
      res.json({ success: true, data: { orgId, role, grant, revoke, effective } });
    } catch (err) { next(err); }
  }
);

router.delete('/orgs/:orgId/roles/:role',
  param('orgId').isInt({ min: 1 }),
  param('role').notEmpty(),
  validateRequest,
  async (req, res, next) => {
    try {
      const { orgId, role } = req.params;
      if (!assertOrgAccess(req, res, orgId)) return;
      const previousRow = await db.queryOne(
        'SELECT added_permissions, removed_permissions FROM org_role_overrides WHERE org_id = :orgId AND role_name = :role',
        { orgId, role }
      );
      await setRoleOverride(orgId, role, [], []);
      await db.query(
        'DELETE FROM org_role_overrides WHERE org_id = :orgId AND role_name = :role',
        { orgId, role }
      );
      await auditPermissionChange(req, {
        targetRoleName: role,
        actionType: 'role_override_deleted',
        previousValue: previousRow ? {
          grant: parsePermissionList(previousRow.added_permissions),
          revoke: parsePermissionList(previousRow.removed_permissions),
        } : null,
        newValue: { grant: [], revoke: [] },
      });
      res.json({ success: true, message: `Overrides for role '${role}' in org ${orgId} removed` });
    } catch (err) { next(err); }
  }
);

router.post('/orgs/:orgId/sync',
  param('orgId').isInt({ min: 1 }),
  validateRequest,
  async (req, res, next) => {
    try {
      const { orgId } = req.params;
      if (!assertOrgAccess(req, res, orgId)) return;
      await loadOrgOverridesFromDb(orgId);
      res.json({ success: true, message: `RBAC cache warmed for org ${orgId}` });
    } catch (err) { next(err); }
  }
);

router.get('/security-alerts', async (req, res, next) => {
  try {
    const orgId              = req.user.orgId;
    if (!orgId) return R.forbidden(res, 'Organization context required');
    const onlyUnacknowledged = req.query.unacked === 'true';
    const { getAlerts }      = require('../../../../shared/dlp');
    const alerts             = await getAlerts(orgId, { onlyUnacknowledged });
    res.json({ success: true, data: alerts, count: alerts.length });
  } catch (err) { next(err); }
});

router.post('/security-alerts/:id/acknowledge',
  param('id').isInt({ min: 1 }),
  validateRequest,
  async (req, res, next) => {
  try {
    // BUG-FIX: usar queryOne en lugar de destructuring de array vacío (evita
    // que `alert` sea undefined sin lanzar error cuando no hay resultados).
    const alert = await db.queryOne(
      'SELECT org_id FROM security_alerts WHERE id = :id',
      { id: req.params.id }
    );
    if (!alert) return R.notFound(res, 'Alert not found');
    if (String(alert.org_id) !== String(req.user.orgId)) return R.forbidden(res, 'Access denied');
    const { acknowledgeAlert } = require('../../../../shared/dlp');
    await acknowledgeAlert(req.params.id, req.user.userId, req.user.orgId);
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
