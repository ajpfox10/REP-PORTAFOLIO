'use strict';

const { Router } = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { query, queryOne } = require('../db');
const { validate } = require('../middleware/validate');
const { requireAuth, startSession, endSession } = require('../middleware/auth');
const { handle, unauthorized, conflict } = require('../lib/http');
const config = require('../config');

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.isTest ? 1000 : 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'TOO_MANY_ATTEMPTS', message: 'Demasiados intentos. Esperá unos minutos y probá de nuevo.' } },
});

const email = z.string().trim().toLowerCase().email('Ingresá un email válido').max(190);
const password = z.string()
  .min(8, 'La contraseña debe tener al menos 8 caracteres')
  .max(72, 'La contraseña es demasiado larga')
  .regex(/[A-Za-z]/, 'La contraseña debe tener al menos una letra')
  .regex(/[0-9]/, 'La contraseña debe tener al menos un número');
const name = z.string().trim().min(2, 'Ingresá tu nombre').max(120)
  .regex(/^[\p{L}\s'.-]+$/u, 'El nombre solo puede tener letras y espacios');
const phone = z.string().trim().max(40).regex(/^[0-9+()\s-]{6,}$/, 'Ingresá un teléfono válido');
const address = z.string().trim().min(5, 'Ingresá una dirección completa').max(255);

const registerSchema = z.object({
  name,
  email,
  password,
  phone: phone.optional().or(z.literal('')),
  address: address.optional().or(z.literal('')),
});

const loginSchema = z.object({ email, password: z.string().min(1, 'Ingresá tu contraseña').max(200) });

const profileSchema = z.object({
  name: name.optional(),
  phone: phone.optional().or(z.literal('')),
  address: address.optional().or(z.literal('')),
});

// Hash de referencia para comparar aunque el email no exista y no revelar
// por tiempo de respuesta qué cuentas están registradas.
const DUMMY_HASH = bcrypt.hashSync('nueva-esperanza-dummy', 12);

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, phone: user.phone, address: user.address, role: user.role };
}

router.post('/register', authLimiter, validate(registerSchema), handle(async (req, res) => {
  const data = req.valid.body;
  const exists = await queryOne('SELECT id FROM users WHERE email = :email', { email: data.email });
  if (exists) throw conflict('Ya hay una cuenta con ese email. Probá iniciar sesión.', 'EMAIL_TAKEN');
  const result = await query(
    `INSERT INTO users (name, email, password_hash, phone, address)
     VALUES (:name, :email, :hash, :phone, :address)`,
    { ...data, hash: await bcrypt.hash(data.password, 12), phone: data.phone || null, address: data.address || null }
  );
  const user = await queryOne('SELECT id, name, email, phone, address, role FROM users WHERE id = :id', { id: result.insertId });
  startSession(res, user);
  res.status(201).json({ user: publicUser(user) });
}));

router.post('/login', authLimiter, validate(loginSchema), handle(async (req, res) => {
  const { email: mail, password: pass } = req.valid.body;
  const user = await queryOne('SELECT * FROM users WHERE email = :email', { email: mail });
  const ok = await bcrypt.compare(pass, user?.password_hash || DUMMY_HASH);
  if (!user || !ok) throw unauthorized('Email o contraseña incorrectos');
  startSession(res, user);
  res.json({ user: publicUser(user) });
}));

router.post('/logout', (_req, res) => {
  endSession(res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  res.json({ user: req.user ? publicUser(req.user) : null });
});

router.patch('/me', requireAuth, validate(profileSchema), handle(async (req, res) => {
  const data = req.valid.body;
  await query(
    `UPDATE users SET name = COALESCE(:name, name), phone = :phone, address = :address WHERE id = :id`,
    {
      id: req.user.id,
      name: data.name ?? null,
      phone: data.phone === undefined ? req.user.phone : (data.phone || null),
      address: data.address === undefined ? req.user.address : (data.address || null),
    }
  );
  const user = await queryOne('SELECT id, name, email, phone, address, role FROM users WHERE id = :id', { id: req.user.id });
  res.json({ user: publicUser(user) });
}));

module.exports = router;
