'use strict';

require('dotenv').config();

const path = require('path');
const { buildApp, guardWrite, startService } = require('../../../shared/serviceBase');
const apptRouter   = require('./routes/appointments.routes');
const mrRouter     = require('./routes/medical-records.routes');
const rulesRouter  = require('./routes/rules.routes');
const { router: rulesEvaluateRouter } = require('./routes/rules.evaluate.routes');

const app = buildApp('medical', (app, requirePerm) => {
  app.use('/appointments',    requirePerm('appointments:read'),    guardWrite('appointments'),    apptRouter);
  app.use('/medical-records', requirePerm('medical_records:read'), guardWrite('medical_records'), mrRouter);
  app.get('/appointments/types', requirePerm('appointments:read'), ...apptRouter.getAppointmentTypes);
  app.post('/triage/:id', requirePerm('appointments:create'), ...apptRouter.postTriage);
  app.get('/prescriptions/:id', requirePerm('medical_records:read'), ...mrRouter.getPrescriptions);
  app.post('/prescriptions/:id', requirePerm('medical_records:read'), guardWrite('medical_records'), ...mrRouter.postPrescriptions);
  app.use('/rules',           requirePerm('settings:read'),        rulesEvaluateRouter);
  app.use('/rules',           requirePerm('settings:read'),        guardWrite('settings'),        rulesRouter);
}, { specPath: path.join(__dirname, 'openapi.yaml') });

const PORT = parseInt(process.env.PORT || '3003');
if (process.env.NODE_ENV !== 'test') {
  startService(app, 'medical', PORT);
}

module.exports = app;
