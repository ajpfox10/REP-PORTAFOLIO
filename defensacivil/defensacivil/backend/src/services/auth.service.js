const bcrypt         = require('bcryptjs');
const crypto         = require('crypto');
const jwt            = require('jsonwebtoken');
const config         = require('../config/env');
const { query, queryOne } = require('../config/database');
const userModel      = require('../models/user.model');

function signAccessToken(user) {
  return jwt.sign(
    { id: user.id, uuid: user.uuid, role: user.role, username: user.username },
    config.jwt.secret,
    { expiresIn: config.jwt.accessExpires }
  );
}

function signRefreshToken(user) {
  return jwt.sign(
    { id: user.id, uuid: user.uuid },
    config.jwt.refreshSecret,
    { expiresIn: config.jwt.refreshExpires }
  );
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function parseExpiresInMs(str) {
  const match = str.match(/^(\d+)([smhd])$/);
  if (!match) return 7 * 24 * 3600 * 1000;
  const [, n, unit] = match;
  const map = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return parseInt(n) * map[unit];
}

async function login(username, password) {
  const user = await userModel.findByUsername(username);
  if (!user) {
    const err = new Error('Credenciales inválidas'); err.status = 401; throw err;
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    const err = new Error('Credenciales inválidas'); err.status = 401; throw err;
  }

  const accessToken  = signAccessToken(user);
  const refreshToken = signRefreshToken(user);
  const hash         = hashToken(refreshToken);
  const expiresAt    = new Date(Date.now() + parseExpiresInMs(config.jwt.refreshExpires));

  await query(
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
    [user.id, hash, expiresAt]
  );

  await userModel.updateLastLogin(user.id);

  return {
    accessToken,
    refreshToken,
    user: { uuid: user.uuid, username: user.username, role: user.role, full_name: user.full_name },
  };
}

async function refreshTokens(refreshToken) {
  let decoded;
  try {
    decoded = jwt.verify(refreshToken, config.jwt.refreshSecret);
  } catch {
    const err = new Error('Refresh token inválido o expirado'); err.status = 401; throw err;
  }

  const hash  = hashToken(refreshToken);
  const saved = await queryOne(
    'SELECT * FROM refresh_tokens WHERE token_hash = ? AND is_revoked = 0 AND expires_at > NOW()',
    [hash]
  );

  if (!saved) {
    const err = new Error('Refresh token inválido o ya utilizado'); err.status = 401; throw err;
  }

  // Revoke old token (rotation)
  await query('UPDATE refresh_tokens SET is_revoked = 1 WHERE id = ?', [saved.id]);

  const user = await userModel.findById(decoded.id);
  if (!user || !user.is_active) {
    const err = new Error('Usuario no encontrado o inactivo'); err.status = 401; throw err;
  }

  const newAccessToken  = signAccessToken(user);
  const newRefreshToken = signRefreshToken(user);
  const newHash         = hashToken(newRefreshToken);
  const expiresAt       = new Date(Date.now() + parseExpiresInMs(config.jwt.refreshExpires));

  await query(
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
    [user.id, newHash, expiresAt]
  );

  return {
    accessToken:  newAccessToken,
    refreshToken: newRefreshToken,
    user: { uuid: user.uuid, username: user.username, role: user.role, full_name: user.full_name },
  };
}

async function logout(userId, refreshToken) {
  if (refreshToken) {
    const hash = hashToken(refreshToken);
    await query('UPDATE refresh_tokens SET is_revoked = 1 WHERE token_hash = ?', [hash]);
  } else {
    await query('UPDATE refresh_tokens SET is_revoked = 1 WHERE user_id = ?', [userId]);
  }
}

module.exports = { login, refreshTokens, logout };
