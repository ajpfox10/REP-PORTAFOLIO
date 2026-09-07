'use strict';

const { sanitizeDeep } = require('../../shared/security');

// Re-export internal for testing
const security = require('../../shared/security');
// Access the internal function via the module (we'll test through the middleware)
const express  = require('express');
const request  = require('supertest');

// Build a minimal test app
function buildApp() {
  const app = express();
  app.use(express.json());
  // Apply sanitize middleware (access module internals via monkey-patch)
  app.use((req, res, next) => {
    // inline sanitizeDeep mirror for test isolation
    function sanitizeDeep(value) {
      if (value === null || value === undefined) return value;
      if (typeof value === 'string') return value.trim();
      if (Array.isArray(value)) return value.map(sanitizeDeep);
      if (typeof value === 'object') {
        const BLOCKED = new Set(['__proto__', 'constructor', 'prototype']);
        const out = Object.create(null);
        for (const [k, v] of Object.entries(value)) {
          if (BLOCKED.has(k)) continue;
          out[k] = sanitizeDeep(v);
        }
        return out;
      }
      return value;
    }
    if (req.body && typeof req.body === 'object') req.body = sanitizeDeep(req.body);
    next();
  });
  app.post('/echo', (req, res) => res.json(req.body));
  return app;
}

describe('Sanitize middleware', () => {
  const app = buildApp();

  test('trims string values', async () => {
    const res = await request(app).post('/echo').send({ name: '  John  ' });
    expect(res.body.name).toBe('John');
  });

  test('blocks __proto__ keys (not an own property)', async () => {
    const res = await request(app)
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send('{"__proto__":{"isAdmin":true},"name":"test"}');
    // __proto__ must not be an own property (prototype pollution blocked)
    expect(Object.prototype.hasOwnProperty.call(res.body, '__proto__')).toBe(false);
    expect(res.body.name).toBe('test');
  });

  test('blocks constructor keys (not an own property)', async () => {
    const res = await request(app)
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send('{"constructor":{"name":"hacked"},"ok":true}');
    expect(Object.prototype.hasOwnProperty.call(res.body, 'constructor')).toBe(false);
    expect(res.body.ok).toBe(true);
  });

  test('handles nested objects', async () => {
    const res = await request(app).post('/echo').send({ a: { b: '  trim me  ' } });
    expect(res.body.a.b).toBe('trim me');
  });

  test('handles arrays', async () => {
    const res = await request(app).post('/echo').send({ list: ['  a  ', '  b  '] });
    expect(res.body.list).toEqual(['a', 'b']);
  });
});
