'use strict';

const path = require('path');
const { validationResult } = require('express-validator');
const db = require('../../../shared/db');
const R = require('../../../shared/response');
const { createLogger } = require('../../../shared/logger');
const log = createLogger('documents');
const { requirePerm } = require('../../../shared/serviceBase');
const { uploadFile, getPresignedUrl, getObjectBuffer, BUCKETS } = require('../../../shared/minio');
const { sha256 } = require('./lib/sync');
const { createLabOrderFromDocument } = require('./lib/labIngestion');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return R.badRequest(res, 'Validation failed', errors.array());
  next();
};

function parsePagination(queryParams, defaultLimit = 25) {
  const page = Math.max(parseInt(`${queryParams.page || '1'}`, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(`${queryParams.limit || `${defaultLimit}`}`, 10) || defaultLimit, 1), 100);
  return { page, limit, offset: (page - 1) * limit };
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function isPdf(file) {
  return file?.mimetype === 'application/pdf' || /\.pdf$/i.test(file?.originalname || '');
}

function hasPdfMagic(buffer) {
  return Buffer.isBuffer(buffer) && buffer.slice(0, 4).equals(Buffer.from([0x25, 0x50, 0x44, 0x46]));
}

function extractObjectRef(storagePath) {
  if (!storagePath) return null;
  try {
    const url = new URL(storagePath);
    const pathname = url.pathname.replace(/^\/+/, '');
    const [bucket, ...rest] = pathname.split('/');
    if (!bucket || !rest.length) return null;
    return { bucket, objectName: rest.join('/') };
  } catch {
    return null;
  }
}

async function ensurePatientInOrg(patientId, orgId) {
  if (!patientId) return null;
  return db.queryOne(
    `SELECT p.id, p.name
       FROM patients p
      WHERE p.id = :patientId AND p.organization_id = :orgId`,
    { patientId, orgId }
  );
}

function logDocumentsError(scope, error, meta = {}) {
  log.error(`${scope}`, {
    message: error?.message,
    code: error?.code,
    errno: error?.errno,
    sqlState: error?.sqlState,
    meta,
  });
}

module.exports = {
  path,
  db,
  R,
  requirePerm,
  uploadFile,
  getPresignedUrl,
  getObjectBuffer,
  BUCKETS,
  sha256,
  createLabOrderFromDocument,
  validate,
  parsePagination,
  parseJson,
  isPdf,
  hasPdfMagic,
  extractObjectRef,
  ensurePatientInOrg,
  logDocumentsError,
};
