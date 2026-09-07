'use strict';

const express = require('express');
const request = require('supertest');
const rateLimit = require('express-rate-limit');

function buildApp(max = 3) {
  const app = express();
  app.set('trust proxy', false);
  app.use(rateLimit({
    windowMs: 60_000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ success: false }),
  }));
  app.get('/ping', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('Rate limiter', () => {
  test('allows requests under the limit', async () => {
    const app = buildApp(5);
    for (let i = 0; i < 5; i++) {
      const res = await request(app).get('/ping');
      expect(res.status).toBe(200);
    }
  });

  test('blocks requests over the limit', async () => {
    const app = buildApp(2);
    await request(app).get('/ping');
    await request(app).get('/ping');
    const res = await request(app).get('/ping');
    expect(res.status).toBe(429);
    expect(res.body.success).toBe(false);
  });

  test('sets RateLimit headers', async () => {
    const app = buildApp(10);
    const res = await request(app).get('/ping');
    expect(res.headers['ratelimit-limit'] || res.headers['x-ratelimit-limit']).toBeDefined();
  });
});
