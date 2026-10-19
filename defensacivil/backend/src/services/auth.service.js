const bcrypt         = require('bcryptjs');
const crypto         = require('crypto');
const jwt            = require('jsonwebtoken');
const config         = require('../config/env');
const { query, queryOne, execute } = require('../config/database');
const userModel      = require('../models/user.model');
const { httpError }  = require('../middleware/errorHandler');

// Hash de una contraseña que no existe: si el usuario no existe igual se hace
// la comparación, así el tiempo de respuesta no revela qué usuarios existen.
const DUMMY_HASH = bcrypt.hashSync('usuario-inexistente', 12);

function signAccessToken(user) {
  return jwt.sign(
    { id: user.id, uuid: user.uuid, role: user.role, username: user.username },
    config.jwt.secret,
    { expiresIn: config.jwt.accessExpires, algorithm: 'HS256' }
  );
}

function signRefreshToken(user) {
  // jti aleatorio: dos tokens emitidos en el mismo segundo nunca son iguales
  return jwt.sign(
    { id: user.id, uuid: user.uuid, jti: crypto.randomUUID() },
    config.jwt.refreshSecret,
    { expiresIn: config.jwt.refreshExpires, algorithm: 'HS256' }
  );
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function parseExpiresInMs(str) {
  const match = String(str).match(/^(\d+)([smhd])$/);
  if (!match) return 7 * 24 * 3600 * 1000;
  const [, n, unit] = match;
  const map = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return parseInt(n, 10) * map[unit];
}

const refreshMaxAgeMs = () => parseExpiresInMs(config.jwt.refreshExpires);

function publicUser(user) {
  return { uuid: user.uuid, username: user.username, role: user.role, full_name: user.full_name };
}

async function issueSession(user) {
  const refreshToken = signRefreshToken(user);
  await query(
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
    [user.id, hashToken(refreshToken), new Date(Date.now() + refreshMaxAgeMs())]
  );
  return { accessToken: signAccessToken(user), refreshToken, userId: user.id, user: publicUser(user) };
}

async function login(username, password) {
  const user  = await userModel.findByUsername(String(username).toLowerCase());
  const valid = await bcrypt.compare(String(password), user ? user.password_hash : DUMMY_HASH);
  if (!user || !valid) throw httpError(401, 'Credenciales inválidas');

  const session = await issueSession(user);
  await userModel.updateLastLogin(user.id);
  return session;
}

async function refreshTokens(refreshToken) {
  if (!refreshToken) throw httpError(401, 'Sesión no iniciada');

  let decoded;
  try {
    decoded = jwt.verify(refreshToken, config.jwt.refreshSecret, { algorithms: ['HS256'] });
  } catch {
    throw httpError(401, 'Sesión vencida, ingrese nuevamente');
  }

  const saved = await queryOne(
    'SELECT id, user_id, is_revoked, expires_at FROM refresh_tokens WHERE token_hash = ?',
    [hashToken(refreshToken)]
  );
  if (!saved || saved.expires_at < new Date()) {
    throw httpError(401, 'Sesión vencida, ingrese nuevamente');
  }

  // Rotación: el token solo se puede usar una vez. El UPDATE condicional es
  // atómico, así dos pedidos simultáneos no pueden usar el mismo token.
  const revoked = await execute(
    'UPDATE refresh_tokens SET is_revoked = 1 WHERE id = ? AND is_revoked = 0',
    [saved.id]
  );
  if (revoked.affectedRows === 0) {
    // Un token ya usado volvió a aparecer: puede ser una copia robada.
    // Se cierran todas las sesiones de ese usuario.
    await revokeAllForUser(saved.user_id);
    throw httpError(401, 'La sesión fue cerrada por seguridad, ingrese nuevamente');
  }

  const user = await userModel.findById(decoded.id);
  if (!user || !user.is_active) throw httpError(401, 'Usuario no encontrado o inactivo');

  return issueSession(user);
}

// Al cerrar sesión los tokens se borran. Solo quedan marcados como revocados
// los que se rotaron: así reaparecer uno de esos indica una copia robada.
async function logout(refreshToken) {
  if (!refreshToken) return;
  await query('DELETE FROM refresh_tokens WHERE token_hash = ?', [hashToken(refreshToken)]);
}

async function revokeAllForUser(userId) {
  await query('DELETE FROM refresh_tokens WHERE user_id = ?', [userId]);
}

module.exports = { login, refreshTokens, logout, revokeAllForUser, refreshMaxAgeMs };
