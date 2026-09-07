'use strict';

const express = require('express');
const cookieParser = require('cookie-parser');
const corsMiddleware = require('../middleware/cors');
const { correlationId } = require('../../../shared/correlationId');
const { sanitizeIncomingHeaders } = require('../../middleware/sanitizeIncomingHeaders');
const { subdomainMiddleware } = require('../middleware/subdomain');
const { versionNegotiationMiddleware, versioningMiddleware } = require('../middleware/versioning');
const { dlpMiddleware } = require('../middleware/dlp');
const { apiLimiter } = require('../middleware/rateLimiter');
const {
  helmetMiddleware,
  hppMiddleware,
  compressionMiddleware,
  sanitize,
  requestId,
  ipGuard,
  idempotency,
  dnsRebindingGuard,
  contentTypeGuard,
  cacheHeaders,
} = require('../../../shared/security');
const { httpMetrics, metricsHandler } = require('../../../shared/metrics');
const { auditMiddleware } = require('../../../shared/audit');
const { wafMiddleware } = require('../../../shared/waf');
const { csrfToken, csrfProtect } = require('../../../shared/csrf');

function registerCoreMiddleware(app, { morganMiddleware }) {
  app.set('trust proxy', 1);
  app.use(helmetMiddleware);
  app.use(compressionMiddleware);
  app.use(correlationId);
  app.use(requestId);
  app.use(ipGuard);
  app.use(dnsRebindingGuard);
  app.use(sanitizeIncomingHeaders);
  app.use(subdomainMiddleware);
  app.use(cookieParser());
  app.use(corsMiddleware);
  app.options('*', corsMiddleware);
  app.use(morganMiddleware);
}

function registerApiMiddleware(app, { config }) {
  app.get('/csrf-token', csrfToken);
  app.use('/api/:version/payments/stripe/webhook', express.raw({
    type: 'application/json',
    limit: config.jsonBodyLimit,
    verify: (req, _res, buf) => { req.rawBody = buf; },
  }));
  app.use(express.json({ limit: config.jsonBodyLimit }));
  app.use(express.urlencoded({ extended: true, limit: config.jsonBodyLimit }));
  app.use(hppMiddleware);
  app.use(sanitize);
  app.use(contentTypeGuard);
  app.use(cacheHeaders);
  app.use(wafMiddleware);
  app.use(versionNegotiationMiddleware);
  app.use('/api', apiLimiter);
  app.use(idempotency);
  app.use(httpMetrics('gateway'));
  app.use(auditMiddleware({ mode: config.auditMode }));
  app.use(versioningMiddleware);
  app.use('/api', csrfProtect);
  app.use(dlpMiddleware);
}

function registerMetricsRoute(app, { config }) {
  app.get('/metrics', (req, res, next) => {
    if (config.metricsToken) {
      const auth = req.headers.authorization;
      if (auth !== `Bearer ${config.metricsToken}`) {
        return res.status(401).json({ success: false, error: { message: 'Unauthorized' } });
      }
    } else if (config.env === 'production') {
      return res.status(403).json({ success: false, error: { message: 'Metrics disabled - set METRICS_TOKEN' } });
    }
    next();
  }, metricsHandler);
}

module.exports = {
  registerCoreMiddleware,
  registerApiMiddleware,
  registerMetricsRoute,
};
