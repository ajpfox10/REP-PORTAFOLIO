import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { bootstrapFullApp } from '../helpers/bootstrapFullApp';
import { env } from '../../src/config/env';

describe('Agentes Foto Integration Tests', () => {
  let app: any;
  let sequelize: any;
  let authToken: string;

  beforeAll(async () => {
    const full = await bootstrapFullApp();
    app = full.app;
    sequelize = full.sequelize;

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@local.com', password: 'admin1234' });
    
    authToken = loginRes.body.data.accessToken;

    // Crear directorio de fotos si no existe
    if (!fs.existsSync(env.PHOTOS_BASE_DIR)) {
      fs.mkdirSync(env.PHOTOS_BASE_DIR, { recursive: true });
    }
  });

  afterAll(async () => {
    await sequelize.close();
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
        .get('/api/v1/agentes/abc/foto')
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(res.status).toBe(400);
    });
  });
});