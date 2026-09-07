'use strict';

/**
 * shared/passwordHash.js — OT-091
 *
 * Abstracción de hashing de contraseñas con migración transparente
 * bcryptjs → argon2id.
 *
 * ESTRATEGIA DE MIGRACIÓN:
 *   - Nuevas contraseñas: argon2id (si argon2 está instalado) o bcrypt (fallback).
 *   - Verificación: detecta el algoritmo por el prefijo del hash almacenado.
 *   - Migración automática: en cada login exitoso con hash bcrypt, se re-hashea
 *     con argon2 y se actualiza silenciosamente la DB.
 *
 * Para activar argon2:
 *   npm install argon2
 *   (no requiere cambio de código — autodetect al arranque)
 *
 * Hash prefixes:
 *   bcrypt:  $2a$... / $2b$...
 *   argon2:  $argon2id$...
 */

const bcrypt  = require('bcryptjs');
const { createLogger } = require('./logger');

const log = createLogger('passwordHash');

// Lazy-load argon2 to avoid hard boot failure if not installed yet
let _argon2 = null;
let _argon2Checked = false;

function getArgon2() {
  if (_argon2Checked) return _argon2;
  _argon2Checked = true;
  try {
    _argon2 = require('argon2');
    log.info('argon2 available — new passwords will use argon2id');
  } catch {
    log.info('argon2 not installed — using bcryptjs (run: npm install argon2)');
    _argon2 = null;
  }
  return _argon2;
}

const BCRYPT_ROUNDS  = parseInt(process.env.BCRYPT_ROUNDS   || '12', 10);
const ARGON2_OPTIONS = {
  type:        2,  // argon2id
  memoryCost:  65536,  // 64 MB
  timeCost:    3,
  parallelism: 4,
};

// Longitud máxima de contraseña aceptada antes de hashear.
// Argon2 no tiene límite interno y puede agotar CPU/memoria con payloads enormes (DoS).
// Bcrypt trunca en 72 bytes pero igual debe rechazarse antes.
// Esta constante debe coincidir con PASSWORD_MAX_LENGTH en passwordPolicy.js.
const HASH_MAX_LENGTH = parseInt(process.env.PASSWORD_MAX_LENGTH || '128', 10);

/**
 * Hash a plaintext password.
 * Uses argon2id if available, bcrypt otherwise.
 *
 * @param {string} password
 * @returns {Promise<string>} — password hash
 */
async function hash(password) {
  if (!password || typeof password !== 'string') {
    throw new Error('passwordHash.hash: password debe ser un string no vacío');
  }
  // Rechazar payloads que excedan el límite — previene DoS en argon2
  if (password.length > HASH_MAX_LENGTH) {
    throw new Error(`passwordHash.hash: password supera el límite de ${HASH_MAX_LENGTH} caracteres`);
  }
  const argon2 = getArgon2();
  if (argon2) {
    return argon2.hash(password, ARGON2_OPTIONS);
  }
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/**
 * Verify a password against a stored hash.
 * Automatically detects bcrypt vs argon2 by hash prefix.
 *
 * @param {string} password   — plaintext
 * @param {string} storedHash — from DB
 * @returns {Promise<boolean>}
 */
async function verify(password, storedHash) {
  if (!storedHash) return false;
  // Rechazar payloads enormes antes de intentar la verificación (DoS en argon2)
  if (!password || typeof password !== 'string' || password.length > HASH_MAX_LENGTH) {
    return false;
  }

  if (storedHash.startsWith('$argon2')) {
    const argon2 = getArgon2();
    if (!argon2) throw new Error('argon2 hash in DB but argon2 module not installed');
    return argon2.verify(storedHash, password);
  }

  // bcrypt fallback ($2a$, $2b$, $2y$)
  return bcrypt.compare(password, storedHash);
}

/**
 * Returns true if the stored hash uses the legacy bcrypt algorithm.
 * Used by callers to decide whether to trigger transparent re-hashing.
 *
 * @param {string} storedHash
 * @returns {boolean}
 */
function isLegacyHash(storedHash) {
  return Boolean(storedHash) && !storedHash.startsWith('$argon2');
}

/**
 * Returns true if argon2 is available for use.
 */
function isArgon2Available() {
  return Boolean(getArgon2());
}

module.exports = { hash, verify, isLegacyHash, isArgon2Available };
