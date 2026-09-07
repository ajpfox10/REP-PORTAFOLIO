'use strict';
/**
 * Schema Engine routes — expone el schema de DB como tipos TypeScript/Zod.
 * Solo accesible para superadmin y org_admin.
 *
 * GET /schema              → lista tablas disponibles
 * GET /schema/:table       → schema JSON de la tabla
 * GET /schema/:table/typescript → interfaz TypeScript
 * GET /schema/:table/zod       → schema Zod
 */
const { Router } = require('express');
const {
  getTableSchema,
  listAllowedTables,
  generateTypeScript,
  generateZodSchema,
} = require('../../../../shared/schemaEngine');
const R = require('../../../../shared/response');
const { requireInternalSig } = require('../../../../shared/internalAuth');   // BUG-003
const { fromHeaders } = require('../../../../shared/requestContext');         // BUG-003

const router = Router();

// Guard: solo superadmin u org_admin
function adminOnly(req, res, next) {
  const roles = req.user?.roles || [];
  if (roles.includes('superadmin') || roles.includes('org_admin')) return next();
  return R.error(res, 403, 'Admin access required', null, 'RBAC_001');
}

// BUG-003: verificar firma de servicio interno antes de procesar roles/claims
router.use(requireInternalSig, fromHeaders, adminOnly);

// GET /schema — lista tablas disponibles
router.get('/', async (req, res, next) => {
  try {
    const tables = await listAllowedTables();
    res.json({ success: true, data: tables.map(t => t.TABLE_NAME), count: tables.length });
  } catch (err) { next(err); }
});

// GET /schema/:table — schema JSON
router.get('/:table', async (req, res, next) => {
  try {
    const schema = await getTableSchema(req.params.table);
    res.json({ success: true, data: schema });
  } catch (err) {
    if (err.http === 404) return R.error(res, 404, err.message, null, 'DB_001');
    next(err);
  }
});

// GET /schema/:table/typescript — solo superadmin (generación de código expone modelo de datos)
router.get('/:table/typescript', async (req, res, next) => {
  const roles = req.user?.roles || [];
  if (!roles.includes('superadmin')) {
    return R.error(res, 403, 'Solo superadmins pueden acceder al schema de código', null, 'RBAC_002');
  }
  try {
    const ts = await generateTypeScript(req.params.table);
    res.type('text/plain').send(ts);
  } catch (err) {
    if (err.http === 404) return R.error(res, 404, err.message, null, 'DB_001');
    next(err);
  }
});

// GET /schema/:table/zod — solo superadmin (generación de código expone modelo de datos)
router.get('/:table/zod', async (req, res, next) => {
  const roles = req.user?.roles || [];
  if (!roles.includes('superadmin')) {
    return R.error(res, 403, 'Solo superadmins pueden acceder al schema de código', null, 'RBAC_002');
  }
  try {
    const zod = await generateZodSchema(req.params.table);
    res.type('text/plain').send(zod);
  } catch (err) {
    if (err.http === 404) return R.error(res, 404, err.message, null, 'DB_001');
    next(err);
  }
});

module.exports = router;
