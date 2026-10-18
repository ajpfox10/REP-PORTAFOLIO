'use strict';

class HttpError extends Error {
  constructor(status, message, code, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const badRequest = (message, code = 'BAD_REQUEST', details) => new HttpError(400, message, code, details);
const unauthorized = (message = 'Tenés que iniciar sesión') => new HttpError(401, message, 'UNAUTHORIZED');
const forbidden = (message = 'No tenés permiso para hacer esto') => new HttpError(403, message, 'FORBIDDEN');
const notFound = (message = 'No encontramos lo que buscás') => new HttpError(404, message, 'NOT_FOUND');
const conflict = (message, code = 'CONFLICT', details) => new HttpError(409, message, code, details);

// Envuelve handlers async para que los errores lleguen al manejador central
const handle = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { HttpError, badRequest, unauthorized, forbidden, notFound, conflict, handle };
