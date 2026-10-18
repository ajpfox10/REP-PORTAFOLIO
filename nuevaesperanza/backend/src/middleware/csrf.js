'use strict';

const crypto = require('crypto');
const config = require('../config');
const { HttpError } = require('../lib/http');

const COOKIE = 'ne_csrf';
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

// Double-submit: el navegador manda la cookie sola, pero solo el JavaScript de
// nuestro propio sitio puede leerla y repetirla en el header X-CSRF-Token.
function csrf(req, res, next) {
  let token = req.cookies?.[COOKIE];
  if (!token) {
    token = crypto.randomBytes(24).toString('base64url');
    res.cookie(COOKIE, token, { sameSite: 'strict', secure: config.isProduction, path: '/' });
  }
  res.locals.csrfToken = token;
  if (SAFE.has(req.method)) return next();

  const header = req.get('x-csrf-token') || '';
  const valid = header.length === token.length
    && crypto.timingSafeEqual(Buffer.from(header), Buffer.from(token));
  return next(valid ? undefined : new HttpError(403, 'La sesión de seguridad venció. Recargá la página.', 'CSRF_INVALID'));
}

module.exports = { csrf };
