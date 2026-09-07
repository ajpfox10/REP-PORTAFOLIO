'use strict';

require('dotenv').config();

const express = require('express');
const http = require('http');
const { morganMiddleware, logger } = require('./middleware/logger');
const { registerProxies } = require('./routes/proxy');
const { attachWebSocket } = require('./websocket');
const webhookWorker = require('../../shared/webhooks/worker');
const { securityTxtHandler } = require('./routes/security-txt');
const { registerHealthRoutes } = require('./bootstrap/health');
const { registerDocsRoutes, registerOpenApiValidation } = require('./bootstrap/docs');
const { registerSpaRoutes } = require('./bootstrap/spa');
const { registerNotFoundHandler, registerErrorHandlers } = require('./bootstrap/errors');
const { attachRuntime } = require('./bootstrap/lifecycle');
const { registerCoreMiddleware, registerApiMiddleware, registerMetricsRoute } = require('./bootstrap/middleware');
const { config } = require('./config');

const app = express();
const server = http.createServer(app);

app.get('/.well-known/security.txt', securityTxtHandler);

registerHealthRoutes(app, config.apiVersion);
registerCoreMiddleware(app, { logger, morganMiddleware });
registerApiMiddleware(app, { config });
registerMetricsRoute(app, { config });
registerDocsRoutes(app, config.apiVersion);
registerOpenApiValidation(app);
registerProxies(app);
registerSpaRoutes(app);
registerNotFoundHandler(app);
registerErrorHandlers(app);

if (config.env !== 'test') {
  attachRuntime(server, {
    port: config.port,
    version: config.apiVersion,
    attachWebSocket,
    webhookWorker,
  });
}

module.exports = app;
