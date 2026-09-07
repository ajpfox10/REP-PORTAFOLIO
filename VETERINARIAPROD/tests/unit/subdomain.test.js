'use strict';

const ROOT = 'vetmanagerpro.com';

// ROOT_DOMAIN se lee dinámicamente en cada llamada
beforeAll(() => { process.env.ROOT_DOMAIN = ROOT; });
afterAll(() => { delete process.env.ROOT_DOMAIN; });

const { extractSlug } = require('../../gateway/src/middleware/subdomain');

describe('extractSlug()', () => {
  test('extrae slug de subdominio válido', () => {
    expect(extractSlug(`clinic-peludo.${ROOT}`)).toBe('clinic-peludo');
  });

  test('extrae slug alfanumérico', () => {
    expect(extractSlug(`vetclinic42.${ROOT}`)).toBe('vetclinic42');
  });

  test('devuelve null para el root domain sin subdominio', () => {
    expect(extractSlug(ROOT)).toBeNull();
  });

  test('devuelve null para localhost', () => {
    expect(extractSlug('localhost')).toBeNull();
  });

  test('devuelve null para IP', () => {
    expect(extractSlug('192.168.1.1')).toBeNull();
  });

  test('devuelve null para subdominio de segundo nivel (profundo)', () => {
    expect(extractSlug(`a.b.${ROOT}`)).toBeNull();
  });

  test('devuelve null cuando ROOT_DOMAIN está vacío', () => {
    const saved = process.env.ROOT_DOMAIN;
    process.env.ROOT_DOMAIN = '';
    expect(extractSlug(`clinic.${ROOT}`)).toBeNull();
    process.env.ROOT_DOMAIN = saved;
  });
});
