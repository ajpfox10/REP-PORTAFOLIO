'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const { queryOne } = require('../db');
const { unauthorized, forbidden } = require('../lib/http');

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.isProduction,
    path: '/',
  };
}

function startSession(res, user) {
  const token = jwt.sign({ sub: String(user.id) }, config.session.secret, {
    expiresIn: Math.floor(config.session.maxAgeMs / 1000),
  });
  res.cookie(config.session.cookie, token, { ...cookieOptions(), maxAge: config.session.maxAgeMs });
}

function endSession(res) {
  res.clearCookie(config.session.cookie, cookieOptions());
}

// Lee la sesión si existe. El usuario se vuelve a buscar en la base para que
// un cambio de rol o una baja tengan efecto inmediato.
async function loadUser(req, res, next) {
  const token = req.cookies?.[config.session.cookie];
  if (!token) return next();
  try {
    const payload = jwt.verify(token, config.session.secret);
    req.user = await queryOne(
      'SELECT id, name, email, phone, address, role FROM users WHERE id = :id',
      { id: Number(payload.sub) }
    );
    if (!req.user) endSession(res);
  } catch {
    endSession(res);
  }
  return next();
}

function requireAuth(req, _res, next) {
  return next(req.user ? undefined : unauthorized());
}

function requireAdmin(req, _res, next) {
  if (!req.user) return next(unauthorized());
  return next(req.user.role === 'admin' ? undefined : forbidden());
}

module.exports = { loadUser, requireAuth, requireAdmin, startSession, endSession };
