'use strict';

const { Router } = require('express');
const { db, R } = require('./_common');

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    // SECURITY: filtrar columnas sensibles (credentials, webhook_secret, etc.) y
    // limitar a plataformas globales (org_id IS NULL) o de la propia org.
    // SELECT * podría exponer tokens/secrets de integración de otras orgs si la
    // tabla es multi-tenant.
    const rows = await db.query(
      `SELECT id, name, display_name, platform_type, base_url, is_active
       FROM tele_platforms
       WHERE is_active = TRUE
         AND (org_id IS NULL OR org_id = :orgId)
       ORDER BY name`,
      { orgId: req.user.orgId }
    );
    return R.ok(res, rows);
  } catch (e) { next(e); }
});

module.exports = router;
