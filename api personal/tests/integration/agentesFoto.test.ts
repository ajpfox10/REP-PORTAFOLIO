// tests/integration/agentesFoto.test.ts - VERSIÓN CORREGIDA
import request from 'supertest';
import { Express } from 'express';
import { Sequelize } from 'sequelize';
import { createTestApp, cleanupTestApp, TestAppContext } from '../helpers/createTestApp';
import fs from 'node:fs';
import path from 'node:path';

describe('Agentes Foto Integration Tests', () => {
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

    expect(loginRes.status).toBe(200); // ← Ahora SÍ será 200, no 404
    authToken = loginRes.body.data.accessToken;

    // Crear directorio de fotos si no existe
    const fotosDir = path.join(process.cwd(), 'fotos');
    if (!fs.existsSync(fotosDir)) {
      fs.mkdirSync(fotosDir, { recursive: true });
    }
  });

  afterAll(async () => {
    await cleanupTestApp(context);
  });

  describe('GET /api/v1/agentes/:dni/foto', () => {
    it('debería devolver 404 para DNI sin foto', async () => {
      const res = await request(app)
        .get('/api/v1/agentes/99999999/foto')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });

    it('debería rechazar DNI inválido', async () => {
      const res = await request(app)
        .get('/api/v1/agentes/abc123/foto')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(400);
    });
  });
});