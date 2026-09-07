'use strict';

const express = require('express');
const request = require('supertest');
const corsMiddleware = require('../../gateway/src/middleware/cors');
const { csrfToken } = require('../../shared/csrf');

function buildApp() {
  const app = express();
  app.use(corsMiddleware);
  app.get('/ping', (_req, res) => res.json({ ok: true }));
  app.get('/csrf-token', csrfToken);
  return app;
}

describe('CORS middleware', () => {
  const app = buildApp();

  test('allows requests without Origin header', async () => {
    const res = await request(app).get('/ping');
    expect(res.status).toBe(200);
  });

  test('sets CORS headers for allowed origins', async () => {
    // Without ALLOWED_ORIGINS set, cors() defaults to allowing all
    const res = await request(app).get('/ping').set('Origin', 'http://localhost:3000');
    expect(res.status).toBe(200);
  });

  test('responds to preflight OPTIONS', async () => {
    const res = await request(app)
      .options('/ping')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'Authorization, X-CSRF-Token, X-Request-Id, X-Branch-Id');
    expect([200, 204]).toContain(res.status);
    expect(res.headers['access-control-allow-headers']).toContain('X-CSRF-Token');
  });

  test('does not advertise browser trust headers like X-Org-Id', async () => {
    const res = await request(app)
      .options('/ping')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'Authorization, X-Org-Id, X-Tenant-Id, X-Branch-Id');

    expect([200, 204]).toContain(res.status);
    expect(res.headers['access-control-allow-headers']).not.toContain('X-Org-Id');
    expect(res.headers['access-control-allow-headers']).not.toContain('X-Tenant-Id');
  });

  test('returns CORS headers for csrf-token endpoint', async () => {
    const res = await request(app)
      .get('/csrf-token')
      .set('Origin', 'http://localhost:3000');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });
});
