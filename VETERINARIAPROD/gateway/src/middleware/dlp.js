'use strict';
const dlp    = require('../../../shared/dlp');
const cache  = require('../../../shared/cache');
const { logger } = require('./logger');
const { config } = require('../config');
const { matchDlpPolicy } = require('./dlp.policy');

function getTrackedRecordCount(body) {
  // Priorizar conteo REAL de registros devueltos por sobre el declarativo
  // meta.total, ya que un upstream comprometido podría sub-declararlo.
  if (Array.isArray(body?.data)) return body.data.length;
  if (Array.isArray(body)) return body.length;
  // Fallback: usar meta.total solo si no hay data array
  if (body?.meta?.total) return parseInt(body.meta.total, 10) || 0;
  return 0;
}

async function dlpMiddleware(req, res, next) {
  const policy = matchDlpPolicy(req);
  if (!policy) return next();

  const userId = req.user?.userId;
  const orgId  = req.user?.orgId;

  if (!userId || !orgId) return next();

  try {
    const client = await cache.getClient();
    const current = parseInt(await client.get(`dlp:export:${orgId}:${userId}`) || '0');
    if (current > config.dlp.exportThreshold) {
      logger.warn('[dlp-middleware] Pre-check blocked - threshold exceeded', {
        userId,
        orgId,
        current,
        policy: policy.name,
        kind: policy.kind,
        path: req.originalUrl,
      });
      return res.status(429).json({
        success: false,
        error: {
          message: 'Mass export limit reached. Contact support if this is unexpected.',
          code:    'DLP_EXPORT_BLOCKED',
        },
      });
    }
  } catch (err) {
    logger.error('[dlp-middleware] Pre-check failed - Redis unavailable', {
      err: err.message,
      userId,
      orgId,
      policy: policy.name,
      path: req.originalUrl,
    });
    // En producción, fallar cerrado para políticas de exportación masiva.
    // En dev/test se permite continuar para no bloquear el desarrollo.
    if (process.env.NODE_ENV === 'production' && policy.kind === 'export') {
      return res.status(503).json({
        success: false,
        error: {
          message: 'Export temporarily unavailable. Please try again later.',
          code:    'DLP_BACKEND_UNAVAILABLE',
        },
      });
    }
  }

  const originalJson = res.json.bind(res);
  res.json = function (body) {
    try {
      const recordCount = getTrackedRecordCount(body);
      if (recordCount > 0) {
        dlp.trackExport(userId, orgId, recordCount).catch(err => {
          logger.warn('[dlp-middleware] trackExport failed', {
            err: err.message,
            userId,
            orgId,
            policy: policy.name,
            recordCount,
          });
        });
      }
    } catch (error) {
      logger.warn('[dlp-middleware] response inspection failed', {
        err: error.message,
        userId,
        orgId,
        policy: policy.name,
      });
    }

    return originalJson(body);
  };

  next();
}

module.exports = { dlpMiddleware };
