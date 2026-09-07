'use strict';

require('dotenv').config();

const { Router } = require('express');
const path = require('path');
const { buildApp, startService } = require('../../../shared/serviceBase');
const analyticsRoutes = require('./routes/reports.analytics.routes');
const exportRoutes = require('./routes/reports.export.routes');
const scheduledRoutes = require('./routes/reports.scheduled.routes');
const chartsRoutes = require('./routes/reports.charts.routes');

const router = Router();

router.use('/', analyticsRoutes);
router.use('/', exportRoutes);
router.use('/', chartsRoutes);

const scheduledRouter = Router();
scheduledRouter.use('/', scheduledRoutes);

const app = buildApp('reports', (app, requirePerm) => {
  app.use('/reports/scheduled', requirePerm('reports:write'), scheduledRouter);
  app.use('/reports', requirePerm('reports:read'), router);
}, { specPath: path.join(__dirname, 'openapi.yaml') });

const PORT = parseInt(process.env.PORT || '3008', 10);
if (process.env.NODE_ENV !== 'test') {
  startService(app, 'reports', PORT);
}

module.exports = app;
