'use strict';

const { Router } = require('express');
const { body, db, R, validate, logMedicalError } = require('./medical.common');
const { encrypt, encryptFields, ANAMNESIS_FIELDS } = require('../../../../shared/encryption');

async function ensureMedicalRecordInScope(req, recordId) {
  const branchId = req.user?.branchId || null;
  const orgId = req.user?.orgId || null;

  // Si el usuario pertenece a una sucursal específica, verificar que la ficha
  // pertenezca a esa sucursal. No permitir branchId=null como bypass cross-branch
  // cuando el token del usuario sí tiene branchId asignado.
  if (!orgId) return null;

  return db.queryOne(
    `SELECT mr.id
       FROM medical_records mr
       JOIN patients p ON p.id = mr.patient_id
       LEFT JOIN appointments a ON a.id = mr.appointment_id
      WHERE mr.id = :recordId
        AND p.organization_id = :orgId
        AND (
          :branchId IS NULL
          OR a.branch_id = :branchId
          OR EXISTS (
            SELECT 1
              FROM patient_owners po
              JOIN clients c ON c.id = po.client_id
             WHERE po.patient_id = p.id
               AND c.branch_id = :branchId
               AND po.deleted_at IS NULL
          )
        )`,
    {
      recordId,
      orgId,
      branchId,
    }
  );
}

module.exports = {
  Router,
  body,
  db,
  R,
  validate,
  logMedicalError,
  encrypt,
  encryptFields,
  ANAMNESIS_FIELDS,
  ensureMedicalRecordInScope,
};
