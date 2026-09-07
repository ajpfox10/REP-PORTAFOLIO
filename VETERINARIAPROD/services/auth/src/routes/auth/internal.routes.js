'use strict';

const { Router } = require('express');
const ctrl = require('../../controllers/auth.controller');
const R = require('../../../../../shared/response');
const { requireInternalSig } = require('./_common');

const router = Router();

router.post('/internal/validate-api-key', requireInternalSig, ctrl.validateApiKey);

router.get('/internal/orgs/by-slug/:slug', requireInternalSig, async (req, res, next) => {
  try {
    const db  = require('../../../../../shared/db');
    const row = await db.queryOne(
      `SELECT t.org_id, t.plan, t.status
       FROM tenants t
       WHERE t.subdomain = :slug`,
      { slug: req.params.slug }
    );
    if (!row) return R.error(res, 404, 'Tenant not found', null, 'TENANT_001');
    if (row.status !== 'active') {
      return R.error(res, 403, `Tenant is ${row.status}`, null, 'TENANT_002');
    }
    res.json({ success: true, orgId: row.org_id, plan: row.plan });
  } catch (err) { next(err); }
});

module.exports = router;
