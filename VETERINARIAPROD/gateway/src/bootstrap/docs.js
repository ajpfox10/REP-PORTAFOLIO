'use strict';

const fs   = require('fs');
const path = require('path');
const swaggerUi = require('swagger-ui-express');
const yaml = require('js-yaml');  // OT-085: replaced abandoned yamljs with js-yaml
const { logger } = require('../middleware/logger');
const { config } = require('../config');

const openApiPath = path.join(__dirname, '../../docs/openapi.yaml');

/**
 * Basic-auth guard for Swagger UI in production.
 * Credentials are read from SWAGGER_USER / SWAGGER_PASSWORD env vars.
 * If not set in production, access is denied entirely.
 */
function swaggerAuthGuard(req, res, next) {
  if (config.env !== 'production') return next();

  const user = process.env.SWAGGER_USER;
  const pass = process.env.SWAGGER_PASSWORD;
  if (!user || !pass) {
    return res.status(403).json({ success: false, error: { message: 'API docs disabled', code: 'DOCS_DISABLED' } });
  }

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="API Docs"');
    return res.status(401).json({ success: false, error: { message: 'Authentication required', code: 'DOCS_AUTH_REQUIRED' } });
  }

  const [credUser, ...credRest] = Buffer.from(authHeader.slice(6), 'base64').toString().split(':');
  const credPass = credRest.join(':');
  if (credUser !== user || credPass !== pass) {
    res.setHeader('WWW-Authenticate', 'Basic realm="API Docs"');
    return res.status(401).json({ success: false, error: { message: 'Invalid credentials', code: 'DOCS_AUTH_FAILED' } });
  }

  next();
}

function registerDocsRoutes(app, version) {
  const supportedVersions = config.supportedApiVersions || [version];
  if (config.swaggerEnabled) {
    try {
      const swaggerDoc = yaml.load(fs.readFileSync(openApiPath, 'utf8'));
      for (const supportedVersion of supportedVersions) {
        app.use(`/api/${supportedVersion}/docs`, swaggerAuthGuard, swaggerUi.serve, swaggerUi.setup({
          ...swaggerDoc,
          servers: (swaggerDoc.servers || []).map((server) => ({
            ...server,
            url: server.url.replace(`/api/${version}`, `/api/${supportedVersion}`),
          })),
        }, {
          customSiteTitle: 'VetManager Pro API',
          swaggerOptions: { persistAuthorization: false },
        }));
      }
      app.get('/api/docs', swaggerAuthGuard, (_req, res) => res.redirect(302, `/api/${config.defaultApiVersion}/docs`));
      logger.info(`Swagger UI at /api/${version}/docs`);
    } catch (error) {
      logger.warn('openapi.yaml not found - Swagger UI disabled', { error: error?.message });
    }
  } else {
    app.use(`/api/${version}/docs`, (_req, res) => res.status(404).json({ success: false, error: { message: 'Not found' } }));
  }
}

function registerOpenApiValidation(app) {
  if (!config.openApiValidate) return;

  try {
    const { middleware: openApiValidator } = require('express-openapi-validator');
    app.use(openApiValidator({
      apiSpec: openApiPath,
      // El frontend envía filtros (search, from, to, …) que el backend maneja de forma
      // flexible y que no siempre están declarados en el spec. Sin allowUnknownQueryParameters
      // el validador del gateway rechaza esas requests con 400 (p. ej. /medical-records?search=).
      // Coincide con la configuración de los validadores por servicio (serviceBase).
      validateRequests: { allowUnknownQueryParameters: true },
      validateResponses: false,
      validateSecurity: false,
      // El gateway es un proxy hacia muchos servicios; el spec no documenta cada subruta.
      // Sin ignoreUndocumented, express-openapi-validator devuelve 404 a TODA ruta no
      // documentada antes de llegar al proxy (rompia GDPR, waiting-room, retention, erase, etc.).
      // La existencia de ruta la valida el servicio destino; auth/RBAC/CSRF/WAF son middleware aparte.
      ignoreUndocumented: true,
      ignorePaths: /^\/health|^\/metrics|^\/api\/v\d+\/docs/,
    }));
    app.use((err, req, res, next) => {
      if (err.status === 400 && err.errors) {
        return res.status(400).json({
          success: false,
          error: { message: 'Request validation failed', code: 'VALIDATION_ERROR', details: err.errors },
        });
      }
      if (err.status === 405) {
        logger.warn('OpenAPI 405 method not allowed', { method: req.method, path: req.originalUrl });
        return res.status(405).json({
          success: false,
          error: { message: err.message || 'Method not allowed', code: 'METHOD_NOT_ALLOWED' },
        });
      }
      if (err.status === 404) {
        return res.status(404).json({
          success: false,
          error: { message: 'Not found', code: 'NOT_FOUND' },
        });
      }
      next(err);
    });
    logger.info('OpenAPI request validation enabled');
  } catch (error) {
    logger.warn('express-openapi-validator not available - request validation disabled', { error: error?.message });
  }
}

module.exports = { registerDocsRoutes, registerOpenApiValidation };
