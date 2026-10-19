const logger = require('../config/logger');

function errorHandler(err, req, res, _next) {
  // JSON mal formado o cuerpo demasiado grande
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'El cuerpo de la solicitud no es JSON válido' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'La solicitud es demasiado grande' });
  }
  if (err.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ error: 'Ya existe un registro con esos datos' });
  }
  if (err.code === 'ER_NO_REFERENCED_ROW_2') {
    return res.status(422).json({ error: 'Alguno de los datos relacionados no existe' });
  }

  const status = err.status || err.statusCode || 500;
  if (status >= 500) {
    logger.error('Error no controlado', {
      message: err.message,
      stack:   err.stack,
      url:     req.originalUrl,
      method:  req.method,
      user:    req.user?.uuid,
    });
  }

  // El detalle técnico queda en el log, nunca en la respuesta
  res.status(status).json({ error: status >= 500 ? 'Error interno del servidor' : err.message });
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

module.exports = { errorHandler, httpError };
