const authService = require('../services/auth.service');
const userModel   = require('../models/user.model');
const bcrypt      = require('bcryptjs');
const { query }   = require('../config/database');

async function login(req, res, next) {
  try {
    const result = await authService.login(req.body.username, req.body.password);

    // Audit log
    req.auditNew = { username: req.body.username, role: result.user.role };
    await query(
      'INSERT INTO audit_logs (user_id, action, entity_type, ip_address, user_agent) SELECT id, ?, ?, ?, ? FROM users WHERE username = ?',
      ['LOGIN', 'users', req.ip, req.headers['user-agent']?.slice(0, 255), req.body.username]
    );

    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function refresh(req, res, next) {
  try {
    const result = await authService.refreshTokens(req.body.refreshToken);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function logout(req, res, next) {
  try {
    await authService.logout(req.user.id, req.body.refreshToken);
    await query(
      'INSERT INTO audit_logs (user_id, action, entity_type, ip_address) VALUES (?, ?, ?, ?)',
      [req.user.id, 'LOGOUT', 'users', req.ip]
    );
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
    const user = await userModel.findByUsername(req.user.username);
    const valid = await bcrypt.compare(req.body.currentPassword, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Contraseña actual incorrecta' });
    }
    await userModel.changePassword(req.user.id, req.body.newPassword);
    res.json({ message: 'Contraseña actualizada exitosamente' });
  } catch (err) {
    next(err);
  }
}

module.exports = { login, refresh, logout, me, changePassword };
