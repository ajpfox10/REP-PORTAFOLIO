'use strict';

const { HttpError } = require('../lib/http');

function notFoundHandler(_req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Ruta no encontrada' } });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'BAD_JSON', message: 'El cuerpo del pedido no es JSON válido' } });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'TOO_LARGE', message: 'El pedido es demasiado grande' } });
  }
  if (err.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ error: { code: 'DUPLICATE', message: 'Ese dato ya está registrado' } });
  }
  // Nunca se expone el detalle interno; queda solo en el log del servidor
  console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  return res.status(500).json({ error: { code: 'INTERNAL', message: 'Ocurrió un error inesperado. Probá de nuevo en unos minutos.' } });
}

module.exports = { notFoundHandler, errorHandler };
