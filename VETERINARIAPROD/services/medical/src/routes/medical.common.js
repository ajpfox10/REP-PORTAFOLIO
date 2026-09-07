'use strict';

const { body, param, validationResult } = require('express-validator');
const db = require('../../../../shared/db');
const R = require('../../../../shared/response');
const { createLogger } = require('../../../../shared/logger');
const log = createLogger('medical');

function validate(req, res, next) {
  const e = validationResult(req);
  if (!e.isEmpty()) return R.badRequest(res, 'Validation failed', e.array());
  next();
}

function logMedicalError(scope, error, meta = {}) {
  log.error(`${scope}`, {
    message: error?.message,
    stack: error?.stack,
    ...meta,
  });
}

async function ensureMedicalRecordWritable(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const recordId = req.params.id;
  if (!recordId) return next();

  try {
    const record = await db.queryOne(
      `SELECT mr.id, mr.status, mr.signed_at, p.organization_id, a.branch_id
       FROM medical_records mr
       JOIN patients p ON p.id = mr.patient_id
       LEFT JOIN appointments a ON a.id = mr.appointment_id
       WHERE mr.id = :id`,
      { id: recordId }
    );
    if (!record) return R.notFound(res, 'Ficha clinica no encontrada');
    if (String(record.organization_id) !== String(req.user?.orgId || '')) {
      return R.forbidden(res, 'Ficha clinica fuera de la organizacion', 'MEDICAL_RECORD_TENANT_MISMATCH');
    }
    if (req.user?.branchId && record.branch_id && String(record.branch_id) !== String(req.user.branchId)) {
      return R.forbidden(res, 'Ficha clinica fuera de la sucursal', 'MEDICAL_RECORD_BRANCH_MISMATCH');
    }
    if (record.signed_at || ['signed', 'closed', 'cancelled'].includes(record.status)) {
      return R.conflict(res, 'La ficha clinica no admite modificaciones', 'MEDICAL_RECORD_LOCKED');
    }
    req.medicalRecord = record;
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  body,
  param,
  db,
  R,
  validate,
  logMedicalError,
  ensureMedicalRecordWritable,
};
