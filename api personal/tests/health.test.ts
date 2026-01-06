import request from 'supertest';
import { createApp } from '../src/app';
import { healthRouter } from '../src/routes/health.routes';

describe('health endpoints', () => {
  it('GET /health returns ok', async () => {
    const app = createApp();
    app.use(healthRouter);
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('GET /ready returns ok', async () => {
    const app = createApp();
    app.use(healthRouter);
    const res = await request(app).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
