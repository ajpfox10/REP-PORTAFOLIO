'use strict';

const request = require('supertest');
const { app, client, customer } = require('./helpers');
const { pool } = require('../src/db');

afterAll(() => pool.end());

describe('autenticación', () => {
  test('rechaza mutaciones sin token CSRF', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'a@b.com', password: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_INVALID');
  });

  test('valida los datos del registro', async () => {
    const c = await client();
    const res = await c.post('/api/auth/register', { name: 'A', email: 'no-es-email', password: 'corta' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.details)).toEqual(expect.arrayContaining(['name', 'email', 'password']));
  });

  test('registra, deja la sesión en una cookie httpOnly y no guarda la clave en texto plano', async () => {
    const c = await customer({ address: 'Av. Córdoba 1234, 3.º B' });
    expect(c.user.role).toBe('customer');
    expect(c.user).not.toHaveProperty('password_hash');

    const me = await c.get('/api/auth/me');
    expect(me.body.user.address).toBe('Av. Córdoba 1234, 3.º B');

    const [row] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [c.user.id]);
    expect(row[0].password_hash).toMatch(/^\$2[aby]\$12\$/);
  });

  test('la cookie de sesión es httpOnly y SameSite=Strict', async () => {
    const c = await client();
    const res = await c.post('/api/auth/register', { name: 'Otra Persona', email: `cookie${Date.now()}@test.local`, password: 'Clave1234' });
    const cookie = res.headers['set-cookie'].find((h) => h.startsWith('ne_session='));
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
  });

  test('no permite registrar dos veces el mismo email', async () => {
    const first = await customer();
    const c = await client();
    const res = await c.post('/api/auth/register', { name: 'Duplicado', email: first.user.email.toUpperCase(), password: 'Clave1234' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  test('login con clave incorrecta da el mismo mensaje que un email inexistente', async () => {
    const existing = await customer();
    const c = await client();
    const wrong = await c.post('/api/auth/login', { email: existing.user.email, password: 'Incorrecta1' });
    const missing = await c.post('/api/auth/login', { email: 'nadie@test.local', password: 'Incorrecta1' });
    expect(wrong.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(wrong.body.error.message).toBe(missing.body.error.message);
  });

  test('logout cierra la sesión', async () => {
    const c = await customer();
    await c.post('/api/auth/logout');
    const me = await c.get('/api/auth/me');
    expect(me.body.user).toBeNull();
  });

  test('actualiza el perfil', async () => {
    const c = await customer();
    const res = await c.patch('/api/auth/me', { phone: '11 2222-3333', address: 'Mitre 450' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ phone: '11 2222-3333', address: 'Mitre 450' });
  });

  test('un token de sesión manipulado se ignora', async () => {
    const res = await request(app).get('/api/auth/me').set('Cookie', 'ne_session=token.falso.123');
    expect(res.body.user).toBeNull();
  });
});
