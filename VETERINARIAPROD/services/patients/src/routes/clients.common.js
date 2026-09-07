'use strict';

const { body, validationResult } = require('express-validator');
const db = require('../../../../shared/db');
const R = require('../../../../shared/response');
const { createLogger } = require('../../../../shared/logger');
const log = createLogger('patients.clients');

function deletedPredicate(cols, alias) {
  return cols.has('deleted_at') ? `${alias}.deleted_at IS NULL` : '1 = 1';
}

function validate(req, res, next) {
  const e = validationResult(req);
  if (!e.isEmpty()) return R.badRequest(res, 'Validation failed', e.array());
  next();
}

function logClientsError(scope, error, meta = {}) {
  log.error(`${scope}`, {
    message: error?.message,
    stack: error?.stack,
    ...meta,
  });
}

let _clientSchemaPromise;
async function getClientSchema() {
  if (!_clientSchemaPromise) {
    _clientSchemaPromise = db.query(
      `SELECT TABLE_NAME, COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME IN ('clients', 'patients', 'patient_owners', 'client_emergency_contacts', 'countries', 'currencies')`
    ).then((rows) => {
      const schema = {};
      for (const row of rows) {
        if (!schema[row.TABLE_NAME]) schema[row.TABLE_NAME] = new Set();
        schema[row.TABLE_NAME].add(row.COLUMN_NAME);
      }
      return schema;
    });
  }
  return _clientSchemaPromise;
}

// OT-098: PII masking helpers — used when the caller lacks 'clients:pii' permission.
function maskEmail(email) {
  if (!email) return null;
  const at = email.indexOf('@');
  if (at < 0) return '***';
  return `${email[0]}***@${email.slice(at + 1)}`;
}

function maskPhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  return digits.length >= 4 ? `****${digits.slice(-4)}` : '****';
}

/**
 * Returns true when the request user is allowed to see full PII fields
 * (email, phone, document_number, tax_id).
 * Requires the 'clients:pii' permission or an admin role (org_admin / superadmin).
 */
function hasPiiAccess(req) {
  const perms = req.user?.permissions;
  if (Array.isArray(perms) && perms.includes('clients:pii')) return true;
  const roles = req.user?.roles;
  // 'org_admin' es el rol real; antes se chequeaba 'admin' (inexistente), dejando al
  // org_admin sin acceso a PII salvo permiso explicito. 'admin' se mantiene por legacy.
  if (Array.isArray(roles) && (roles.includes('org_admin') || roles.includes('admin') || roles.includes('superadmin'))) return true;
  return false;
}

module.exports = {
  body,
  db,
  R,
  deletedPredicate,
  validate,
  logClientsError,
  getClientSchema,
  maskEmail,
  maskPhone,
  hasPiiAccess,
};
