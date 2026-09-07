'use strict';

const path = require('path');
const express = require('express');
const request = require('supertest');
const YAML = require('yamljs');
const { middleware: openApiValidator } = require('express-openapi-validator');

describe('Gateway OpenAPI - billing invoices', () => {
  it('documents the invoice list params supported by frontend and backend', () => {
    const spec = YAML.load(path.join(__dirname, '../../gateway/docs/openapi.yaml'));
    const params = spec.paths['/invoices'].get.parameters;
    const names = params.map((p) => p.name);

    expect(names).toEqual(expect.arrayContaining([
      'page',
      'limit',
      'status',
      'clientId',
      'from',
      'to',
    ]));

    const page = params.find((p) => p.name === 'page');
    const limit = params.find((p) => p.name === 'limit');
    const from = params.find((p) => p.name === 'from');

    expect(page.schema).toEqual({ type: 'string', pattern: '^[0-9]+$' });
    expect(limit.schema).toEqual({ type: 'string', pattern: '^[0-9]+$' });
    expect(from.schema).toEqual({ type: 'string', format: 'date' });
  });

  it('accepts /invoices?page=1&limit=20 under strict OpenAPI validation', async () => {
    const app = express();
    app.use(openApiValidator({
      apiSpec: path.join(__dirname, '../../gateway/docs/openapi.yaml'),
      validateRequests: true,
      validateResponses: false,
      validateSecurity: false,
    }));
    app.get('/invoices', (_req, res) => res.status(200).json({ ok: true }));
    app.use((err, _req, res, _next) => {
      res.status(err.status || 500).json({ message: err.message, errors: err.errors || [] });
    });

    const res = await request(app).get('/invoices?page=1&limit=20');

    expect(res.status).toBe(200);
  });

  it('accepts /invoices?page=1&limit=20&from=2026-04-28 under strict OpenAPI validation', async () => {
    const app = express();
    app.use(openApiValidator({
      apiSpec: path.join(__dirname, '../../gateway/docs/openapi.yaml'),
      validateRequests: true,
      validateResponses: false,
      validateSecurity: false,
    }));
    app.get('/invoices', (_req, res) => res.status(200).json({ ok: true }));
    app.use((err, _req, res, _next) => {
      res.status(err.status || 500).json({ message: err.message, errors: err.errors || [] });
    });

    const res = await request(app).get('/invoices?page=1&limit=20&from=2026-04-28');

    expect(res.status).toBe(200);
  });
});
