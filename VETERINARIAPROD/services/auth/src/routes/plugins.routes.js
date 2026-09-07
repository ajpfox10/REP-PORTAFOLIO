'use strict';
/**
 * Plugin management API — activa/desactiva plugins por org.
 *
 * GET  /admin/plugins              → listar plugins disponibles + estado por org
 * POST /admin/plugins/:id/enable   → activar plugin para el org
 * POST /admin/plugins/:id/disable  → desactivar plugin para el org
 * PUT  /admin/plugins/:id/config   → configurar plugin
 */
const { Router } = require('express');
const { body, param, validationResult } = require('express-validator');
const db       = require('../../../../shared/db');
const registry = require('../../../../shared/pluginRegistry');
const R = require('../../../../shared/response');
const { requireInternalSig } = require('../../../../shared/internalAuth');   // BUG-003
const { fromHeaders } = require('../../../../shared/requestContext');         // BUG-003

const router = Router();

function adminOnly(req, res, next) {
  // BUG-003: roles ya poblados por fromHeaders (que viene después de requireInternalSig)
  const roles = req.user?.roles || [];
  if (roles.includes('superadmin') || roles.includes('org_admin')) return next();
  return R.error(res, 403, 'Admin access required', null, 'RBAC_001');
}

// BUG-003: verificar firma de servicio interno antes de procesar roles/claims
router.use(requireInternalSig, fromHeaders, adminOnly);

// GET /admin/plugins
router.get('/', async (req, res, next) => {
  try {
    const orgId  = req.user.orgId;
    const available = registry.listPlugins();
    const enabled = await db.query(
      'SELECT plugin_id, is_active, config FROM org_plugins WHERE org_id = :orgId',
      { orgId },
    );
    const enabledMap = Object.fromEntries(enabled.map(r => [r.plugin_id, r]));

    const data = available.map(p => ({
      ...p,
      enabled: Boolean(enabledMap[p.id]?.is_active),
      config:  enabledMap[p.id]?.config || null,
    }));

    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// POST /admin/plugins/:id/enable
router.post('/:id/enable', param('id').isString(), async (req, res, next) => {
  try {
    const orgId    = req.user.orgId;
    const userId   = req.user.userId;
    const pluginId = req.params.id;

    const allPlugins = registry.listPlugins();
    const validIds = new Set(allPlugins.map(p => p.id));
    if (!validIds.has(pluginId)) return R.notFound(res, 'Plugin no encontrado en el registry');

    await db.query(
      `INSERT INTO org_plugins (org_id, plugin_id, is_active, enabled_by)
       VALUES (:orgId, :pluginId, TRUE, :userId)
       ON DUPLICATE KEY UPDATE is_active = TRUE, updated_at = NOW()`,
      { orgId, pluginId, userId },
    );

    await registry.invalidateOrgCache(orgId);
    res.json({ success: true, message: `Plugin '${pluginId}' enabled` });
  } catch (err) { next(err); }
});

// POST /admin/plugins/:id/disable
router.post('/:id/disable', param('id').isString(), async (req, res, next) => {
  try {
    const orgId    = req.user.orgId;
    const pluginId = req.params.id;

    const allPlugins = registry.listPlugins();
    const validIds = new Set(allPlugins.map(p => p.id));
    if (!validIds.has(pluginId)) return R.notFound(res, 'Plugin no encontrado en el registry');

    await db.query(
      'UPDATE org_plugins SET is_active = FALSE, updated_at = NOW() WHERE org_id = :orgId AND plugin_id = :pluginId',
      { orgId, pluginId },
    );

    await registry.invalidateOrgCache(orgId);
    res.json({ success: true, message: `Plugin '${pluginId}' disabled` });
  } catch (err) { next(err); }
});

// PUT /admin/plugins/:id/config
router.put('/:id/config',
  body('config').isObject(),
  async (req, res, next) => {
    try {
      const orgId    = req.user.orgId;
      const pluginId = req.params.id;
      const { config } = req.body;

      await db.query(
        `INSERT INTO org_plugins (org_id, plugin_id, config, is_active)
         VALUES (:orgId, :pluginId, :config, TRUE)
         ON DUPLICATE KEY UPDATE config = :config, updated_at = NOW()`,
        { orgId, pluginId, config: JSON.stringify(config) },
      );

      await registry.invalidateOrgCache(orgId);
      res.json({ success: true });
    } catch (err) { next(err); }
  },
);

module.exports = router;
