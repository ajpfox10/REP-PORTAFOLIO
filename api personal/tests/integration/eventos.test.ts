import request from 'supertest';
import { bootstrapFullApp } from '../helpers/bootstrapFullApp';

describe('Eventos Integration Tests', () => {
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

  describe('POST /api/v1/eventos/licencias', () => {
    it('debería crear una licencia', async () => {
      const [rows] = await sequelize.query(
        `SELECT dni FROM personal LIMIT 1`
      );
      const dni = (rows as any[])[0]?.dni || 12345678;

      const res = await request(app)
        .post('/api/v1/eventos/licencias')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          dni,
          fecha_inicio: '2026-03-01',
          fecha_fin: '2026-03-15',
          titulo: 'Licencia anual',
          descripcion: 'Licencia ordinaria'
        });
      
      expect(res.status).toBe(201);
    });
  });

  describe('GET /api/v1/eventos/dni/:dni', () => {
    it('debería listar eventos por DNI', async () => {
      const [rows] = await sequelize.query(
        `SELECT dni FROM eventos LIMIT 1`
      );
      const dni = (rows as any[])[0]?.dni || 12345678;

      const res = await request(app)
        .get(`/api/v1/eventos/dni/${dni}`)
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });
});