'use strict';

const { Router }        = require('express');
const cache             = require('../../../../shared/cache');
const { generateUiSchema } = require('../../../../shared/uiSchema');
const { getFlags }      = require('../../../../shared/featureFlags');
const { createLogger }   = require('../../../../shared/logger');
const { requireInternalSig } = require('../../../../shared/internalAuth');
const { fromHeaders, requireOrgContext } = require('../../../../shared/requestContext');
const R = require('../../../../shared/response');

const router = Router();
const UI_SCHEMA_TTL = 60; // segundos
const log = createLogger('auth-ui-schema');

/**
 * GET /me/ui-schema
 * Retorna el schema de UI personalizado para el usuario autenticado.
 * Requiere firma interna + contexto de usuario inyectado por el gateway.
 *
 * BUG-FIX: Se añade requireInternalSig + fromHeaders + requireOrgContext para
 * evitar que el endpoint sea accesible sin autenticación interna y para que
 * req.user sea poblado por el middleware en lugar de leer headers directamente.
 */
router.get('/ui-schema',
  requireInternalSig,
  fromHeaders,
  requireOrgContext,
  async (req, res, next) => {
  try {
    const { userId, orgId, branchId, roles, email } = req.user;

    if (!userId || !orgId) {
      return R.error(res, 401, 'Authentication required', null, 'AUTH_001');
    }

    const user  = { userId, orgId, branchId, roles, email: email || '' };

    // Cache por usuario
    const cacheKey = `ui-schema:${userId}:${orgId}`;

    let redisClient;
    try {
      redisClient = await cache.getClient();
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return res.json({ success: true, data: JSON.parse(cached), cached: true });
      }
    } catch (err) {
      log.warn('UI schema cache unavailable', { error: err.message, userId, orgId });
    }

    // Obtener feature flags del org
    let flags = {};
    try {
      flags = await getFlags(orgId);
    } catch (err) {
      log.warn('Feature flags unavailable for UI schema', { error: err.message, orgId });
    }

    const schema = await generateUiSchema(user, flags);

    // Guardar en cache
    try {
      if (redisClient) {
        await redisClient.setEx(cacheKey, UI_SCHEMA_TTL, JSON.stringify(schema));
      }
    } catch (err) {
      log.warn('UI schema cache write failed', { error: err.message, userId, orgId });
    }

    res.json({ success: true, data: schema, cached: false });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
