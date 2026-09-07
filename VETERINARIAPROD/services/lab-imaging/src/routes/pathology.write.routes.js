'use strict';

const { Router } = require('express');
const { body } = require('express-validator');
const { db, R, validate, logPathologyError } = require('./pathology.common');

const router = Router();

router.post('/orders',
  body('patientId').isInt(),
  body('pathologyTypeId').isInt(),
  validate,
  async (req, res, next) => {
    try {
      const { patientId, medicalRecordId, pathologyTypeId, clinicalHistory, samples = [] } = req.body;
      const patient = await db.queryOne(
        `SELECT p.id
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
            )`,
        { patientId, orgId: req.user.orgId, branchId: req.user.branchId }
      );
      if (!patient) return R.notFound(res, 'Paciente no encontrado');
      if (medicalRecordId) {
        const record = await db.queryOne(
          `SELECT mr.id
             FROM medical_records mr
             JOIN patients p ON p.id = mr.patient_id
            WHERE mr.id = :medicalRecordId
              AND mr.patient_id = :patientId
              AND p.organization_id = :orgId
              AND EXISTS (
                SELECT 1
                  FROM patient_owners po
                  JOIN clients c ON c.id = po.client_id
                 WHERE po.patient_id = p.id
                   AND c.branch_id = :branchId
                   AND po.deleted_at IS NULL
              )`,
          { medicalRecordId, patientId, orgId: req.user.orgId, branchId: req.user.branchId }
        );
        if (!record) return R.forbidden(res, 'Historia clinica fuera de alcance');
      }

      // BUG-3: envolver en transacción con FOR UPDATE para evitar números de orden duplicados
      const { id: orderId, orderNumber } = await db.transaction(async (conn) => {
        const [{ nextNum }] = await conn.query(
          `SELECT COALESCE(MAX(CAST(SUBSTRING(order_number,4) AS UNSIGNED)),0)+1 AS nextNum
           FROM pathology_orders WHERE branch_id = :bid FOR UPDATE`,
          { bid: req.user.branchId }
        );
        const num = `PAT${String(nextNum).padStart(6, '0')}`;
        const [r] = await conn.query(
          `INSERT INTO pathology_orders
             (branch_id, patient_id, medical_record_id, pathology_type_id,
              order_number, clinical_history, ordered_by, status)
           VALUES (:bid,:pid,:mid,:type,:num,:hist,:uid,'pending')`,
          {
            bid: req.user.branchId, pid: patientId, mid: medicalRecordId || null,
            type: pathologyTypeId, num,
            hist: clinicalHistory || null, uid: req.user.userId,
          }
        );
        const oid = r.insertId;
        for (let i = 0; i < samples.length; i++) {
          const s = samples[i];
          await conn.query(
            `INSERT INTO pathology_samples
               (pathology_order_id, sample_number, sample_type, anatomical_location,
                collection_date, fixation_method, macroscopic_description)
             VALUES (?,?,?,?,?,?,?)`,
            [oid, i + 1, s.sampleType, s.anatomicalLocation || null,
             s.collectionDate || null, s.fixationMethod || null, s.macroscopicDescription || null]
          );
        }
        return { id: oid, orderNumber: num };
      });
      return R.created(res, { id: orderId, orderNumber });
    } catch (e) {
      logPathologyError('POST /pathology/orders', e, { branchId: req.user?.branchId, orgId: req.user?.orgId, body: req.body });
      next(e);
    }
  }
);

router.post('/orders/:id/result',
  body('microscopicDescription').notEmpty(),
  body('diagnosis').notEmpty(),
  validate,
  async (req, res, next) => {
    try {
      const {
        microscopicDescription, diagnosis, behavior,
        differentialDiagnosis, prognosticNotes,
        tnmT, tnmN, tnmM, tnmStage,
        ihcResults, specialStains, recommendations,
      } = req.body;
      const order = await db.queryOne(
        `SELECT id FROM pathology_orders WHERE id = :id AND branch_id = :bid`,
        { id: req.params.id, bid: req.user.branchId }
      );
      if (!order) return R.notFound(res, 'Orden de patologia no encontrada');

      const [r] = await db.query(
        `INSERT INTO pathology_results
           (pathology_order_id, pathologist_id,
            microscopic_description, diagnosis, behavior,
            differential_diagnosis, prognostic_notes,
            tnm_t, tnm_n, tnm_m, tnm_stage,
            ihc_results, special_stains, recommendations, reported_at)
         VALUES (:oid,:uid,:micro,:diag,:beh,:diff,:prog,
                 :tt,:tn,:tm,:ts,:ihc,:stain,:rec,NOW())`,
        {
          oid: req.params.id, uid: req.user.userId,
          micro: microscopicDescription, diag: diagnosis,
          beh: behavior || null, diff: differentialDiagnosis || null,
          prog: prognosticNotes || null,
          tt: tnmT || null, tn: tnmN || null, tm: tnmM || null, ts: tnmStage || null,
          ihc: ihcResults || null, stain: specialStains || null, rec: recommendations || null,
        }
      );
      await db.query(
        `UPDATE pathology_orders SET status='reported', reported_at=NOW() WHERE id=? AND branch_id=?`,
        [req.params.id, req.user.branchId]
      );
      return R.created(res, { id: r.insertId });
    } catch (e) {
      logPathologyError('POST /pathology/orders/:id/result', e, { branchId: req.user?.branchId, orgId: req.user?.orgId, params: req.params, body: req.body });
      next(e);
    }
  }
);

module.exports = { router };
