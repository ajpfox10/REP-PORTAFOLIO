import request from 'supertest';
import { bootstrapFullApp } from '../helpers/bootstrapFullApp';

describe('Certificados Integration Tests', () => {
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
  });

  afterAll(async () => {
    await sequelize.close();
  });

  describe('POST /api/v1/certificados/certificado-trabajo', () => {
    it('debería rechazar request sin DNI', async () => {
      const res = await request(app)
        .post('/api/v1/certificados/certificado-trabajo')
        .set('Authorization', `Bearer ${authToken}`)
        .send({});
      
      expect(res.status).toBe(400);
    });

    it('debería devolver DOCX para DNI válido', async () => {
      // Buscar un DNI que exista en personaldetalle
      const [rows] = await sequelize.query(
        `SELECT dni FROM personaldetalle LIMIT 1`
      );
      const dni = (rows as any[])[0]?.dni || 12345678;

      const res = await request(app)
        .post('/api/v1/certificados/certificado-trabajo')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ dni });
      
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('vnd.openxmlformats');
      expect(res.headers['content-disposition']).toContain('filename=');
    });
  });
});