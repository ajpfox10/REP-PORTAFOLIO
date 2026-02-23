// src/tests/scanner.test.ts
import request from 'supertest';
import app from '../scanner/scanner.server';

describe('Scanner API', () => {
  it('GET /api/scanner/status → 200', async () => {
    const res = await request(app).get('/api/scanner/status');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.status).toBe('running');
  });

  it('GET /api/scanner/devices → 200 (puede devolver lista vacía)', async () => {
    const res = await request(app).get('/api/scanner/devices');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.devices)).toBe(true);
  });

  it('GET /api/scanner/config → 200', async () => {
    const res = await request(app).get('/api/scanner/config');
    expect(res.status).toBe(200);
    expect(res.body.config).toBeDefined();
    expect(res.body.config.dpi).toBeDefined();
  });

  it('PUT /api/scanner/config → actualiza configuración', async () => {
    const res = await request(app)
      .put('/api/scanner/config')
      .send({ dpi: 600, colorMode: 'Grayscale' });
    expect(res.status).toBe(200);
    expect(res.body.config.dpi).toBe(600);
    expect(res.body.config.colorMode).toBe('Grayscale');
  });

  it('POST /api/scanner/scan → 400 sin device', async () => {
    const res = await request(app).post('/api/scanner/scan').send({});
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('POST /api/scanner/pdf → 400 sin páginas', async () => {
    const res = await request(app).post('/api/scanner/pdf').send({ pages: [] });
    expect(res.status).toBe(400);
  });
});
