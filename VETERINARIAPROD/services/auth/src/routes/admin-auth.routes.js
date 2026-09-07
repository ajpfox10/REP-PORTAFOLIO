'use strict';

const { Router } = require('express');
const { body } = require('express-validator');
const db = require('../../../../shared/db');
const R = require('../../../../shared/response');
const { requireInternalSig } = require('../../../../shared/internalAuth');
const { fromHeaders, requireOrgContext } = require('../../../../shared/requestContext');
const { requireAdminRole } = require('../../../../shared/adminAuth');
const { validateRequest } = require('../../../../shared/validation');

const router = Router();

router.get('/policy',
  requireInternalSig,
  fromHeaders,
  requireOrgContext,
  requireAdminRole,
  async (req, res, next) => {
    try {
      let row = await db.queryOne(
        `SELECT organization_id, two_factor_optional_enabled, two_factor_enforced, updated_at
         FROM organization_auth_policies
         WHERE organization_id = :orgId`,
        { orgId: req.user.orgId }
      );
      if (!row) {
        await db.query(
          `INSERT INTO organization_auth_policies (organization_id, two_factor_optional_enabled, two_factor_enforced, updated_by)
           VALUES (:orgId, 0, 0, :userId)`,
          { orgId: req.user.orgId, userId: req.user.userId || null }
        );
        row = await db.queryOne(
          `SELECT organization_id, two_factor_optional_enabled, two_factor_enforced, updated_at
           FROM organization_auth_policies
           WHERE organization_id = :orgId`,
          { orgId: req.user.orgId }
        );
      }
      return R.ok(res, row);
    } catch (e) { next(e); }
  }
);

router.patch('/policy',
  requireInternalSig,
  fromHeaders,
  requireOrgContext,
  requireAdminRole,
  body('twoFactorOptionalEnabled').isBoolean(),
  validateRequest,
  async (req, res, next) => {
    try {
      const enabled = req.body.twoFactorOptionalEnabled ? 1 : 0;
      await db.query(
        `INSERT INTO organization_auth_policies (organization_id, two_factor_optional_enabled, two_factor_enforced, updated_by)
         VALUES (:orgId, :enabled, 0, :userId)
         ON DUPLICATE KEY UPDATE
           two_factor_optional_enabled = VALUES(two_factor_optional_enabled),
           two_factor_enforced = 0,
           updated_by = VALUES(updated_by),
           updated_at = NOW()`,
        { orgId: req.user.orgId, enabled, userId: req.user.userId || null }
      );
      return R.ok(res, { organizationId: req.user.orgId, twoFactorOptionalEnabled: Boolean(enabled), twoFactorEnforced: false });
    } catch (e) { next(e); }
  }
);

module.exports = router;
