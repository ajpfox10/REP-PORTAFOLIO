'use strict';

/**
 * shared/passwordPolicy.js
 * Validación de fortaleza de contraseñas.
 *
 * Reglas (configurables via env):
 *   PASSWORD_MIN_LENGTH        — mínimo de caracteres (default: 10)
 *   PASSWORD_REQUIRE_UPPERCASE — requiere mayúsculas (default: true)
 *   PASSWORD_REQUIRE_LOWERCASE — requiere minúsculas (default: true)
 *   PASSWORD_REQUIRE_DIGIT     — requiere dígito (default: true)
 *   PASSWORD_REQUIRE_SPECIAL   — requiere carácter especial (default: true)
 *   PASSWORD_MAX_LENGTH        — máximo de caracteres (default: 128) — previene DoS en bcrypt
 *   PASSWORD_FORBID_COMMON     — rechaza contraseñas del top-100 más usadas (default: true)
 *
 * Uso:
 *   const { validatePassword } = require('./passwordPolicy');
 *   const result = validatePassword(newPassword);
 *   if (!result.valid) return res.status(400).json({ error: result.errors.join(', ') });
 *
 *   // O lanzar directo:
 *   enforcePassword(newPassword);   // lanza AppError si no pasa
 */

const { AppError } = require('./errors');
const { createLogger } = require('./logger');

const log = createLogger('password-policy');

// ── Configuración ─────────────────────────────────────────────────────────────

const MIN_LENGTH        = parseInt(process.env.PASSWORD_MIN_LENGTH  || '10');
const MAX_LENGTH        = parseInt(process.env.PASSWORD_MAX_LENGTH  || '128');
const REQUIRE_UPPERCASE = process.env.PASSWORD_REQUIRE_UPPERCASE !== 'false';
const REQUIRE_LOWERCASE = process.env.PASSWORD_REQUIRE_LOWERCASE !== 'false';
const REQUIRE_DIGIT     = process.env.PASSWORD_REQUIRE_DIGIT     !== 'false';
const REQUIRE_SPECIAL   = process.env.PASSWORD_REQUIRE_SPECIAL   !== 'false';
const FORBID_COMMON     = process.env.PASSWORD_FORBID_COMMON     !== 'false';

// Top 100 contraseñas más comunes — incluye variaciones de teclado y contraseñas de animales/nombres
// relevantes al dominio veterinario
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '123456', '12345678', '123456789',
  '1234567890', 'qwerty', 'qwerty123', 'abc123', 'letmein', 'iloveyou',
  'admin', 'admin123', 'administrator', 'root', 'root123', 'pass', 'pass123',
  'welcome', 'welcome1', 'monkey', 'dragon', 'master', 'hello', 'hello123',
  'sunshine', 'princess', 'shadow', 'superman', 'michael', 'jessica', 'charlie',
  '111111', '1111111', '12345', '654321', '000000', '0000', '1234', 'pass@123',
  'p@ssword', 'p@ssw0rd', 'pass@word', 'p@$$word', 'pa$$word', 'passw0rd',
  'veterinaria', 'veterinary', 'vetmanager', 'vetapp', 'clinica', 'clinic',
  'mascota', 'mascotas', 'animal', 'animales', 'perro', 'gato', 'dog', 'cat',
  'changeme', 'change_me', 'secret', 'secret123', 'test', 'test123', 'demo',
  'demo123', 'user', 'user123', 'guest', 'guest123', 'login', 'login123',
  'trustno1', 'baseball', 'football', 'soccer', 'batman', 'spider', 'star',
  'mustang', 'porsche', 'ferrari', 'harley', 'matrix', 'computer', 'internet',
  'qazwsx', 'zxcvbn', 'asdfgh', 'qwertyui', '147258369', '987654321',
]);

// ── Validación ────────────────────────────────────────────────────────────────

/**
 * Valida la fortaleza de una contraseña.
 * @param {string} password
 * @param {object} [ctx] — contexto para detectar contraseñas basadas en datos del usuario
 * @param {string} [ctx.email]     — email del usuario (la contraseña no debe contenerlo)
 * @param {string} [ctx.firstName] — nombre del usuario
 * @param {string} [ctx.lastName]  — apellido del usuario
 * @returns {{ valid: boolean, errors: string[], score: number }}
 */
function validatePassword(password, ctx = {}) {
  const errors = [];

  if (!password || typeof password !== 'string') {
    return { valid: false, errors: ['La contraseña es requerida'], score: 0 };
  }

  // Límite superior — bcrypt trunca a 72 bytes, payloads largos son DoS
  if (password.length > MAX_LENGTH) {
    errors.push(`La contraseña no puede superar ${MAX_LENGTH} caracteres`);
  }

  // Longitud mínima
  if (password.length < MIN_LENGTH) {
    errors.push(`La contraseña debe tener al menos ${MIN_LENGTH} caracteres`);
  }

  // Mayúsculas
  if (REQUIRE_UPPERCASE && !/[A-Z]/.test(password)) {
    errors.push('Debe contener al menos una letra mayúscula');
  }

  // Minúsculas
  if (REQUIRE_LOWERCASE && !/[a-z]/.test(password)) {
    errors.push('Debe contener al menos una letra minúscula');
  }

  // Dígitos
  if (REQUIRE_DIGIT && !/\d/.test(password)) {
    errors.push('Debe contener al menos un número');
  }

  // Carácter especial
  if (REQUIRE_SPECIAL && !/[^A-Za-z0-9]/.test(password)) {
    errors.push('Debe contener al menos un carácter especial (!@#$%^&*...)');
  }

  // Contraseñas comunes
  if (FORBID_COMMON && COMMON_PASSWORDS.has(password.toLowerCase())) {
    errors.push('Esta contraseña es demasiado común. Elegí una más difícil de adivinar');
  }

  // Contraseña basada en datos del usuario
  if (ctx.email) {
    const emailLocal = ctx.email.split('@')[0].toLowerCase();
    if (password.toLowerCase().includes(emailLocal) && emailLocal.length >= 3) {
      errors.push('La contraseña no puede contener tu email');
    }
  }
  if (ctx.firstName && ctx.firstName.length >= 3 &&
      password.toLowerCase().includes(ctx.firstName.toLowerCase())) {
    errors.push('La contraseña no puede contener tu nombre');
  }
  if (ctx.lastName && ctx.lastName.length >= 3 &&
      password.toLowerCase().includes(ctx.lastName.toLowerCase())) {
    errors.push('La contraseña no puede contener tu apellido');
  }

  // Caracteres repetidos (ej: "aaaaaaa", "1111111")
  if (/(.)\1{4,}/.test(password)) {
    errors.push('La contraseña no puede tener 5 o más caracteres idénticos consecutivos');
  }

  // Calcular score para feedback al frontend (0-4)
  const score = _calculateScore(password, errors.length);

  return { valid: errors.length === 0, errors, score };
}

/**
 * Mismo que validatePassword pero lanza AppError en caso de fallo.
 * Usar en controllers para acortar el código.
 */
function enforcePassword(password, ctx = {}) {
  const result = validatePassword(password, ctx);
  if (!result.valid) {
    throw new AppError(
      { message: result.errors[0], code: 'PASSWORD_POLICY_VIOLATION', http: 400 },
      null,
      { errors: result.errors }
    );
  }
}

/**
 * Calcula un score de fortaleza 0-4 para feedback visual en el frontend.
 * 0 = muy débil, 4 = muy fuerte
 */
function _calculateScore(password, errorCount) {
  if (errorCount > 0) return Math.max(0, 1 - Math.floor(errorCount / 2));

  let score = 0;
  if (password.length >= 12) score++;
  if (password.length >= 16) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score++;

  return Math.min(score, 4);
}

/**
 * Middleware Express para validar la contraseña en el body.
 * @param {string} [field='password'] — nombre del campo en req.body
 * @param {object} [opts]
 * @param {Function} [opts.getCtx] — función async que recibe req y retorna ctx {email, firstName, lastName}
 */
function passwordPolicyMiddleware(field = 'password', opts = {}) {
  return async function(req, res, next) {
    const password = req.body?.[field];
    if (!password) return next();  // dejar que la validación de schema lo maneje

    let ctx = {};
    if (opts.getCtx) {
      try { ctx = await opts.getCtx(req); } catch (err) {
        log.warn('Password policy context lookup failed', { error: err.message });
      }
    }

    const result = validatePassword(password, ctx);
    if (!result.valid) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'La contraseña no cumple los requisitos de seguridad',
          code:    'PASSWORD_POLICY_VIOLATION',
          details: result.errors,
        },
      });
    }
    next();
  };
}

module.exports = { validatePassword, enforcePassword, passwordPolicyMiddleware };
