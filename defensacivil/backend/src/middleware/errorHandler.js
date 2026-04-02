const logger = require('../config/logger');
const config = require('../config/env');

function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  logger.error('Error no controlado', {
    message: err.message,
    stack:   err.stack,
    url:     req.originalUrl,
    method:  req.method,
    user:    req.user?.uuid,
  });

  const response = { error: status === 500 ? 'Error interno del servidor' : err.message };
  if (config.nodeEnv !== 'production') {
    response.stack = err.stack;
  }
  res.status(status).json(response);
}

module.exports = { errorHandler };
