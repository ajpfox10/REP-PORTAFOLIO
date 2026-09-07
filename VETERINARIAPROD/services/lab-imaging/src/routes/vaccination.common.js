'use strict';

const { validationResult } = require('express-validator');
const db = require('../../../../shared/db');
const R = require('../../../../shared/response');
const { createLogger } = require('../../../../shared/logger');
const log = createLogger('lab-imaging.vaccination');

const validate = (req, res, next) => {
  const e = validationResult(req);
  if (!e.isEmpty()) return R.badRequest(res, 'Validation failed', e.array());
  next();
};

const getRows = async (sql, params = {}) => {
  const result = await db.query(sql, params);
  return Array.isArray(result?.[0]) ? result[0] : result;
};

const getInsertResult = async (sql, params = {}) => {
  const result = await db.query(sql, params);
  return Array.isArray(result) ? result[0] : result;
};

async function resolveBranchFromPatient(req, patientId) {
  // branchId y orgId SIEMPRE deben venir del token — nunca del body
  const userBranchId = req.user?.branchId || null;
  const userOrgId    = req.user?.orgId    || null;

  if (!userBranchId) {
    return { error: 'Usuario sin sucursal asignada' };
  }

  // Verifica tenancy usando el mismo patrón que el resto del servicio:
  // patient_owners → clients → branch_id (no confiar en patients.branch_id)
  const patients = await getRows(
    `SELECT p.id, p.organization_id
       FROM patients p
      WHERE p.id = :patientId
        AND p.organization_id = :orgId
        AND EXISTS (
          SELECT 1
            FROM patient_owners po
            JOIN clients c ON c.id = po.client_id
           WHERE po.patient_id = p.id
             AND c.branch_id = :branchId
             AND po.deleted_at IS NULL
        )
      LIMIT 1`,
    { patientId, orgId: userOrgId, branchId: userBranchId }
  );

  const patient = patients[0];

  if (!patient) {
    return { error: 'Paciente no encontrado' };
  }

  return { patient, branchId: userBranchId };
}

function logVaccinationError(scope, error, meta = {}) {
  log.error(`${scope}`, {
    message: error?.message,
    code: error?.code,
    errno: error?.errno,
    sqlState: error?.sqlState,
    sqlMessage: error?.sqlMessage,
    meta,
  });
}

module.exports = {
  db,
  R,
  validate,
  getRows,
  getInsertResult,
  resolveBranchFromPatient,
  logVaccinationError,
};
