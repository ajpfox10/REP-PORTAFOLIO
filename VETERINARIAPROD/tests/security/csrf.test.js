'use strict';

process.env.CSRF_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = 'test';

const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');
const { csrfToken, csrfProtect, generateToken } = require('../../shared/csrf');

function buildApp() {
  const app = express();
  app.use(cookieParser());
  app.get('/csrf-token', csrfToken);
  app.use('/api/v1', csrfProtect);
  app.post('/api/v1/ping', (_req, res) => res.json({ ok: true }));
  app.post('/api/v1/auth/login', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('CSRF middleware', () => {
  test('emits token cookie and body token', async () => {
    const res = await request(buildApp()).get('/csrf-token');

    expect(res.status).toBe(200);
    expect(res.body.data.csrfToken).toBeTruthy();
    expect(res.headers['set-cookie']).toEqual(expect.arrayContaining([
      expect.stringContaining('_csrf='),
    ]));
  });

  test('rejects mutating requests without csrf header', async () => {
    const res = await request(buildApp()).post('/api/v1/ping');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_MISSING');
  });

  test('accepts mutating requests with matching csrf token', async () => {
    const app = buildApp();
    const agent = request.agent(app);
    const tokenRes = await agent.get('/csrf-token');
    const token = tokenRes.body.data.csrfToken || generateToken();

    const res = await agent
      .post('/api/v1/ping')
      .set('X-CSRF-Token', token);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('skips excluded routes even when middleware is mounted below /api/v1', async () => {
    const res = await request(buildApp()).post('/api/v1/auth/login');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
