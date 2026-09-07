'use strict';

require('dotenv').config();

const path = require('path');
const { buildApp, startService } = require('../../../shared/serviceBase');

const inboxRouter = require('./routes/inbox.routes');
const accountsRouter = require('./routes/accounts.routes');
const providersRouter = require('./routes/providers.routes');

const app = buildApp('documents', (app, requirePerm) => {
  app.use('/documents/providers', requirePerm('org:update'), providersRouter);
  app.use('/documents/mail-accounts', requirePerm('org:update'), accountsRouter);
  app.use('/documents/inbox', requirePerm('medical_records:read'), inboxRouter);
}, { specPath: path.join(__dirname, 'openapi.yaml') });

const PORT = parseInt(process.env.PORT || '4062', 10);
if (process.env.NODE_ENV !== 'test') {
  startService(app, 'documents', PORT);
}

module.exports = app;
