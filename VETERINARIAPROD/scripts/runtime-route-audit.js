#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const YAML = require('yamljs');

const BASE_URL = process.env.AUDIT_BASE_URL || 'http://localhost:4050';
const API_PREFIX = '/api/v1';
const OPENAPI_PATH = path.join(process.cwd(), 'gateway', 'docs', 'openapi.yaml');
const REQUEST_DELAY_MS = Number(process.env.AUDIT_DELAY_MS || 750);
const REQUEST_TIMEOUT_MS = Number(process.env.AUDIT_TIMEOUT_MS || 20000);
const REPORT_PATH = process.env.AUDIT_REPORT_PATH || path.join(process.cwd(), 'runtime-route-audit-report.json');
const PATH_FILTER = process.env.AUDIT_PATH_FILTER ? new RegExp(process.env.AUDIT_PATH_FILTER, 'i') : null;

if (!process.env.AUDIT_EMAIL || !process.env.AUDIT_PASSWORD) {
  console.error('AUDIT_EMAIL and AUDIT_PASSWORD env vars are required');
  process.exit(1);
}
const ADMIN_CREDS = {
  email: process.env.AUDIT_EMAIL,
  password: process.env.AUDIT_PASSWORD,
};

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizePath(pathname) {
  if (pathname === '/csrf-token') return pathname;
  return pathname.startsWith('/api/') ? pathname : `${API_PREFIX}${pathname}`;
}

function isPublicAuthPath(pathname) {
  return [
    '/auth/login',
    '/auth/refresh',
    '/auth/password-reset/request',
    '/auth/password-reset/confirm',
    '/portal/auth/login',
    '/portal/auth/register',
    '/portal/auth/forgot-password',
  ].includes(pathname);
}

function shouldSkipPath(pathname) {
  return pathname.startsWith('/api/v1/docs')
    || pathname === '/api/docs';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveRef(spec, ref) {
  if (!ref || !ref.startsWith('#/')) return null;
  return ref
    .slice(2)
    .split('/')
    .reduce((acc, key) => (acc ? acc[key] : undefined), spec);
}

function derefSchema(spec, schema) {
  if (!schema) return null;
  if (schema.$ref) return derefSchema(spec, resolveRef(spec, schema.$ref));
  return schema;
}

function pickExample(spec, schema, seen = new Set()) {
  schema = derefSchema(spec, schema);
  if (!schema) return null;
  const key = JSON.stringify(schema).slice(0, 200);
  if (seen.has(key)) return null;
  seen.add(key);

  if (schema.example !== undefined) return deepClone(schema.example);
  if (schema.default !== undefined) return deepClone(schema.default);
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];

  if (schema.oneOf?.length) return pickExample(spec, schema.oneOf[0], seen);
  if (schema.anyOf?.length) return pickExample(spec, schema.anyOf[0], seen);
  if (schema.allOf?.length) {
    const merged = {};
    for (const item of schema.allOf) {
      const value = pickExample(spec, item, seen);
      if (value && typeof value === 'object' && !Array.isArray(value)) Object.assign(merged, value);
    }
    return Object.keys(merged).length ? merged : null;
  }

  if (schema.type === 'object' || schema.properties) {
    const out = {};
    const props = schema.properties || {};
    const required = new Set(schema.required || Object.keys(props));
    for (const [name, propSchema] of Object.entries(props)) {
      if (!required.has(name) && propSchema.example === undefined && propSchema.default === undefined) continue;
      const value = pickExample(spec, propSchema, seen);
      if (value !== null && value !== undefined) out[name] = value;
    }
    return out;
  }

  if (schema.type === 'array') {
    const item = pickExample(spec, schema.items, seen);
    return item === null ? [] : [item];
  }

  switch (schema.type) {
    case 'string':
      if (schema.format === 'date') return '2026-05-20';
      if (schema.format === 'date-time') return '2026-05-20T15:00:00Z';
      if (schema.format === 'email') return ADMIN_CREDS.email;
      return 'smoke-test';
    case 'integer':
    case 'number':
      return schema.minimum ?? 1;
    case 'boolean':
      return true;
    default:
      return null;
  }
}

async function requestJson(method, pathname, { token, body, headers } = {}) {
  const url = `${BASE_URL}${pathname}`;
  const finalHeaders = {
    Accept: 'application/json',
    ...(headers || {}),
  };
  if (token) finalHeaders.Authorization = `Bearer ${token}`;
  if (body !== undefined) finalHeaders['Content-Type'] = 'application/json';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`Request timeout after ${REQUEST_TIMEOUT_MS}ms`)), REQUEST_TIMEOUT_MS);

  let resp;
  try {
    resp = await fetch(url, {
      method,
      headers: finalHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const text = await resp.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return {
    status: resp.status,
    ok: resp.ok,
    text,
    json,
    headers: Object.fromEntries(resp.headers.entries()),
  };
}

async function getCsrfToken() {
  const resp = await requestJson('GET', '/csrf-token');
  if (!resp.ok || !resp.json?.data?.csrfToken) {
    throw new Error(`csrf-token failed: ${resp.status}`);
  }
  return resp.json.data.csrfToken;
}

async function login(email, password, csrfToken) {
  const resp = await requestJson('POST', `${API_PREFIX}/auth/login`, {
    headers: { 'X-CSRF-Token': csrfToken },
    body: { email, password },
  });
  return resp;
}

function inferPathParams(pathname, fixtures) {
  const params = {};
  const matches = [...pathname.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
  for (const name of matches) {
    const lower = `${pathname}:${name}`.toLowerCase();
    if (name === 'tableName') params[name] = fixtures.tableName || 'patients';
    else if (name === 'role') params[name] = fixtures.role || 'org_admin';
    else if (name === 'reminderId') params[name] = fixtures.reminderId || 1;
    else if (name === 'providerId') params[name] = fixtures.providerId || 1;
    else if (name === 'mpPaymentId') params[name] = fixtures.mpPaymentId || 1;
    else if (name === 'identity') params[name] = fixtures.identity || 'audit-user';
    else if (name === 'wId') params[name] = fixtures.waitingRoomId || 1;
    else if (lower.includes('appointments') || lower.includes('/triage/')) params[name] = fixtures.appointmentId || 1;
    else if (lower.includes('patients')) params[name] = fixtures.patientId || 1;
    else if (lower.includes('clients')) params[name] = fixtures.clientId || 1;
    else if (lower.includes('medical-records')) params[name] = fixtures.medicalRecordId || 1;
    else if (lower.includes('prescriptions')) params[name] = fixtures.prescriptionId || fixtures.medicalRecordId || 1;
    else if (lower.includes('documents/inbox')) params[name] = fixtures.documentId || 1;
    else if (lower.includes('mail-accounts')) params[name] = fixtures.mailAccountId || 1;
    else if (lower.includes('providers')) params[name] = fixtures.providerId || 1;
    else if (lower.includes('purchase-orders')) params[name] = fixtures.purchaseOrderId || 1;
    else if (lower.includes('invoices')) params[name] = fixtures.invoiceId || 1;
    else if (lower.includes('payments')) params[name] = fixtures.paymentId || 1;
    else if (lower.includes('lab/orders')) params[name] = fixtures.labOrderId || 1;
    else if (lower.includes('imaging/orders')) params[name] = fixtures.imagingOrderId || 1;
    else if (lower.includes('pathology/orders')) params[name] = fixtures.pathologyOrderId || 1;
    else if (lower.includes('surgeries')) params[name] = fixtures.surgeryId || 1;
    else if (lower.includes('hospitalizations')) params[name] = fixtures.hospitalizationId || 1;
    else if (lower.includes('tele')) params[name] = fixtures.teleSessionId || 1;
    else if (lower.includes('branches')) params[name] = fixtures.branchId || 1;
    else if (lower.includes('users')) params[name] = fixtures.userId || 1;
    else params[name] = 1;
  }
  return params;
}

function applyPathParams(pathname, params) {
  let out = pathname;
  for (const [key, value] of Object.entries(params)) {
    out = out.replace(new RegExp(`\\{${key}\\}`, 'g'), encodeURIComponent(String(value)));
  }
  return out;
}

function patchKnownBody(pathname, method, body, fixtures) {
  const out = body && typeof body === 'object' ? deepClone(body) : {};
  const full = `${method.toUpperCase()} ${pathname}`;

  if (full === 'POST /auth/login') return { email: ADMIN_CREDS.email, password: ADMIN_CREDS.password };
  if (full === 'POST /appointments') {
    return {
      patientId: fixtures.patientId || 18,
      vetId: fixtures.userId || 1,
      scheduledDate: '2026-05-20T15:00:00Z',
      durationMinutes: 30,
      appointmentTypeId: fixtures.appointmentTypeId || 1,
      reason: 'route-audit',
      notes: 'runtime route audit',
      isEmergency: false,
    };
  }
  if (pathname.startsWith('/triage/') || pathname.includes('/appointments/{id}/triage')) {
    return {
      priority: 'urgent',
      chiefComplaint: 'route-audit',
      temperature: 38.5,
      painScore: 2,
      notes: 'runtime route audit',
    };
  }
  if (full === 'POST /patients') {
    return {
      name: `AUDIT PACIENTE ${Date.now()}`,
      speciesId: fixtures.speciesId || 1,
      primaryOwnerId: fixtures.clientId || 1,
      sex: 'male',
      notes: 'runtime route audit',
    };
  }
  if (full === 'POST /patients/{id}/owners') {
    return {
      clientId: fixtures.secondaryClientId || fixtures.clientId || 1,
      ownershipType: 'secondary',
    };
  }
  if (full === 'POST /medical-records') {
    const payload = {
      patientId: fixtures.patientId || 1,
      chiefComplaint: 'route audit',
      weightKg: 10.5,
      temperature: 38.5,
      notes: 'runtime route audit',
    };
    if (fixtures.appointmentId) payload.appointmentId = fixtures.appointmentId;
    return payload;
  }
  if (pathname.includes('/prescriptions')) {
    return {
      items: [{
        medicationName: 'Audit Med',
        dose: '1 comp',
        frequency: 'cada 12h',
        durationDays: 5,
        quantity: 10,
        instructions: 'route audit',
      }],
      notes: 'route audit',
      refills: 0,
    };
  }
  if (pathname.includes('/status') && method.toLowerCase() === 'patch') {
    return { status: 'confirmed' };
  }
  if (full === 'PATCH /auth/admin/auth/policy') {
    return {
      twoFactorOptionalEnabled: true,
      twoFactorEnforced: false,
    };
  }
  return out;
}

async function bootstrapFixtures(adminToken, csrfToken) {
  const fixtures = { _sources: {} };

  const loginResp = await requestJson('POST', `${API_PREFIX}/auth/login`, {
    headers: { 'X-CSRF-Token': csrfToken },
    body: ADMIN_CREDS,
  });
  const user = loginResp.json?.data?.user;
  fixtures.userId = user?.id || 1;
  fixtures._sources.userId = user?.id ? 'login' : 'fallback';
  fixtures.branchId = user?.branchId || 1;
  fixtures._sources.branchId = user?.branchId ? 'login' : 'fallback';

  const speciesResp = await requestJson('GET', `${API_PREFIX}/species/all`, { token: adminToken });
  fixtures.speciesId = speciesResp.json?.data?.[0]?.id || 1;
  fixtures._sources.speciesId = speciesResp.json?.data?.[0]?.id ? 'list' : 'fallback';

  const patientsResp = await requestJson('GET', `${API_PREFIX}/patients?limit=1`, { token: adminToken });
  fixtures.patientId = patientsResp.json?.data?.[0]?.id || 1;
  fixtures._sources.patientId = patientsResp.json?.data?.[0]?.id ? 'list' : 'fallback';
  fixtures.clientId = patientsResp.json?.data?.[0]?.owner_id || 1;
  fixtures._sources.clientId = patientsResp.json?.data?.[0]?.owner_id ? 'patient_owner' : 'fallback';

  if (fixtures._sources.clientId === 'fallback') {
    try {
      const createdClientResp = await requestJson('POST', `${API_PREFIX}/clients`, {
        token: adminToken,
        headers: { 'X-CSRF-Token': csrfToken },
        body: {
          firstName: 'Audit',
          lastName: `Owner ${Date.now()}`,
          phone: '+54-11-5555-0001',
          email: `audit-owner-${Date.now()}@example.com`,
        },
      });
      if (createdClientResp.ok && createdClientResp.json?.data?.id) {
        fixtures.clientId = createdClientResp.json.data.id;
        fixtures._sources.clientId = 'created';
      }
    } catch {}
  }

  if (fixtures._sources.patientId === 'fallback' && fixtures.clientId) {
    try {
      const createdPatientResp = await requestJson('POST', `${API_PREFIX}/patients`, {
        token: adminToken,
        headers: { 'X-CSRF-Token': csrfToken },
        body: {
          name: `AUDIT PACIENTE ${Date.now()}`,
          speciesId: fixtures.speciesId || 1,
          primaryOwnerId: fixtures.clientId,
          sex: 'male',
          notes: 'runtime route audit bootstrap',
        },
      });
      if (createdPatientResp.ok) {
        const refreshedPatientsResp = await requestJson('GET', `${API_PREFIX}/patients?limit=1`, { token: adminToken });
        const createdPatientId = createdPatientResp.json?.data?.id || refreshedPatientsResp.json?.data?.[0]?.id;
        if (createdPatientId) {
          fixtures.patientId = createdPatientId;
          fixtures._sources.patientId = 'created';
        }
      }
    } catch {}
  }

  const apptTypesResp = await requestJson('GET', `${API_PREFIX}/appointments/types`, { token: adminToken });
  fixtures.appointmentTypeId = apptTypesResp.json?.data?.[0]?.id || 1;
  fixtures._sources.appointmentTypeId = apptTypesResp.json?.data?.[0]?.id ? 'list' : 'fallback';

  const createApptResp = await requestJson('POST', `${API_PREFIX}/appointments`, {
    token: adminToken,
    headers: { 'X-CSRF-Token': csrfToken },
    body: {
      patientId: fixtures.patientId,
      vetId: fixtures.userId,
      scheduledDate: '2026-05-20T18:00:00Z',
      durationMinutes: 30,
      appointmentTypeId: fixtures.appointmentTypeId,
      reason: 'audit bootstrap',
      notes: 'bootstrap fixture',
      isEmergency: true,
    },
  });
  fixtures.appointmentId = createApptResp.json?.data?.id || 1;
  fixtures._sources.appointmentId = createApptResp.json?.data?.id ? 'created' : 'fallback';

  const fixtureRequests = [
    ['roles', 'GET', `${API_PREFIX}/auth/admin/rbac/roles`],
    ['preview', 'GET', `${API_PREFIX}/auth/admin/preview`],
    ['clients', 'GET', `${API_PREFIX}/clients?limit=5`],
    ['invoices', 'GET', `${API_PREFIX}/invoices?limit=1`],
    ['purchaseOrders', 'GET', `${API_PREFIX}/purchase-orders?limit=1`],
    ['reminders', 'GET', `${API_PREFIX}/notifications/reminders?limit=1`],
    ['mailAccounts', 'GET', `${API_PREFIX}/documents/mail-accounts?limit=1`],
    ['documents', 'GET', `${API_PREFIX}/documents/inbox?limit=1`],
    ['tele', 'GET', `${API_PREFIX}/tele/sessions?limit=1`],
    ['lab', 'GET', `${API_PREFIX}/lab/orders?limit=1`],
    ['imaging', 'GET', `${API_PREFIX}/imaging/orders?limit=1`],
    ['pathology', 'GET', `${API_PREFIX}/pathology/orders?limit=1`],
    ['surgeries', 'GET', `${API_PREFIX}/surgeries?limit=1`],
    ['hospitalizations', 'GET', `${API_PREFIX}/hospitalizations?limit=1`],
  ];
  const settled = await Promise.allSettled(
    fixtureRequests.map(([, method, pathname]) => requestJson(method, pathname, { token: adminToken }))
  );
  const fixtureMap = Object.fromEntries(
    fixtureRequests.map(([name], index) => [name, settled[index].status === 'fulfilled' ? settled[index].value : null])
  );

  fixtures.role = fixtureMap.roles?.json?.data?.[0]?.name || 'org_admin';
  fixtures._sources.role = fixtureMap.roles?.json?.data?.[0]?.name ? 'list' : 'fallback';
  fixtures.tableName = fixtureMap.preview?.json?.data?.tables?.[0]?.key || 'patients';
  fixtures._sources.tableName = fixtureMap.preview?.json?.data?.tables?.[0]?.key ? 'list' : 'fallback';
  fixtures.secondaryClientId = fixtureMap.clients?.json?.data?.find?.((row) => row.id && row.id !== fixtures.clientId)?.id || null;
  fixtures._sources.secondaryClientId = fixtures.secondaryClientId ? 'list' : 'missing';
  if (!fixtures.secondaryClientId && fixtures.clientId) {
    try {
      const secondaryClientResp = await requestJson('POST', `${API_PREFIX}/clients`, {
        token: adminToken,
        headers: { 'X-CSRF-Token': csrfToken },
        body: {
          firstName: 'Audit',
          lastName: `Secondary ${Date.now()}`,
          phone: '+54-11-5555-0002',
          email: `audit-secondary-${Date.now()}@example.com`,
        },
      });
      if (secondaryClientResp.ok && secondaryClientResp.json?.data?.id) {
        fixtures.secondaryClientId = secondaryClientResp.json.data.id;
        fixtures._sources.secondaryClientId = 'created';
      }
    } catch {}
  }

  fixtures.invoiceId = fixtureMap.invoices?.json?.data?.[0]?.id || 1;
  fixtures._sources.invoiceId = fixtureMap.invoices?.json?.data?.[0]?.id ? 'list' : 'fallback';
  fixtures.purchaseOrderId = fixtureMap.purchaseOrders?.json?.data?.[0]?.id || 1;
  fixtures._sources.purchaseOrderId = fixtureMap.purchaseOrders?.json?.data?.[0]?.id ? 'list' : 'fallback';
  fixtures.reminderId = fixtureMap.reminders?.json?.data?.[0]?.id || 1;
  fixtures._sources.reminderId = fixtureMap.reminders?.json?.data?.[0]?.id ? 'list' : 'fallback';
  fixtures.mailAccountId = fixtureMap.mailAccounts?.json?.data?.[0]?.id || 1;
  fixtures._sources.mailAccountId = fixtureMap.mailAccounts?.json?.data?.[0]?.id ? 'list' : 'fallback';
  fixtures.documentId = fixtureMap.documents?.json?.data?.[0]?.id || 1;
  fixtures._sources.documentId = fixtureMap.documents?.json?.data?.[0]?.id ? 'list' : 'fallback';
  fixtures.teleSessionId = fixtureMap.tele?.json?.data?.[0]?.id || 1;
  fixtures._sources.teleSessionId = fixtureMap.tele?.json?.data?.[0]?.id ? 'list' : 'fallback';
  fixtures.labOrderId = fixtureMap.lab?.json?.data?.[0]?.id || 1;
  fixtures._sources.labOrderId = fixtureMap.lab?.json?.data?.[0]?.id ? 'list' : 'fallback';
  fixtures.imagingOrderId = fixtureMap.imaging?.json?.data?.[0]?.id || 1;
  fixtures._sources.imagingOrderId = fixtureMap.imaging?.json?.data?.[0]?.id ? 'list' : 'fallback';
  fixtures.pathologyOrderId = fixtureMap.pathology?.json?.data?.[0]?.id || 1;
  fixtures._sources.pathologyOrderId = fixtureMap.pathology?.json?.data?.[0]?.id ? 'list' : 'fallback';
  fixtures.surgeryId = fixtureMap.surgeries?.json?.data?.[0]?.id || 1;
  fixtures._sources.surgeryId = fixtureMap.surgeries?.json?.data?.[0]?.id ? 'list' : 'fallback';
  fixtures.hospitalizationId = fixtureMap.hospitalizations?.json?.data?.[0]?.id || 1;
  fixtures._sources.hospitalizationId = fixtureMap.hospitalizations?.json?.data?.[0]?.id ? 'list' : 'fallback';

  return fixtures;
}

function classify(status) {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 400) return 'validation';
  if (status === 401) return 'auth';
  if (status === 403) return 'rbac_or_forbidden';
  if (status === 404) return 'not_found';
  if (status === 405) return 'method_not_allowed';
  if (status >= 500) return 'server_error';
  return 'other';
}

function diagnoseResult(result, fixtures = {}) {
  const message = String(result.message || '').toLowerCase();
  const path = String(result.path || '');
  const sources = fixtures._sources || {};

  const pathUsesFallbackFixture = (
    (path.includes('/invoices/') && sources.invoiceId === 'fallback')
    || (path.includes('/purchase-orders/') && sources.purchaseOrderId === 'fallback')
    || (path.includes('/notifications/messages/reminder/') && sources.reminderId === 'fallback')
    || (path.includes('/documents/mail-accounts/') && sources.mailAccountId === 'fallback')
    || (path.includes('/documents/inbox/') && sources.documentId === 'fallback')
    || (path.includes('/lab/orders/') && sources.labOrderId === 'fallback')
    || (path.includes('/imaging/orders/') && sources.imagingOrderId === 'fallback')
    || (path.includes('/pathology/orders/') && sources.pathologyOrderId === 'fallback')
    || (path.includes('/surgeries/') && sources.surgeryId === 'fallback')
    || (path.includes('/hospitalizations/') && sources.hospitalizationId === 'fallback')
  );

  if (result.classification === 'not_found') {
    if (message.includes('route not found')) return 'route_missing';
    if (pathUsesFallbackFixture) return 'fixture_missing';
    if (
      message.includes('not found')
      || message.includes('no encontrada')
      || message.includes('no encontrado')
      || message.includes('recordatorio no encontrado')
      || message.includes('factura no encontrada')
      || message.includes('orden de compra no encontrada')
      || message.includes('mail account not found')
      || message.includes('inbox document not found')
      || message.includes('client not found')
    ) {
      return 'resource_missing_or_scope';
    }
    return 'not_found_unclassified';
  }

  if (result.classification === 'rbac_or_forbidden') {
    if (message.includes('acceso exclusivo para duenios')) return 'wrong_auth_context';
    return 'rbac_or_scope';
  }

  if (result.classification === 'validation') {
    if (path === '/medical-records' && message.includes('request validation failed')) return 'audit_payload_mismatch';
    return 'validation_expected';
  }

  if (result.classification === 'request_error') return 'timeout_or_transport';
  if (result.classification === 'server_error') return 'backend_error';
  return null;
}

async function main() {
  const spec = YAML.load(OPENAPI_PATH);
  const csrfToken = await getCsrfToken();
  const loginResp = await login(ADMIN_CREDS.email, ADMIN_CREDS.password, csrfToken);
  if (!loginResp.ok || !loginResp.json?.data?.accessToken) {
    throw new Error(`admin login failed: ${loginResp.status} ${loginResp.text}`);
  }
  const token = loginResp.json.data.accessToken;
  const fixtures = await bootstrapFixtures(token, csrfToken);

  const operations = [];
  for (const [pathname, item] of Object.entries(spec.paths)) {
    if (shouldSkipPath(pathname)) continue;
    if (PATH_FILTER && !PATH_FILTER.test(pathname)) continue;
    for (const [method, op] of Object.entries(item)) {
      const upper = method.toUpperCase();
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(upper)) continue;
      operations.push({ pathname, method, upper, op });
    }
  }

  operations.sort((a, b) => {
    const aLate = /\/auth\/logout(?:-all)?$|\/auth\/sessions\/\{id\}$/.test(a.pathname) ? 1 : 0;
    const bLate = /\/auth\/logout(?:-all)?$|\/auth\/sessions\/\{id\}$/.test(b.pathname) ? 1 : 0;
    return aLate - bLate;
  });

  const results = [];
  for (const { pathname, method, upper, op } of operations) {
      const pathParams = inferPathParams(pathname, fixtures);
      const resolvedPath = applyPathParams(normalizePath(pathname), pathParams);

      let body;
      if (op.requestBody?.content?.['application/json']?.schema) {
        body = pickExample(spec, op.requestBody.content['application/json'].schema) || {};
        body = patchKnownBody(pathname, method, body, fixtures);
      } else if (['POST', 'PUT', 'PATCH'].includes(upper)) {
        body = patchKnownBody(pathname, method, {}, fixtures);
      }

      const headers = {};
      const useAuth = !isPublicAuthPath(pathname);
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(upper)) headers['X-CSRF-Token'] = csrfToken;

      let resp;
      try {
        resp = await requestJson(upper, resolvedPath, {
          token: useAuth ? token : undefined,
          headers,
          body,
        });
      } catch (error) {
        const failure = {
          method: upper,
          path: pathname,
          resolvedPath,
          status: 0,
          classification: 'request_error',
          message: error.message,
        };
        failure.diagnosis = diagnoseResult(failure, fixtures);
        results.push(failure);
        continue;
      }

      results.push({
        method: upper,
        path: pathname,
        resolvedPath,
        summary: op.summary || '',
        status: resp.status,
        classification: classify(resp.status),
        message: resp.json?.error?.message || resp.text?.slice(0, 160) || '',
      });
      results[results.length - 1].diagnosis = diagnoseResult(results[results.length - 1], fixtures);
      await sleep(REQUEST_DELAY_MS);
  }

  const counts = results.reduce((acc, item) => {
    acc.total += 1;
    acc.byStatus[item.status] = (acc.byStatus[item.status] || 0) + 1;
    acc.byClass[item.classification] = (acc.byClass[item.classification] || 0) + 1;
    return acc;
  }, { total: 0, byStatus: {}, byClass: {} });

  const failures = results.filter((r) => ![200, 201, 204].includes(r.status));
  const diagnosisCounts = failures.reduce((acc, item) => {
    const key = item.diagnosis || 'unspecified';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const report = {
    auditedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    adminUser: ADMIN_CREDS.email,
    fixtures,
    counts,
    diagnosisCounts,
    failures,
    sampleSuccesses: results.filter((r) => [200, 201, 204].includes(r.status)).slice(0, 30),
  };

  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
