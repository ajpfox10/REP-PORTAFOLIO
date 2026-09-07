'use strict';

const { scanRequest, SQLI_PATTERNS, XSS_PATTERNS, PATH_TRAVERSAL_PATTERNS } = require('../../shared/waf');

function makeReq(overrides = {}) {
  return {
    path:        '/api/v1/patients',
    originalUrl: '/api/v1/patients',
    method:      'POST',
    headers:     {},
    query:       {},
    body:        {},
    ...overrides,
  };
}

describe('WAF — SQL Injection (query string)', () => {
  test('detecta UNION SELECT', () => {
    const req = makeReq({ query: { q: "1 UNION SELECT * FROM users" } });
    expect(scanRequest(req)).toContain('sqli:query');
  });

  test('detecta DROP TABLE', () => {
    const req = makeReq({ query: { id: "1; DROP TABLE patients" } });
    expect(scanRequest(req)).toContain('sqli:query');
  });

  test('detecta comentario SQL --', () => {
    const req = makeReq({ query: { name: "admin'--" } });
    expect(scanRequest(req)).toContain('sqli:query');
  });

  test('texto normal no genera falso positivo', () => {
    const req = makeReq({ query: { name: "Firulais García" } });
    expect(scanRequest(req)).not.toContain('sqli:query');
  });
});

describe('WAF — SQL Injection (body)', () => {
  test('detecta INSERT INTO en body', () => {
    const req = makeReq({ body: { note: "INSERT INTO logs VALUES ('hack')" } });
    expect(scanRequest(req)).toContain('sqli:body');
  });

  test('objeto anidado con payload', () => {
    const req = makeReq({ body: { patient: { name: "1 UNION SELECT password FROM users" } } });
    expect(scanRequest(req)).toContain('sqli:body');
  });

  test('body médico normal sin falso positivo', () => {
    const req = makeReq({ body: { diagnosis: 'Otitis media crónica', treatment: 'Amoxicilina 250mg' } });
    expect(scanRequest(req)).toHaveLength(0);
  });
});

describe('WAF — XSS', () => {
  test('detecta <script> en query', () => {
    const req = makeReq({ query: { q: '<script>alert(1)</script>' } });
    expect(scanRequest(req)).toContain('xss:query');
  });

  test('detecta javascript: en body', () => {
    const req = makeReq({ body: { url: 'javascript:alert(document.cookie)' } });
    expect(scanRequest(req)).toContain('xss:body');
  });

  test('detecta event handler en query', () => {
    const req = makeReq({ query: { x: 'onmouseover="alert(1)"' } });
    expect(scanRequest(req)).toContain('xss:query');
  });

  test('HTML en descripción médica no genera falso positivo', () => {
    const req = makeReq({ body: { notes: 'Temperatura 38.5°C, presión 120/80' } });
    expect(scanRequest(req)).toHaveLength(0);
  });
});

describe('WAF — Path traversal', () => {
  test('detecta ../ en URL', () => {
    const req = makeReq({ originalUrl: '/api/v1/../../../etc/passwd' });
    expect(scanRequest(req)).toContain('path_traversal');
  });

  test('detecta %2e%2e/ codificado', () => {
    const req = makeReq({ originalUrl: '/api/v1/%2e%2e/%2e%2e/etc/passwd' });
    expect(scanRequest(req)).toContain('path_traversal');
  });

  test('ruta normal no genera falso positivo', () => {
    const req = makeReq({ originalUrl: '/api/v1/patients/123/medical-records' });
    expect(scanRequest(req)).toHaveLength(0);
  });
});

describe('WAF — sin amenazas', () => {
  test('request limpia → array vacío', () => {
    const req = makeReq({
      query: { page: '1', limit: '20' },
      body:  { name: 'Rex', species: 'perro', age: 3 },
    });
    expect(scanRequest(req)).toHaveLength(0);
  });
});
