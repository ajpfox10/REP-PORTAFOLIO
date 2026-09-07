'use strict';

require('dotenv').config();

const path = require('path');
const { buildApp, guardWrite, startService } = require('../../../shared/serviceBase');
const labRouter          = require('./routes/lab.routes');
const imagingRouter      = require('./routes/imaging.routes');
const surgeryRouter      = require('./routes/surgery.routes');
const hospitRouter       = require('./routes/hospitalization.routes');
const vaccinationRouter  = require('./routes/vaccination.routes');
const pathologyRouter    = require('./routes/pathology.routes');

const app = buildApp('lab-imaging', (app, requirePerm) => {
  app.use('/lab',              requirePerm('lab:read'),             guardWrite('lab'),            labRouter);
  app.use('/imaging',          requirePerm('imaging:read'),         guardWrite('imaging'),        imagingRouter);
  app.use('/pathology',        requirePerm('lab:read'),             guardWrite('lab'),            pathologyRouter);
  app.use('/surgeries',        requirePerm('surgery:read'),         guardWrite('surgery'),        surgeryRouter);
  app.use('/hospitalizations', requirePerm('hospitalization:read'), guardWrite('hospitalization'), hospitRouter);
  app.use('/vaccinations',     requirePerm('vaccinations:read'),    guardWrite('vaccinations'),   vaccinationRouter);
  app.get('/deworming', requirePerm('deworming:read'), ...vaccinationRouter.getDeworming);
  app.get('/deworming/alerts', requirePerm('deworming:read'), ...vaccinationRouter.getDewormingAlerts);
  app.get('/deworming/products', requirePerm('deworming:read'), ...vaccinationRouter.getDewormingProducts);
  app.post('/deworming', requirePerm('deworming:read'), guardWrite('deworming'), ...vaccinationRouter.postDeworming);
}, { specPath: path.join(__dirname, 'openapi.yaml') });

const PORT = parseInt(process.env.PORT || '3004');
if (process.env.NODE_ENV !== 'test') {
  startService(app, 'lab-imaging', PORT);
}

module.exports = app;
