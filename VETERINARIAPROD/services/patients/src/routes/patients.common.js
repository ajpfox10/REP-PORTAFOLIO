'use strict';

const { body, validationResult } = require('express-validator');
const multer = require('multer');
const path = require('path');
const db = require('../../../../shared/db');
const R = require('../../../../shared/response');
const { createLogger } = require('../../../../shared/logger');
const log = createLogger('patients');
const { cacheMiddleware, httpCacheHeaders } = require('../../../../shared/cache');
const { buildOrgScope, buildBranchScope, scopeParams } = require('../../../../shared/tenantScope');

const ALLOWED_MIME_SIGNATURES = {
  'image/jpeg': [Buffer.from([0xFF, 0xD8, 0xFF])],
  'image/png': [Buffer.from([0x89, 0x50, 0x4E, 0x47])],
  'image/webp': [Buffer.from([0x52, 0x49, 0x46, 0x46])],
  'application/pdf': [Buffer.from([0x25, 0x50, 0x44, 0x46])],
};
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.pdf']);

function deletedPredicate(cols, alias) {
  return cols.has('deleted_at') ? `${alias}.deleted_at IS NULL` : '1 = 1';
}

function sanitizeFilename(name) {
  return path.basename(name)
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/\.{2,}/g, '.')
    .slice(0, 120);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE_MB || '20') * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) return cb(null, false);
    file.originalname = sanitizeFilename(file.originalname);
    cb(null, true);
  },
});

function validate(req, res, next) {
  const e = validationResult(req);
  if (!e.isEmpty()) return R.badRequest(res, 'Validation failed', e.array());
  next();
}

function logPatientsError(route, err, meta = {}) {
  log.error(`${route} failed`, {
    message: err?.message,
    code: err?.code,
    errno: err?.errno,
    sqlState: err?.sqlState,
    sqlMessage: err?.sqlMessage,
    sql: err?.sql,
    meta,
    stack: err?.stack,
  });
}

const SCHEMA_TTL_MS = parseInt(process.env.SCHEMA_CACHE_TTL_MS || '300000'); // 5 min
let _patientSchemaPromise = null;
let _patientSchemaExpiresAt = 0;

async function getPatientSchema() {
  if (_patientSchemaPromise && Date.now() < _patientSchemaExpiresAt) {
    return _patientSchemaPromise;
  }
  _patientSchemaExpiresAt = Date.now() + SCHEMA_TTL_MS;
  _patientSchemaPromise = db.query(
    `SELECT TABLE_NAME, COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN (
         'patients',
         'clients',
         'patient_owners',
         'appointments',
         'medical_records',
         'vaccinations',
         'deworming_records',
         'surgeries',
         'hospitalizations',
         'tele_sessions',
         'grooming_appointments',
         'patient_allergies',
         'patient_chronic_conditions'
       )`
  ).then((rows) => {
    const schema = {};
    for (const row of rows) {
      if (!schema[row.TABLE_NAME]) schema[row.TABLE_NAME] = new Set();
      schema[row.TABLE_NAME].add(row.COLUMN_NAME);
    }
    return schema;
  }).catch((err) => {
    // Resetear para reintentar en el próximo request
    _patientSchemaPromise = null;
    _patientSchemaExpiresAt = 0;
    throw err;
  });
  return _patientSchemaPromise;
}

async function getPatientListSchema() {
  return getPatientSchema();
}

function boolFromQuery(value, defaultValue = 1) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (['1', 1, true, 'true', 'yes'].includes(value)) return 1;
  if (['0', 0, false, 'false', 'no'].includes(value)) return 0;
  return defaultValue;
}

async function ensurePatientVisible(patientId, user) {
  const schema = await getPatientSchema();
  const patientCols = schema.patients || new Set();
  const clientCols = schema.clients || new Set();
  const ownerCols = schema.patient_owners || new Set();

  const scopes = [];
  if (patientCols.has('organization_id')) scopes.push(buildOrgScope('p'));
  if (clientCols.has('branch_id')) {
    scopes.push(
       `EXISTS (
         SELECT 1
         FROM patient_owners po
         JOIN clients cl ON cl.id = po.client_id
         WHERE po.patient_id = p.id
           AND ${deletedPredicate(ownerCols, 'po')}
           AND ${deletedPredicate(clientCols, 'cl')}
           ${ownerCols.has('active') ? 'AND po.active = 1' : ''}
           AND ${buildBranchScope('cl')}
       )`
    );
  }
  if (!scopes.length) throw new Error('Patients visibility schema unsupported');

  return db.queryOne(
    `SELECT p.id
     FROM patients p
     WHERE p.id = :id
       AND ${deletedPredicate(patientCols, 'p')}
       AND (${scopes.join(' OR ')})
     LIMIT 1`,
    scopeParams({ user }, { id: patientId })
  );
}

module.exports = {
  body,
  db,
  R,
  cacheMiddleware,
  httpCacheHeaders,
  ALLOWED_MIME_SIGNATURES,
  upload,
  validate,
  deletedPredicate,
  sanitizeFilename,
  logPatientsError,
  getPatientSchema,
  getPatientListSchema,
  boolFromQuery,
  ensurePatientVisible,
};
