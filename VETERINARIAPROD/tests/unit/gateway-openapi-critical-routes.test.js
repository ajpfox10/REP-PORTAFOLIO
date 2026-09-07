'use strict';

const fs = require('fs');
const path = require('path');
const YAML = require('yamljs');

describe('Gateway OpenAPI - critical frontend routes', () => {
  it('documents every route family registered in the gateway proxy', () => {
    const proxySource = fs.readFileSync(path.join(__dirname, '../../gateway/src/routes/proxy.js'), 'utf8');
    const openApiSource = fs.readFileSync(path.join(__dirname, '../../gateway/docs/openapi.yaml'), 'utf8');

    const families = [...proxySource.matchAll(/registerVersioned\(app,\s*'use',\s*'([^']+)'/g)]
      .map((match) => match[1]);
    const documentedPaths = [...openApiSource.matchAll(/^\s{2}\/([^:\n]+):/mg)]
      .map((match) => match[1].replace(/\{[^}]+\}/g, '*'));

    const missing = families.filter((family) => {
      const normalizedFamily = family.replace(/\{[^}]+\}/g, '*');
      return !documentedPaths.some((docPath) =>
        docPath === normalizedFamily ||
        docPath.startsWith(`${normalizedFamily}/`) ||
        normalizedFamily.startsWith(`${docPath}/`)
      );
    });

    expect(missing).toEqual([]);
  });

  it('documents the route catalogs and aliases consumed by the frontend', () => {
    const spec = YAML.load(path.join(__dirname, '../../gateway/docs/openapi.yaml'));

    expect(spec.paths['/appointments/types']?.get).toBeDefined();
    expect(spec.paths['/vaccinations/vaccines']?.get).toBeDefined();
    expect(spec.paths['/vaccinations/deworming/products']?.get).toBeDefined();
    expect(spec.paths['/auth/admin/users']?.get).toBeDefined();
    expect(spec.paths['/auth/admin/users/{id}/deactivate']?.patch).toBeDefined();
    expect(spec.paths['/tele/stats']?.get).toBeDefined();
    expect(spec.paths['/tele/platforms']?.get).toBeDefined();
    expect(spec.paths['/pathology/orders']?.get).toBeDefined();
    expect(spec.paths['/pathology/types']?.get).toBeDefined();
    expect(spec.paths['/grooming/groomers']?.get).toBeDefined();
    expect(spec.paths['/grooming/service-types']?.get).toBeDefined();
    expect(spec.paths['/reports/appointments']?.get).toBeDefined();
    expect(spec.paths['/reports/{type}/export']?.post).toBeDefined();
    expect(spec.paths['/billing/consolidated/summary']?.get).toBeDefined();
    expect(spec.paths['/billing/consolidated/outstanding']?.get).toBeDefined();
  });

  it('documents query params used by appointment and telemedicine list screens', () => {
    const spec = YAML.load(path.join(__dirname, '../../gateway/docs/openapi.yaml'));

    const appointmentParams = spec.paths['/appointments'].get.parameters.map((p) => p.name);
    expect(appointmentParams).toEqual(expect.arrayContaining([
      'date',
      'vetId',
      'status',
      'patientId',
      'limit',
    ]));

    const teleParams = spec.paths['/tele/sessions'].get.parameters.map((p) => p.name);
    expect(teleParams).toEqual(expect.arrayContaining([
      'status',
      'vetId',
      'date',
      'page',
      'limit',
    ]));
  });

  it('documents the real medical record creation contract accepted by the backend', () => {
    const spec = YAML.load(path.join(__dirname, '../../gateway/docs/openapi.yaml'));
    const schema = spec.paths['/medical-records'].post.requestBody.content['application/json'].schema;

    expect(Array.isArray(schema.oneOf)).toBe(true);
    expect(schema.oneOf).toEqual(expect.arrayContaining([
      expect.objectContaining({
        required: expect.arrayContaining(['appointmentId', 'chiefComplaint']),
      }),
      expect.objectContaining({
        required: expect.arrayContaining(['patientId', 'chiefComplaint']),
      }),
    ]));
  });
});
