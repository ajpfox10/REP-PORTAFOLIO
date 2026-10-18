'use strict';

jest.mock('redis', () => {
  const store = new Map();
  const client = {
    connect: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    get: jest.fn(async (k) => store.get(k) ?? null),
    set: jest.fn(async (k, v) => { store.set(k, v); return 'OK'; }),
    incr: jest.fn(async (k) => { const n = (parseInt(store.get(k) || 0, 10)) + 1; store.set(k, String(n)); return n; }),
    incrBy: jest.fn(async (k, a) => { const n = (parseInt(store.get(k) || 0, 10)) + a; store.set(k, String(n)); return n; }),
    expire: jest.fn().mockResolvedValue(1),
    setEx: jest.fn(async (k, _ttl, v) => { store.set(k, v); return 'OK'; }),
    del: jest.fn(async (k) => (store.delete(k) ? 1 : 0)),
    multi: jest.fn(() => {
      const ops = [];
      const pipe = {
        incrBy: (k, a) => { ops.push(() => client.incrBy(k, a)); return pipe; },
        expire: () => { ops.push(async () => 1); return pipe; },
        exec: async () => { const out = []; for (const op of ops) out.push(await op()); return out; },
      };
      return pipe;
    }),
    _store: store,
    _reset: () => store.clear(),
  };
  return { createClient: jest.fn(() => client) };
});

const request = require('supertest');
const express = require('express');
const { requireUsageLimit, setPlanTier, PLAN_LIMITS } = require('../../shared/usageLimits');
const { createClient } = require('redis');

const redis = createClient();

function buildApp(feature) {
  const app = express();
  app.use((req, _res, next) => {
    req.user = { orgId: parseInt(req.headers['x-org-id'] || '1', 10) };
    next();
  });
  app.get('/test', requireUsageLimit(feature, false), (_req, res) => res.json({ ok: true }));
  return app;
}

afterEach(() => {
  redis._reset();
  jest.clearAllMocks();
  delete process.env.DEPENDENCY_MODE_USAGE_LIMIT_AI_DIAGNOSIS;
});

describe('requireUsageLimit middleware', () => {
  test('200 allows request when under limit', async () => {
    redis._store.set('org:plan:1', 'free');

    const res = await request(buildApp('ai_diagnosis'))
      .get('/test')
      .set('X-Org-Id', '1');

    expect(res.status).toBe(200);
    expect(res.headers['x-ratelimit-limit']).toBe('5');
    expect(res.headers['x-ratelimit-remaining']).toBe('4');
  });

  test('429 blocks request when over limit', async () => {
    redis._store.set('org:plan:1', 'free');
    const month = new Date().toISOString().slice(0, 7);
    redis._store.set(`usage:1:ai_diagnosis:${month}`, '5');

    const res = await request(buildApp('ai_diagnosis'))
      .get('/test')
      .set('X-Org-Id', '1');

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('QUOTA_EXCEEDED');
    expect(res.body.error.current).toBe(5);
  });

  test('200 enterprise plan is only bounded by the absolute safety cap', async () => {
    redis._store.set('org:plan:2', 'enterprise');
    const month = new Date().toISOString().slice(0, 7);
    redis._store.set(`usage:2:ai_diagnosis:${month}`, '1500');

    const res = await request(buildApp('ai_diagnosis'))
      .get('/test')
      .set('X-Org-Id', '2');

    expect(res.status).toBe(200);
    expect(res.headers['x-ratelimit-limit']).toBe('2000');
  });

  test('429 enterprise plan stops at the absolute safety cap', async () => {
    redis._store.set('org:plan:2', 'enterprise');
    const month = new Date().toISOString().slice(0, 7);
    redis._store.set(`usage:2:ai_diagnosis:${month}`, '2000');

    const res = await request(buildApp('ai_diagnosis'))
      .get('/test')
      .set('X-Org-Id', '2');

    expect(res.status).toBe(429);
  });

  test('200 unknown feature is always allowed', async () => {
    redis._store.set('org:plan:1', 'free');

    const res = await request(buildApp('some_unknown_feature'))
      .get('/test')
      .set('X-Org-Id', '1');

    expect(res.status).toBe(200);
  });

  test('200 fails open when no orgId', async () => {
    const app = express();
    app.get('/test', requireUsageLimit('ai_diagnosis'), (_req, res) => res.json({ ok: true }));

    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
  });

  test('200 fails open on Redis error in degraded mode', async () => {
    process.env.DEPENDENCY_MODE_USAGE_LIMIT_AI_DIAGNOSIS = 'degraded';
    redis.get.mockRejectedValueOnce(new Error('Redis down'));
    redis._store.set('org:plan:1', 'free');

    const res = await request(buildApp('ai_diagnosis'))
      .get('/test')
      .set('X-Org-Id', '1');

    expect(res.status).toBe(200);
  });

  test('503 blocks on Redis error in strict mode for expensive feature', async () => {
    process.env.DEPENDENCY_MODE_USAGE_LIMIT_AI_DIAGNOSIS = 'strict';
    redis.get.mockRejectedValueOnce(new Error('Redis down'));
    redis._store.set('org:plan:1', 'free');

    const res = await request(buildApp('ai_diagnosis'))
      .get('/test')
      .set('X-Org-Id', '1');

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('USAGE_LIMIT_UNAVAILABLE');
  });

  test('PLAN_LIMITS free plan has lower limits than pro', () => {
    expect(PLAN_LIMITS.free.ai_diagnosis).toBeLessThan(PLAN_LIMITS.pro.ai_diagnosis);
    expect(PLAN_LIMITS.enterprise.ai_diagnosis).toBe(Infinity);
  });
});
