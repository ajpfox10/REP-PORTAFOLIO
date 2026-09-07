'use strict';

/**
 * shared/csrf.js
 * CSRF (Cross-Site Request Forgery) protection.
 *
 * Strategy: Double-Submit Cookie pattern con HMAC firmado.
 *
 * Flujo:
 *   1. GET /csrf-token → genera token firmado con HMAC-SHA256, lo envía en
 *      cookie HttpOnly=false (debe ser leída por JS) y en el body.
 *   2. El frontend adjunta el token en el header X-CSRF-Token en cada mutación.
 *   3. csrfProtect middleware verifica que el header coincida con la cookie firmada.
 *
 * Excluido automáticamente para:
 *   - Requests con API Key (X-Api-Key) — los API clients no son browsers.
 *   - Métodos seguros (GET, HEAD, OPTIONS).
 *   - Rutas en CSRF_EXCLUDE_PATHS.
 *
 * Configuración:
 *   CSRF_SECRET      — clave HMAC (mínimo 32 bytes hex). Obligatorio en producción.
 *   CSRF_COOKIE_NAME — nombre de la cookie (default: _csrf)
 *   CSRF_TTL_SEC     — TTL del token en segundos (default: 3600 = 1h)
 *   CSRF_EXCLUDE_PATHS — rutas excluidas separadas por coma
 */

const crypto = require('crypto');
const { resolveCookiePolicy } = require('./cookiePolicy');

// En producción, CSRF_SECRET debe estar configurado explícitamente.
// Un secreto efímero por proceso invalida todos los tokens CSRF en cada reinicio.
let SECRET;
if (process.env.CSRF_SECRET) {
  SECRET = process.env.CSRF_SECRET;
} else {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'CSRF_SECRET debe estar configurado en producción. ' +
      'Generá un secreto con: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  SECRET = crypto.randomBytes(32).toString('hex');
}
const COOKIE_NAME = process.env.CSRF_COOKIE_NAME || '_csrf';
const TTL_SEC     = parseInt(process.env.CSRF_TTL_SEC || '3600');
const EXCLUDE_PATHS = new Set(
  (process.env.CSRF_EXCLUDE_PATHS || '/health,/metrics,/api/v1/auth/login,/api/v1/auth/refresh,/api/v1/auth/password-reset/request,/api/v1/auth/password-reset/confirm,/api/v1/auth/2fa/challenge,/api/v2/auth/2fa/challenge,/api/v1/payments/mp/webhook,/api/v1/payments/stripe/webhook')
    .split(',').map(p => p.trim()).filter(Boolean)
);

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function normalizePath(path) {
  const clean = String(path || '').split('?')[0] || '/';
  return clean.length > 1 ? clean.replace(/\/+$/, '') : clean;
}

function candidatePaths(req) {
  const paths = new Set([
    normalizePath(req.path),
    normalizePath(req.originalUrl),
    normalizePath(req.baseUrl ? `${req.baseUrl}${req.path || ''}` : ''),
  ]);

  const original = normalizePath(req.originalUrl);
  const versionless = original.replace(/^\/api\/v\d+/, '');
  if (versionless !== original) paths.add(versionless || '/');
  return paths;
}

function isExcluded(req) {
  const paths = candidatePaths(req);
  for (const rule of EXCLUDE_PATHS) {
    const normalized = normalizePath(rule);
    if (paths.has(normalized)) return true;
  }
  return false;
}

// ── Token generation / verification ──────────────────────────────────────────

function _sign(value) {
  return crypto.createHmac('sha256', SECRET).update(value).digest('hex');
}

/**
 * Genera un token CSRF firmado con HMAC.
 * Formato: {timestamp}.{nonce}.{hmac}
 */
function generateToken() {
  const ts    = Math.floor(Date.now() / 1000).toString(36);
  const nonce = crypto.randomBytes(16).toString('hex');
  const sig   = _sign(`${ts}.${nonce}`);
  return `${ts}.${nonce}.${sig}`;
}

/**
 * Verifica que el token sea válido y no haya expirado.
 * @param {string} token
 * @returns {boolean}
 */
function verifyToken(token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;

  const [ts, nonce, sig] = parts;

  // Timing-safe comparison
  const expected = Buffer.from(_sign(`${ts}.${nonce}`), 'hex');
  const actual   = Buffer.from(sig, 'hex');
  if (expected.length !== actual.length) return false;
  if (!crypto.timingSafeEqual(expected, actual)) return false;

  // Verificar expiración
  const issuedAt = parseInt(ts, 36);
  const now      = Math.floor(Date.now() / 1000);
  if (now - issuedAt > TTL_SEC) return false;

  return true;
}

// ── Middleware: emite el token ────────────────────────────────────────────────

/**
 * GET /csrf-token (o cualquier ruta que use este middleware)
 * Setea cookie _csrf y retorna el token en el body.
 */
function csrfToken(req, res) {
  const token = generateToken();
  const secureOverride = process.env.CSRF_COOKIE_SECURE === 'true'
    ? true
    : process.env.CSRF_COOKIE_SECURE === 'false'
      ? false
      : undefined;
  const { secure, sameSite } = resolveCookiePolicy(req, {
    sameSite: process.env.CSRF_COOKIE_SAME_SITE || 'strict',
    secureOverride,
  });

  res.cookie(COOKIE_NAME, token, {
    httpOnly: false,           // JS del frontend DEBE leer la cookie
    secure,
    sameSite,
    maxAge:   TTL_SEC * 1000,
    path:     '/',
  });

  return res.json({ success: true, data: { csrfToken: token } });
}

// ── Middleware: protege mutaciones ────────────────────────────────────────────

/**
 * Verifica X-CSRF-Token header.
 * Estrategia en dos capas:
 *   1. Siempre: verifica firma HMAC del header (el token fue emitido por este servidor).
 *   2. Cuando la cookie llega (same-origin): verifica que header === cookie (Double-Submit).
 *      En requests cross-origin SameSite:Strict bloquea la cookie — la firma HMAC es suficiente.
 * Salta automáticamente para GET/HEAD/OPTIONS y requests con X-Api-Key.
 */
function csrfProtect(req, res, next) {
  if (req.headers['x-api-key']) return next();
  if (SAFE_METHODS.has(req.method)) return next();
  if (isExcluded(req)) return next();

  const headerToken = req.headers['x-csrf-token'];
  if (!headerToken) {
    return res.status(403).json({
      success: false,
      error: { message: 'CSRF token missing', code: 'CSRF_MISSING' },
    });
  }

  // Verificación HMAC — token emitido y firmado por este servidor
  if (!verifyToken(headerToken)) {
    return res.status(403).json({
      success: false,
      error: { message: 'CSRF token invalid or expired', code: 'CSRF_INVALID' },
    });
  }

  // Double-Submit adicional cuando la cookie llega (same-origin con SameSite:Strict)
  const cookieToken = req.cookies?.[COOKIE_NAME];
  if (cookieToken && cookieToken !== headerToken) {
    return res.status(403).json({
      success: false,
      error: { message: 'CSRF token mismatch', code: 'CSRF_INVALID' },
    });
  }

  next();
}

module.exports = { csrfProtect, csrfToken, generateToken, verifyToken, isExcluded };
