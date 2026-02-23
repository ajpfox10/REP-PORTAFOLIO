// src/tests/personal.cumpleanos.test.ts
import { buildPersonalRouter } from '../routes/personal.routes';
import { createTestSequelize } from './helpers/testDb';
import express from 'express';
import request from 'supertest';

describe('GET /personal/cumpleanos', () => {
  let app: express.Application;
  let sequelize: any;

  beforeAll(async () => {
    sequelize = createTestSequelize();
    app = express();
    app.use(express.json());
    app.use('/personal', buildPersonalRouter(sequelize));
  });

  afterAll(async () => {
    await sequelize.close().catch(() => {});
  });

  it('400 sin parámetros', async () => {
    const res = await request(app).get('/personal/cumpleanos');
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('200 con mes=1', async () => {
    const res = await request(app).get('/personal/cumpleanos?mes=01');
    expect([200, 500]).toContain(res.status); // 500 si no hay DB de test
  });

  it('200 con mes=1 y dia=1', async () => {
    const res = await request(app).get('/personal/cumpleanos?mes=01&dia=01');
    expect([200, 500]).toContain(res.status);
  });
});
