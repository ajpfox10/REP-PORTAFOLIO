'use strict';

const { Router } = require('express');
const { body, param } = require('express-validator');
const db = require('../../../../shared/db');
const { requireInternalSig } = require('../../../../shared/internalAuth');
const { getFlags, setFlags, FLAG_DEFINITIONS, DEFAULT_FLAGS } = require('../../../../shared/featureFlags');
const { fromHeaders, requireOrgContext } = require('../../../../shared/requestContext');
const { requireAdminRole } = require('../../../../shared/adminAuth');
const { validateRequest } = require('../../../../shared/validation');

const router = Router();

/**
 * BUG-FIX IDOR: Verifica que el actor sólo pueda operar sobre su propio org,
 * a menos que sea superadmin (que puede operar en cualquier org).
 */
function assertOrgAccess(req, res, orgId) {
  const isSuperAdmin = Array.isArray(req.user?.roles) && req.user.roles.includes('superadmin');
  if (!isSuperAdmin && parseInt(orgId, 10) !== parseInt(req.user?.orgId, 10)) {
    res.status(403).json({ success: false, message: 'Insufficient privileges for this organization' });
    return false;
  }
  return true;
}

async function auditFeatureChange(req, previousValue, newValue) {
  await db.query(
    `INSERT INTO permission_change_audit
       (org_id, actor_id, change_type, detail_json, ip_address)
     VALUES
       (:orgId, :actorId, :changeType, :detail, :ipAddress)`,
    {
      orgId     : req.user.orgId,
      actorId   : req.user.userId || null,
      changeType: 'feature_flag_changed',
      detail    : JSON.stringify({ previousValue: previousValue || {}, newValue: newValue || {}, requestId: req.headers['x-request-id'] || null }),
      ipAddress : req.ip || null,
    }
  ).catch(() => {});
}

router.use(requireInternalSig, fromHeaders, requireOrgContext, requireAdminRole);

router.get('/orgs/:orgId',
  param('orgId').isInt({ min: 1 }),
  validateRequest,
  async (req, res, next) => {
    try {
      if (!assertOrgAccess(req, res, req.params.orgId)) return;
      const flags = await getFlags(req.params.orgId);
      res.json({
        success: true,
        data: {
          flags,
          definitions: FLAG_DEFINITIONS,
          defaults: DEFAULT_FLAGS,
        },
      });
    } catch (err) { next(err); }
  }
);

router.patch('/orgs/:orgId',
  param('orgId').isInt({ min: 1 }),
  body('flags').isObject(),
  validateRequest,
  async (req, res, next) => {
    try {
      if (!assertOrgAccess(req, res, req.params.orgId)) return;
      const previous = await getFlags(req.params.orgId);
      const nextFlags = await setFlags(req.params.orgId, req.body.flags || {});
      await auditFeatureChange(req, previous, nextFlags);
      res.json({
        success: true,
        data: {
          flags: nextFlags,
          definitions: FLAG_DEFINITIONS,
          defaults: DEFAULT_FLAGS,
        },
      });
    } catch (err) { next(err); }
  }
);

module.exports = router;
