import request from 'supertest';
import path from 'path';
import fs from 'fs';
import { bootstrapFullApp } from '../helpers/bootstrapFullApp';
import { createSequelize } from '../../src/db/sequelize';

describe('Documents Integration Tests', () => {
  let app: any;
  let sequelize: any;
  let authToken: string;

  beforeAll(async () => {
    const full = await bootstrapFullApp();
    app = full.app;
    sequelize = full.sequelize;

    // Login para obtener token
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@local.com', password: 'admin1234' });
    
    authToken = loginRes.body.data.accessToken;
  });

  afterAll(async () => {
    await sequelize.close();
  });

  describe('GET /api/v1/documents', () => {
    it('debería listar documentos con paginación', async () => {
      const res = await request(app)
        .get('/api/v1/documents?page=1&limit=5')
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('debería buscar documentos por q', async () => {
      const res = await request(app)
        .get('/api/v1/documents?q=resolucion')
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });
  });

  describe('GET /api/v1/documents/:id/file', () => {
    it('debería devolver 404 para ID inexistente', async () => {
      const res = await request(app)
        .get('/api/v1/documents/999999/file')
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/v1/documents/upload', () => {
    const tempPdfPath = path.join(__dirname, 'temp-test.pdf');

    beforeAll(() => {
      // Crear PDF de prueba
      fs.writeFileSync(tempPdfPath, '%PDF-1.4 test content');
    });

    afterAll(() => {
      if (fs.existsSync(tempPdfPath)) fs.unlinkSync(tempPdfPath);
    });

    it('debería rechazar upload sin archivo', async () => {
      const res = await request(app)
        .post('/api/v1/documents/upload')
        .set('Authorization', `Bearer ${authToken}`)
        .field('dni', '12345678');
      
      expect(res.status).toBe(400);
    });

    it('debería rechazar DNI inválido', async () => {
      const res = await request(app)
        .post('/api/v1/documents/upload')
        .set('Authorization', `Bearer ${authToken}`)
        .field('dni', 'no-es-numero')
        .attach('file', tempPdfPath);
      
      expect(res.status).toBe(400);
    });
  });
});