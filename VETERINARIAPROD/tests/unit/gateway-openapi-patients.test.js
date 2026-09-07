'use strict';

const path = require('path');
const express = require('express');
const request = require('supertest');
const YAML = require('yamljs');
const { middleware: openApiValidator } = require('express-openapi-validator');

describe('Gateway OpenAPI - patients', () => {
  it('accepts the patient list query params used by the app and service', () => {
    const spec = YAML.load(path.join(__dirname, '../../gateway/docs/openapi.yaml'));
    const params = spec.paths['/patients'].get.parameters;
    const names = params.map((p) => p.name);

    expect(names).toEqual(expect.arrayContaining([
      'search',
      'species',
      'speciesId',
      'isActive',
      'is_active',
      'page',
      'limit',
    ]));

    const page = params.find((p) => p.name === 'page');
    const limit = params.find((p) => p.name === 'limit');

    expect(page.schema).toEqual({ type: 'string', pattern: '^[0-9]+$' });
    expect(limit.schema).toEqual({ type: 'string', pattern: '^[0-9]+$' });
  });

  it('documents the species and breeds reference endpoints exposed by the gateway', () => {
    const spec = YAML.load(path.join(__dirname, '../../gateway/docs/openapi.yaml'));

    expect(spec.paths['/patients/species/all']?.get).toBeDefined();
    expect(spec.paths['/species/all']?.get).toBeDefined();
    expect(spec.paths['/patients/breeds/all']?.get).toBeDefined();
    expect(spec.paths['/breeds/all']?.get).toBeDefined();
  });

  it('accepts /patients?page=1&limit=10 under strict OpenAPI validation', async () => {
    const app = express();
    app.use(openApiValidator({
      apiSpec: path.join(__dirname, '../../gateway/docs/openapi.yaml'),
      validateRequests: true,
      validateResponses: false,
      validateSecurity: false,
    }));
    app.get('/patients', (_req, res) => res.status(200).json({ ok: true }));
    app.use((err, _req, res, _next) => {
      res.status(err.status || 500).json({ message: err.message, errors: err.errors || [] });
    });

    const res = await request(app).get('/patients?page=1&limit=10');

    expect(res.status).toBe(200);
  });

  it('accepts /patients?limit=1 under strict OpenAPI validation', async () => {
    const app = express();
    app.use(openApiValidator({
      apiSpec: path.join(__dirname, '../../gateway/docs/openapi.yaml'),
      validateRequests: true,
      validateResponses: false,
      validateSecurity: false,
    }));
    app.get('/patients', (_req, res) => res.status(200).json({ ok: true }));
    app.use((err, _req, res, _next) => {
      res.status(err.status || 500).json({ message: err.message, errors: err.errors || [] });
    });

    const res = await request(app).get('/patients?limit=1');

    expect(res.status).toBe(200);
  });
});
