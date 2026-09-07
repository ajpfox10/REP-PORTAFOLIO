'use strict';

const { logger } = require('../middleware/logger');
const { appErrorHandler } = require('../../../shared/errors');
const R = require('../../../shared/response');

function registerNotFoundHandler(app) {
  app.use((req, res) => {
    logger.warn('Route not found', {
      method: req.method,
      originalUrl: req.originalUrl,
      baseUrl: req.baseUrl,
      path: req.path,
      requestId: req.headers['x-request-id'] || req.requestId || null,
      userId: req.user?.userId || req.user?.id || null,
    });
    // Do NOT echo req.originalUrl back in the response body — it may contain
    // resource IDs or PII that would confirm internal API structure to attackers.
    res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found',
        ...(req.requestId ? { requestId: req.requestId } : {}),
        ...(req.traceId ? { traceId: req.traceId } : {}),
      },
    });
  });
}

function registerErrorHandlers(app) {
  app.use(appErrorHandler);

  app.use((err, req, res, _next) => {
    if (req.requestId && !res.locals.requestId) res.locals.requestId = req.requestId;
    if (req.traceId && !res.locals.traceId) res.locals.traceId = req.traceId;

    if (err.type === 'entity.parse.failed') {
      return R.badRequest(res, 'Invalid JSON body', null, 'VAL_INVALID_JSON');
    }
    if (err.message?.includes('CORS')) {
      return R.forbidden(res, err.message, 'CORS_FORBIDDEN');
    }
    if (err.status === 404 || err.statusCode === 404 || err.name === 'NotFoundError' || /not found/i.test(err.message || '')) {
      logger.warn('Route not found', {
        method: req.method,
        originalUrl: req.originalUrl,
        baseUrl: req.baseUrl,
        path: req.path,
        requestId: req.headers['x-request-id'] || req.requestId || null,
        userId: req.user?.userId || req.user?.id || null,
        error: err.message,
      });
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Route not found',
          ...(req.requestId ? { requestId: req.requestId } : {}),
          ...(req.traceId ? { traceId: req.traceId } : {}),
        },
      });
    }
    logger.error('Unhandled error', {
      error: err.message,
      stack: err.stack,
      requestId: req.requestId,
      traceId: req.traceId,
    });
    return R.serverError(res, 'Internal server error', 'INTERNAL_ERROR');
  });
}

module.exports = { registerNotFoundHandler, registerErrorHandlers };
