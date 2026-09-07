'use strict';

require('dotenv').config();

const path = require('path');
const { buildApp, startService } = require('../../../shared/serviceBase');
const { log } = require('./ai.common');

const diagnosisRoutes = require('./routes/diagnosis.routes');
const imagesRoutes = require('./routes/images.routes');
const chatRoutes = require('./routes/chat.routes');
const riskRoutes = require('./routes/risk.routes');
const ai = require('../../../shared/ai');

function aiApiErrorHandler(err, req, res, next) {
  if (err.code !== 'AI_API_ERROR') return next(err);
  log.error('[AI service]', { err: err.message, stack: err.stack, traceId: req.traceId || req.headers['x-trace-id'] });
  return res.status(502).json({
    success: false,
    error: {
      message: 'Error al consultar el modelo de IA',
      code: 'SVC_001',
      details: err.message,
      ...(req.requestId ? { requestId: req.requestId } : {}),
      ...(req.traceId ? { traceId: req.traceId } : {}),
    },
  });
}

function createAiApp(specPath = path.join(__dirname, 'openapi.yaml')) {
  const app = buildApp('ai', (app) => {
    app.use('/ai/diagnosis', diagnosisRoutes);
    app.use('/ai/images', imagesRoutes);
    app.use('/ai/chat', chatRoutes);
    app.use('/ai/patients', riskRoutes);
  }, { specPath, errorHandlers: [aiApiErrorHandler] });

  return app;
}

const app = createAiApp();

if (require.main === module) {
  const PORT = process.env.PORT || 4061;
  startService(app, 'ai', PORT);
  log.info(`AI service provider configured: ${ai.PROVIDER}`);
}

module.exports = app;
module.exports.buildApp = createAiApp;
