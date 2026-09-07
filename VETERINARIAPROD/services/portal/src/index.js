'use strict';

require('dotenv').config();

const path = require('path');
const { buildApp, startService } = require('../../../shared/serviceBase');

const authRoutes = require('./routes/portal.auth.routes');
const profileRoutes = require('./routes/portal.profile.routes');
const petsRoutes = require('./routes/portal.pets.routes');
const appointmentsRoutes = require('./routes/portal.appointments.routes');
const billingRoutes = require('./routes/portal.billing.routes');
const notificationsRoutes = require('./routes/portal.notifications.routes');
const fcmRoutes = require('./routes/portal.fcm.routes');
const telemedicineRoutes = require('./routes/portal.telemedicine.routes');
const app = buildApp('portal', (app) => {
  app.use('/portal/auth', authRoutes);
  app.use('/portal/me', profileRoutes);
  app.use('/portal/pets', petsRoutes);
  app.use('/portal/appointments', appointmentsRoutes);
  app.use('/portal/invoices', billingRoutes);
  app.use('/portal/notifications', notificationsRoutes);
  app.use('/portal/fcm', fcmRoutes);
  app.use('/portal/telemedicine', telemedicineRoutes);
}, {
  specPath: path.join(__dirname, 'openapi.yaml'),
  jsonLimit: '100kb',  // BUG-018: reducido de 5mb
  urlencoded: true,
});

const PORT = parseInt(process.env.PORT || '3010', 10);
if (process.env.NODE_ENV !== 'test') {
  startService(app, 'portal', PORT, { drainMs: 10_000 });
}

module.exports = app;
