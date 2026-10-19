const userModel   = require('../models/user.model');
const authService = require('../services/auth.service');

async function list(req, res, next) {
  try {
    const users = await userModel.findAll();
    res.json(users);
  } catch (err) { next(err); }
}

async function getOne(req, res, next) {
  try {
    const user = await userModel.findByUuid(req.params.uuid);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(user);
  } catch (err) { next(err); }
}

async function create(req, res, next) {
  try {
    if (await userModel.usernameExists(req.body.username)) {
      return res.status(409).json({ error: 'El nombre de usuario ya está en uso' });
    }
    if (await userModel.findByEmail(req.body.email)) {
      return res.status(409).json({ error: 'El email ya está registrado' });
    }

    const user = await userModel.create(req.body);
    req.auditNew = { uuid: user.uuid, username: user.username, role: user.role };
    res.status(201).json(user);
  } catch (err) { next(err); }
}

// Evita quedarse sin ningún administrador activo
async function isLastActiveAdmin(user) {
  return user.role === 'admin' && user.is_active && (await userModel.countActiveAdmins()) <= 1;
}

async function update(req, res, next) {
  try {
    const user = await userModel.findByUuid(req.params.uuid);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const changesRole = req.body.role !== undefined && req.body.role !== user.role;
    if (changesRole && await isLastActiveAdmin(user)) {
      return res.status(409).json({ error: 'No se puede quitar el rol al único administrador activo' });
    }
    if (req.body.email && req.body.email !== user.email) {
      const other = await userModel.findByEmail(req.body.email);
      if (other) return res.status(409).json({ error: 'El email ya está registrado' });
    }

    req.auditOld = { role: user.role, email: user.email, full_name: user.full_name };
    const updated = await userModel.update(req.params.uuid, req.body);
    req.auditNew = { role: updated.role, email: updated.email, full_name: updated.full_name };

    res.json(updated);
  } catch (err) { next(err); }
}

async function resetPassword(req, res, next) {
  try {
    const user = await userModel.findByUuid(req.params.uuid);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    await userModel.setPassword(user.id, req.body.newPassword);
    // Con la contraseña nueva, las sesiones abiertas con la anterior se cierran
    await authService.revokeAllForUser(user.id);
    res.json({ message: 'Contraseña restablecida exitosamente' });
  } catch (err) { next(err); }
}

async function toggleActive(req, res, next) {
  try {
    if (req.params.uuid === req.user.uuid) {
      return res.status(400).json({ error: 'No puede desactivar su propia cuenta' });
    }
    const user = await userModel.findByUuid(req.params.uuid);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (await isLastActiveAdmin(user)) {
      return res.status(409).json({ error: 'No se puede desactivar al único administrador activo' });
    }

    req.auditOld = { is_active: !!user.is_active };
    const updated = await userModel.setActive(user.uuid, !user.is_active);
    if (!updated.is_active) await authService.revokeAllForUser(user.id);
    req.auditNew = { is_active: !!updated.is_active };
    res.json(updated);
  } catch (err) { next(err); }
}

module.exports = { list, getOne, create, update, resetPassword, toggleActive };
