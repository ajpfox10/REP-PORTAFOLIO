'use strict';

require('dotenv').config();

const path = require('path');
const { buildApp, guardWrite, startService } = require('../../../shared/serviceBase');
const appointmentsRouter = require('./routes/appointments.routes');
const groomersRouter = require('./routes/groomers.routes');
const profileRouter = require('./routes/patient-profile.routes');
const serviceTypesRouter = require('./routes/service-types.routes');
const healthRoutes = require('./routes/health.routes');

const app = buildApp('grooming', (app, requirePerm) => {
  app.use('/grooming/appointments', requirePerm('grooming:read'), guardWrite('grooming'), appointmentsRouter);
  app.use('/grooming/groomers', requirePerm('grooming:read'), guardWrite('grooming'), groomersRouter);
  app.use('/grooming/patient-profile', requirePerm('grooming:read'), guardWrite('grooming'), profileRouter);
  app.use('/grooming/service-types', requirePerm('grooming:read'), guardWrite('grooming'), serviceTypesRouter);
  app.use('/health', healthRoutes);
}, { specPath: path.join(__dirname, 'openapi.yaml') });

const PORT = parseInt(process.env.PORT || '3007', 10);
if (process.env.NODE_ENV !== 'test') {
  startService(app, 'grooming', PORT);
}

module.exports = app;
