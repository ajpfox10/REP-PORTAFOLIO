'use strict';

require('dotenv').config();
require('express-async-errors');

const path = require('path');
const cookieParser = require('cookie-parser');
const { getJwks } = require('../../../shared/jwt');
const { scanSuspiciousAccessPatterns } = require('../../../shared/securityAlerts');
const {
  helmetMiddleware,
  hppMiddleware,
  compressionMiddleware,
  sanitize,
  requestId,
} = require('../../../shared/security');
const { correlationId } = require('../../../shared/correlationId');
const { requireInternalSig } = require('../../../shared/internalAuth');
const { buildApp, startService } = require('../../../shared/serviceBase');
const { createLogger } = require('../../../shared/logger');
const { syncRecentRevocations } = require('./controllers/auth.controller');

const log = createLogger('auth');
const PORT = parseInt(process.env.PORT || '3001', 10);
const alertScanIntervalMs = Math.max(30000, parseInt(process.env.SECURITY_ALERT_SCAN_INTERVAL_MS || '60000', 10));
const alertScanWindowMinutes = parseInt(process.env.SECURITY_ALERT_SCAN_WINDOW_MINUTES || '1', 10);
const revocationSyncIntervalMs = Math.max(30000, parseInt(process.env.AUTH_REVOCATION_SYNC_INTERVAL_MS || '60000', 10));

const AUTH_PUBLIC_PATHS = [
  '/captcha/config',
  '/login',
  '/refresh',
  '/logout',
  '/password-reset/request',
  '/password-reset/confirm',
  '/2fa/challenge',
  '/.well-known/jwks.json',
  /^\/sso\/[^/]+\/connect$/,
  /^\/sso\/[^/]+\/callback$/,
];

const app = buildApp('auth', (app) => {
  app.use('/', require('./routes/auth.routes'));
  // OT-070: /roles alias — exposes static role list to authenticated frontend users
  // without requireInternalSig (the canonical path /admin/rbac/roles is internal-only)
  const { ROLE_PERMISSIONS } = require('../../../shared/rbac');
  app.get('/roles', (req, res) => {
    const roles = Object.entries(ROLE_PERMISSIONS).map(([name, perms]) => ({ name, permissions: perms }));
    res.json({ success: true, data: roles });
  });
  // OT-061: all audit routes are individually protected by requireAdminRole + requireOrgContext;
  // requireInternalSig is not needed as an extra gateway layer.
  app.use('/audit', require('./routes/audit-export.routes'));
  app.use('/admin/rbac', require('./routes/admin-rbac.routes'));
  app.use('/admin/features', require('./routes/admin-feature-flags.routes'));
  app.use('/admin/auth', require('./routes/admin-auth.routes'));
  app.use('/admin/preview', require('./routes/admin-table-preview.routes'));
  app.use('/admin', require('./routes/admin-users.routes'));
  app.use('/admin/data-governance', requireInternalSig, require('./routes/data-governance.routes'));
  app.use('/admin/plugins', requireInternalSig, require('./routes/plugins.routes'));
  app.use('/me', requireInternalSig, require('./routes/ui-schema.routes'));
  app.use('/schema', require('./routes/schema.routes'));

  app.get('/.well-known/jwks.json', (_req, res) => {
    try {
      res.json(getJwks());
    } catch (err) {
      log.warn('JWKS unavailable', { error: err.message });
      res.status(503).json({ error: 'JWKS not available' });
    }
  });
}, {
  trustProxy: 1,
  jsonLimit: '256kb',
  preJsonMiddlewares: [
    helmetMiddleware,
    compressionMiddleware,
    requestId,
    correlationId,
    cookieParser(),
  ],
  postJsonMiddlewares: [
    hppMiddleware,
    sanitize,
  ],
  specPath: path.join(__dirname, 'openapi.yaml'),
  openApiOpts: {
    ignorePaths: /^\/(?:admin|audit|schema|me|\.well-known)\//,
    validateSecurity: false,
  },
  publicPaths: AUTH_PUBLIC_PATHS,
});

if (process.env.NODE_ENV !== 'test') {
  startService(app, 'auth', PORT, {
    drainMs: 10_000,
    onStarted: () => {
      const alertScanTimer = setInterval(() => {
        scanSuspiciousAccessPatterns(alertScanWindowMinutes).catch((err) => {
          log.warn('Security alert scan failed', { error: err.message });
        });
      }, alertScanIntervalMs);

      const revocationSyncTimer = setInterval(() => {
        syncRecentRevocations().catch((err) => {
          log.warn('Revocation sync failed', { error: err.message });
        });
      }, revocationSyncIntervalMs);

      return { alertScanTimer, revocationSyncTimer };
    },
    onShutdown: async ({ startupState }) => {
      if (startupState?.alertScanTimer) clearInterval(startupState.alertScanTimer);
      if (startupState?.revocationSyncTimer) clearInterval(startupState.revocationSyncTimer);
    },
  });
}

module.exports = app;
