const userModel = require('../models/user.model');

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
    const existing = await userModel.findByUsername(req.body.username);
    if (existing) return res.status(409).json({ error: 'El nombre de usuario ya está en uso' });

    const byEmail = await userModel.findByEmail(req.body.email);
    if (byEmail) return res.status(409).json({ error: 'El email ya está registrado' });

    req.auditOld = null;
    const user = await userModel.create(req.body);
    req.auditNew = { uuid: user.uuid, username: user.username, role: user.role };
    res.status(201).json(user);
  } catch (err) { next(err); }
}

async function update(req, res, next) {
  try {
    const user = await userModel.findByUuid(req.params.uuid);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    req.auditOld = { role: user.role, is_active: user.is_active };
    const updated = await userModel.update(req.params.uuid, req.body);
    req.auditNew = { role: updated.role, is_active: updated.is_active };

    res.json(updated);
  } catch (err) { next(err); }
}

async function resetPassword(req, res, next) {
  try {
    const user = await userModel.findByUuid(req.params.uuid);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    await userModel.resetPassword(req.params.uuid, req.body.newPassword);
    res.json({ message: 'Contraseña restablecida exitosamente' });
  } catch (err) { next(err); }
}

async function toggleActive(req, res, next) {
  try {
    // Prevent admin from deactivating themselves
    if (req.params.uuid === req.user.uuid) {
      return res.status(400).json({ error: 'No puede desactivar su propia cuenta' });
    }
    const user = await userModel.toggleActive(req.params.uuid);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(user);
  } catch (err) { next(err); }
}

module.exports = { list, getOne, create, update, resetPassword, toggleActive };
