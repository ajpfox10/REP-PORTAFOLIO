'use strict';

require('dotenv').config();

const path = require('path');
const { buildApp, guardWrite, startService } = require('../../../shared/serviceBase');

const clientsRouter  = require('./routes/clients.routes');
const patientsRouter = require('./routes/patients.routes');
const branchesRouter = require('./routes/branches.routes');

const app = buildApp('patients', (app, requirePerm) => {
  app.use('/clients',  requirePerm('clients:read'),  guardWrite('clients'),  clientsRouter);
  app.use('/patients', requirePerm('patients:read'), guardWrite('patients'), patientsRouter);
  app.get('/species/all', requirePerm('patients:read'), ...patientsRouter.getSpeciesAll);
  app.get('/breeds/all',  requirePerm('patients:read'), ...patientsRouter.getBreedsAll);
  app.use('/branches', requirePerm('branches:read'), guardWrite('branches'), branchesRouter);
}, { specPath: path.join(__dirname, 'openapi.yaml') });

const PORT = parseInt(process.env.PORT || '3002');
if (process.env.NODE_ENV !== 'test') {
  startService(app, 'patients', PORT);
}

module.exports = app;
