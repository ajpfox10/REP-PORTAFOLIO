'use strict';

const dlpPolicies = [
  { name: 'patients-list', method: 'GET', pattern: /^\/api\/v[12]\/patients(?:\/?$|\?)/, kind: 'list' },
  { name: 'clients-list', method: 'GET', pattern: /^\/api\/v[12]\/clients(?:\/?$|\?)/, kind: 'list' },
  { name: 'medical-records-list', method: 'GET', pattern: /^\/api\/v[12]\/medical-records(?:\/?$|\?)/, kind: 'list' },
  { name: 'appointments-list', method: 'GET', pattern: /^\/api\/v[12]\/appointments(?:\/?$|\?)/, kind: 'list' },
  { name: 'invoices-list', method: 'GET', pattern: /^\/api\/v[12]\/invoices(?:\/?$|\?)/, kind: 'list' },
  // Usar [^?#]* en vez de .* para evitar backtracking catastrófico (ReDoS)
  { name: 'reports-export', method: 'GET', pattern: /^\/api\/v[12]\/reports\/[^?#]*(?:export|download|csv|excel|pdf)/, kind: 'export' },
  { name: 'documents-export', method: 'GET', pattern: /^\/api\/v[12]\/documents\/[^?#]*(?:download|export)/, kind: 'export' },
  { name: 'lab-export', method: 'GET', pattern: /^\/api\/v[12]\/lab\/[^?#]*(?:export|download)/, kind: 'export' },
];

function matchDlpPolicy(req) {
  const method = String(req.method || '').toUpperCase();
  const url = req.originalUrl || req.url || req.path || '';
  return dlpPolicies.find((policy) => policy.method === method && policy.pattern.test(url)) || null;
}

module.exports = { dlpPolicies, matchDlpPolicy };
