// tests/integration/documents.test.ts - EJEMPLO CORREGIDO
import request from 'supertest';
import { Express } from 'express';
import { Sequelize } from 'sequelize';
import { createTestApp, cleanupTestApp, TestAppContext } from '../helpers/createTestApp';

describe('Documents Integration Tests', () => {
  let context: TestAppContext;
  let app: Express;
  let sequelize: Sequelize;
  let authToken: string;

  beforeAll(async () => {
    // ✅ CORRECTO: Usar helper que monta las rutas
    context = await createTestApp();
    app = context.app;
    sequelize = context.sequelize;

    // Login para obtener token
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@local.com', password: 'Admin123!' });

    expect(loginRes.status).toBe(200); // ✅ Ya NO será 404
    authToken = loginRes.body.data.accessToken;
  });

  afterAll(async () => {
    await cleanupTestApp(context);
  });

  describe('GET /api/v1/documents', () => {
    it('debería listar documentos con paginación', async () => {
      const res = await request(app)
        .get('/api/v1/documents?page=1&limit=10')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data).toHaveProperty('rows');
      expect(res.body.data).toHaveProperty('count');
    });

    it('debería buscar documentos por q', async () => {
      const res = await request(app)
        .get('/api/v1/documents?q=test')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });
  });

  describe('GET /api/v1/documents/:id/file', () => {
    it('debería devolver 404 para ID inexistente', async () => {
      const res = await request(app)
        .get('/api/v1/documents/99999/file')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });
  });
});
