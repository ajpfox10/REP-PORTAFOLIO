'use strict';

const express = require('express');
const request = require('supertest');
const {
  versionNegotiationMiddleware,
  versioningMiddleware,
} = require('../../gateway/src/middleware/versioning');

describe('gateway API versioning', () => {
  const previous = {
    API_VERSION: process.env.API_VERSION,
    API_VERSIONS: process.env.API_VERSIONS,
    API_DEFAULT_VERSION: process.env.API_DEFAULT_VERSION,
  };

  beforeEach(() => {
    process.env.API_VERSION = 'v1';
    process.env.API_VERSIONS = 'v1,v2';
    process.env.API_DEFAULT_VERSION = 'v1';
    jest.resetModules();
  });

  afterAll(() => {
    process.env.API_VERSION = previous.API_VERSION;
    process.env.API_VERSIONS = previous.API_VERSIONS;
    process.env.API_DEFAULT_VERSION = previous.API_DEFAULT_VERSION;
  });

  function buildApp() {
    const app = express();
    app.use(versionNegotiationMiddleware);
    app.use(versioningMiddleware);
    app.get('/api/v1/ping', (req, res) => res.json({ ok: true, version: req.apiVersion }));
    app.get('/api/v2/ping', (req, res) => res.json({ ok: true, version: req.apiVersion }));
    return app;
  }

  test('keeps explicit path version', async () => {
    const res = await request(buildApp()).get('/api/v2/ping');
    expect(res.status).toBe(200);
    expect(res.body.version).toBe('v2');
    expect(res.headers['api-version']).toBe('v2');
    expect(res.headers['api-supported']).toBe('v1, v2');
  });

  test('rewrites unversioned API path using X-API-Version', async () => {
    const res = await request(buildApp())
      .get('/api/ping')
      .set('X-API-Version', 'v2');
    expect(res.status).toBe(200);
    expect(res.body.version).toBe('v2');
    expect(res.headers['api-version']).toBe('v2');
  });

  test('falls back to default version for unversioned path', async () => {
    const res = await request(buildApp()).get('/api/ping');
    expect(res.status).toBe(200);
    expect(res.body.version).toBe('v1');
    expect(res.headers['api-default-version']).toBe('v1');
  });

  test('rejects unsupported version', async () => {
    const res = await request(buildApp())
      .get('/api/ping')
      .set('Accept-Version', 'v3');
    expect(res.status).toBe(406);
    expect(res.body.error.code).toBe('API_VERSION_UNSUPPORTED');
    expect(res.body.error.supportedVersions).toEqual(['v1', 'v2']);
  });
});
