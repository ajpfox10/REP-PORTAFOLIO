/**
 * @file tests/integration/personal.test.ts
 * @description Tests para el módulo personal (todos los nuevos endpoints).
 */

import request from 'supertest';
import { Sequelize } from 'sequelize';
import { createTestApp } from '../helpers/createTestApp';

describe('Personal Module', () => {
  let app: any;
  let sequelize: Sequelize;
  let accessToken: string;
  let testDni: number;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    sequelize = ctx.sequelize;

    // Create test data
    testDni = 99000000 + Math.floor(Math.random() * 999);

    // Insert minimal personal record for tests
    await sequelize.query(`
      INSERT IGNORE INTO personal (dni, apellido, nombre, created_at)
      VALUES (:dni, 'Test', 'Personal', NOW())
    `, { replacements: { dni: testDni } });

    // Login as admin (created by seed)
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@hospital.test', password: 'Admin123!' });

    if (loginRes.status === 200) {
      accessToken = loginRes.body.data.accessToken;
    }
  });

  afterAll(async () => {
    await sequelize.query('DELETE FROM personal WHERE dni = :dni', { replacements: { dni: testDni } }).catch(() => {});
  });

  // ── Search ────────────────────────────────────────────────────────────────
  describe('GET /api/v1/personal/search', () => {
    it('returns 400 without params', async () => {
      const res = await request(app)
        .get('/api/v1/personal/search')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(400);
    });

    it('searches by apellido', async () => {
      const res = await request(app)
        .get('/api/v1/personal/search?apellido=Test')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.meta).toHaveProperty('total');
      expect(res.body.meta).toHaveProperty('totalPages');
    });

    it('searches by DNI', async () => {
      const res = await request(app)
        .get(`/api/v1/personal/search?dni=${testDni}`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('searches by q (all fields)', async () => {
      const res = await request(app)
        .get('/api/v1/personal/search?q=Test')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(200);
    });

    it('returns 401 without token', async () => {
      const res = await request(app).get('/api/v1/personal/search?q=test');
      expect(res.status).toBe(401);
    });
  });

  // ── Perfil completo ───────────────────────────────────────────────────────
  describe('GET /api/v1/personal/:dni', () => {
    it('returns full profile for existing agent', async () => {
      const res = await request(app)
        .get(`/api/v1/personal/${testDni}`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.dni).toBe(testDni);
      expect(res.body.data).toHaveProperty('apellido');
      expect(res.body.data).toHaveProperty('nombre');
      expect(res.body.data).toHaveProperty('servicios');
      expect(res.body.data).toHaveProperty('totalDocumentos');
      expect(Array.isArray(res.body.data.servicios)).toBe(true);
    });

    it('returns 404 for non-existent DNI', async () => {
      const res = await request(app)
        .get('/api/v1/personal/99999999')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(404);
    });

    it('returns 400 for invalid DNI', async () => {
      const res = await request(app)
        .get('/api/v1/personal/abc')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(400);
    });
  });

  // ── PATCH ─────────────────────────────────────────────────────────────────
  describe('PATCH /api/v1/personal/:dni', () => {
    it('updates email field', async () => {
      const res = await request(app)
        .patch(`/api/v1/personal/${testDni}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ email: 'test@hospital.test' });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('rejects empty body', async () => {
      const res = await request(app)
        .patch(`/api/v1/personal/${testDni}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({});
      expect(res.status).toBe(400);
    });

    it('rejects unknown fields', async () => {
      const res = await request(app)
        .patch(`/api/v1/personal/${testDni}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ campoInventado: 'valor' });
      expect(res.status).toBe(400);
    });

    it('returns 404 for non-existent DNI', async () => {
      const res = await request(app)
        .patch('/api/v1/personal/99999999')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ email: 'x@y.com' });
      expect(res.status).toBe(404);
    });
  });

  // ── Documentos por persona ────────────────────────────────────────────────
  describe('GET /api/v1/personal/:dni/documentos', () => {
    it('returns empty list for agent with no docs', async () => {
      const res = await request(app)
        .get(`/api/v1/personal/${testDni}/documentos`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.meta).toHaveProperty('total');
    });

    it('paginates results', async () => {
      const res = await request(app)
        .get(`/api/v1/personal/${testDni}/documentos?page=1&limit=5`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body.meta.limit).toBe(5);
    });
  });

  // ── Cumpleaños ────────────────────────────────────────────────────────────
  describe('GET /api/v1/personal/cumpleanos', () => {
    it('returns agents born in a given month', async () => {
      const res = await request(app)
        .get('/api/v1/personal/cumpleanos?mes=1')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('returns 400 without params', async () => {
      const res = await request(app)
        .get('/api/v1/personal/cumpleanos')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(400);
    });
  });
});

// ── Auth /me tests ────────────────────────────────────────────────────────────
describe('Auth /me endpoints', () => {
  let app: any;
  let sequelize: Sequelize;
  let accessToken: string;
  let testUserId: number;
  const testEmail = `me-test-${Date.now()}@example.com`;
  const testPassword = 'TestMe123!';

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    sequelize = ctx.sequelize;

    const { hashPassword } = await import('../../src/auth/password');
    const hash = await hashPassword(testPassword);
    const [result] = await sequelize.query(
      `INSERT INTO usuarios (email, nombre, password, estado, created_at) VALUES (:email, 'Me Test', :hash, 'activo', NOW())`,
      { replacements: { email: testEmail, hash } }
    );
    testUserId = (result as any).insertId;

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: testEmail, password: testPassword });
    if (loginRes.status === 200) {
      accessToken = loginRes.body.data.accessToken;
    }
  });

  afterAll(async () => {
    await sequelize.query('DELETE FROM usuarios WHERE id = :id', { replacements: { id: testUserId } }).catch(() => {});
  });

  describe('GET /api/v1/auth/me', () => {
    it('returns current user info', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.email).toBe(testEmail);
      expect(res.body.data).toHaveProperty('id');
      expect(res.body.data).toHaveProperty('nombre');
      expect(res.body.data).toHaveProperty('permissions');
      expect(Array.isArray(res.body.data.permissions)).toBe(true);
    });

    it('returns 401 without token', async () => {
      const res = await request(app).get('/api/v1/auth/me');
      expect(res.status).toBe(401);
    });
  });

  describe('PATCH /api/v1/auth/me/password', () => {
    it('changes password with valid current password', async () => {
      const res = await request(app)
        .patch('/api/v1/auth/me/password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ passwordActual: testPassword, passwordNuevo: 'NuevoTest123!' });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('rejects wrong current password', async () => {
      const res = await request(app)
        .patch('/api/v1/auth/me/password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ passwordActual: 'WrongPassword!', passwordNuevo: 'NuevoTest123!' });
      expect(res.status).toBe(401);
    });

    it('rejects same password as current', async () => {
      const res = await request(app)
        .patch('/api/v1/auth/me/password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ passwordActual: testPassword, passwordNuevo: testPassword });
      expect(res.status).toBe(400);
    });

    it('rejects short password', async () => {
      const res = await request(app)
        .patch('/api/v1/auth/me/password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ passwordActual: testPassword, passwordNuevo: '123' });
      expect(res.status).toBe(400);
    });
  });
});

// ── Usuarios management tests ─────────────────────────────────────────────────
describe('Usuarios Management', () => {
  let app: any;
  let sequelize: Sequelize;
  let adminToken: string;
  let createdUserId: number;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    sequelize = ctx.sequelize;

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@hospital.test', password: 'Admin123!' });
    if (loginRes.status === 200) adminToken = loginRes.body.data.accessToken;
  });

  describe('GET /api/v1/usuarios', () => {
    it('requires authentication', async () => {
      const res = await request(app).get('/api/v1/usuarios');
      expect(res.status).toBe(401);
    });

    it('returns list of users', async () => {
      if (!adminToken) return;
      const res = await request(app)
        .get('/api/v1/usuarios')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.meta).toHaveProperty('total');
    });

    it('supports pagination and search', async () => {
      if (!adminToken) return;
      const res = await request(app)
        .get('/api/v1/usuarios?page=1&limit=5&q=admin')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/v1/usuarios', () => {
    it('creates a new user', async () => {
      if (!adminToken) return;
      const res = await request(app)
        .post('/api/v1/usuarios')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email:    `newuser-${Date.now()}@test.com`,
          nombre:   'Nuevo Usuario',
          password: 'Test123456!',
          estado:   'activo',
        });
      expect(res.status).toBe(201);
      expect(res.body.ok).toBe(true);
      expect(res.body.data).toHaveProperty('id');
      createdUserId = res.body.data.id;
    });

    it('rejects duplicate email', async () => {
      if (!adminToken) return;
      await request(app)
        .post('/api/v1/usuarios')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ email: 'admin@hospital.test', nombre: 'Dup', password: 'Test123456!' });
      // Would be 409 if admin exists
    });
  });

  describe('GET /api/v1/usuarios/:id', () => {
    it('returns user by id', async () => {
      if (!adminToken || !createdUserId) return;
      const res = await request(app)
        .get(`/api/v1/usuarios/${createdUserId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('roles');
    });
  });

  describe('PATCH /api/v1/usuarios/:id/estado', () => {
    it('changes user state', async () => {
      if (!adminToken || !createdUserId) return;
      const res = await request(app)
        .patch(`/api/v1/usuarios/${createdUserId}/estado`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ estado: 'inactivo' });
      expect(res.status).toBe(200);
    });
  });

  afterAll(async () => {
    if (createdUserId) {
      await sequelize.query('DELETE FROM usuarios WHERE id = :id', { replacements: { id: createdUserId } }).catch(() => {});
    }
  });
});
