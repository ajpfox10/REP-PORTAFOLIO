// tests/jest.env.ts
process.env.METRICS_ENABLE = '0';
process.env.METRICS_PROTECT = '0';
process.env.DOCS_PROTECT = 'false'; // FIX: Evita 403 en /docs/openapi.json durante tests
