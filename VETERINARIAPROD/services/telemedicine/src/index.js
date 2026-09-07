'use strict';

require('dotenv').config();

const path = require('path');
const { buildApp, guardWrite, startService } = require('../../../shared/serviceBase');

const sessionsRouter = require('./routes/sessions.routes');
const statsRouter = require('./routes/stats.routes');
const platformsRouter = require('./routes/platforms.routes');
const { router: followUpsRouter } = require('./routes/follow-ups.routes');

const PORT = process.env.PORT || 3010;

const app = buildApp('telemedicine', (app, requirePerm) => {
  app.use('/tele/sessions', requirePerm('telemedicine:read'), guardWrite('telemedicine'), sessionsRouter);
  app.use('/tele/stats', requirePerm('telemedicine:read'), statsRouter);
  app.use('/tele/platforms', requirePerm('telemedicine:read'), platformsRouter);
  app.get('/tele/webrtc/config', requirePerm('telemedicine:read'), ...sessionsRouter.getWebrtcConfig);
  // /follow-ups is proxied directly by the gateway (not under /tele prefix)
  app.use('/follow-ups', requirePerm('telemedicine:read'), guardWrite('telemedicine'), followUpsRouter);
}, {
  specPath: path.join(__dirname, 'openapi.yaml'),
});

startService(app, 'telemedicine', PORT);
