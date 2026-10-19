const bcrypt      = require('bcryptjs');
const authService = require('../services/auth.service');
const userModel   = require('../models/user.model');
const config      = require('../config/env');
const { query }   = require('../config/database');

// El refresh token vive en una cookie httpOnly: el JavaScript de la página no
// puede leerlo, así que un script inyectado no puede robar la sesión.
// El access token (corto) viaja en el cuerpo y el frontend lo guarda en memoria.
const COOKIE_NAME = 'dc_refresh';

function cookieOptions() {
  return {
    httpOnly: true,
    secure:   config.cookie.secure || config.cookie.sameSite === 'none',
    sameSite: config.cookie.sameSite,
    path:     '/api/auth',
  };
}

function setSessionCookie(res, refreshToken) {
  res.cookie(COOKIE_NAME, refreshToken, { ...cookieOptions(), maxAge: authService.refreshMaxAgeMs() });
}

function audit(userId, action, req) {
  return query(
    'INSERT INTO audit_logs (user_id, action, entity_type, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)',
    [userId, action, 'users', req.ip || null, req.headers['user-agent']?.slice(0, 255) || null]
  );
}

async function login(req, res, next) {
  try {
    const { refreshToken, userId, ...session } = await authService.login(req.body.username, req.body.password);
    setSessionCookie(res, refreshToken);
    await audit(userId, 'LOGIN', req);
    res.json(session);
  } catch (err) {
    next(err);
  }
}

async function refresh(req, res, next) {
  try {
    const { refreshToken, userId: _userId, ...session } = await authService.refreshTokens(req.cookies?.[COOKIE_NAME]);
    setSessionCookie(res, refreshToken);
    res.json(session);
  } catch (err) {
    if (err.status === 401) res.clearCookie(COOKIE_NAME, cookieOptions());
    next(err);
  }
}

async function logout(req, res, next) {
  try {
    await authService.logout(req.cookies?.[COOKIE_NAME]);
    res.clearCookie(COOKIE_NAME, cookieOptions());
    res.json({ message: 'Sesión cerrada exitosamente' });
  } catch (err) {
    next(err);
  }
}

async function me(req, res, next) {
  try {
    const user = await userModel.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(user);
  } catch (err) {
    next(err);
  }
}

async function changePassword(req, res, next) {
  try {
    const hash  = await userModel.getPasswordHash(req.user.id);
    const valid = hash && await bcrypt.compare(req.body.currentPassword, hash);
    if (!valid) {
      return res.status(400).json({ error: 'La contraseña actual es incorrecta' });
    }
    await userModel.setPassword(req.user.id, req.body.newPassword);

    // Se cierran las demás sesiones y se emite una nueva para este dispositivo
    await authService.revokeAllForUser(req.user.id);
    const { refreshToken, userId: _userId, ...session } = await authService.login(req.user.username, req.body.newPassword);
    setSessionCookie(res, refreshToken);
    await audit(req.user.id, 'CHANGE_PASSWORD', req);
    res.json({ message: 'Contraseña actualizada exitosamente', ...session });
  } catch (err) {
    next(err);
  }
}

module.exports = { login, refresh, logout, me, changePassword, COOKIE_NAME };
