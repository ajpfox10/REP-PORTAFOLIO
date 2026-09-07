'use strict';

const { Router } = require('express');
const { body } = require('express-validator');
const { db, R, validate, resolveMedicalRecordId, logHospitalizationError } = require('./hospitalization.common');

const router = Router();

router.post('/',
  body('patientId').isInt(),
  body('responsibleVetId').isInt(),
  body('hospitalizationReason').notEmpty().isString().trim().isLength({ max: 500 }),
  body('admissionDiagnosis').optional().isString().trim().isLength({ max: 1000 }),
  body('specialInstructions').optional().isString().trim().isLength({ max: 2000 }),
  validate,
  async (req, res, next) => {
    try {
      const admission = await db.transaction(async (conn) => {
        const patient = await conn.queryOne(
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
          { patientId: req.body.patientId, orgId: req.user.orgId, branchId: req.user.branchId }
        );
        if (!patient) {
          const err = new Error('Paciente no encontrado');
          err.httpStatus = 404;
          throw err;
        }
        const vet = await conn.queryOne(
          `SELECT id FROM users WHERE id = :vetId AND branch_id = :branchId`,
          { vetId: req.body.responsibleVetId, branchId: req.user.branchId }
        );
        if (!vet) {
          const err = new Error('Veterinario responsable fuera de sucursal');
          err.httpStatus = 403;
          throw err;
        }
        if (req.body.kennelId) {
          const kennel = await conn.queryOne(
            `SELECT k.id
               FROM kennels k
               JOIN wards w ON w.id = k.ward_id
              WHERE k.id = :kennelId AND w.branch_id = :branchId FOR UPDATE`,
            { kennelId: req.body.kennelId, branchId: req.user.branchId }
          );
          if (!kennel) {
            const err = new Error('Jaula fuera de sucursal');
            err.httpStatus = 403;
            throw err;
          }
          // Verificar que el kennel no esté actualmente ocupado (race condition)
          const occupied = await conn.queryOne(
            `SELECT id FROM hospitalizations
              WHERE kennel_id = :kennelId
                AND discharge_date IS NULL
              LIMIT 1`,
            { kennelId: req.body.kennelId }
          );
          if (occupied) {
            const err = new Error('La jaula seleccionada ya está ocupada');
            err.httpStatus = 409;
            throw err;
          }
        }
        const resolvedMedicalRecordId = await resolveMedicalRecordId(conn, {
          patientId: req.body.patientId,
          branchId: req.user.branchId,
          medicalRecordId: req.body.medicalRecordId || null,
        });
        const [r] = await conn.query(
          `INSERT INTO hospitalizations
             (branch_id, patient_id, medical_record_id, responsible_vet_id, kennel_id,
              hospitalization_reason, admission_diagnosis, hospitalization_status,
              admission_weight, estimated_discharge_date, special_instructions, created_by)
           VALUES (:bid,:pid,:mrid,:vetid,:kennelid,
                   :reason,:diagnosis,'admitted',
                   :weight,:estimated,:instructions,:uid)`,
          {
            bid: req.user.branchId,
            pid: req.body.patientId,
            mrid: resolvedMedicalRecordId,
            vetid: req.body.responsibleVetId,
            kennelid: req.body.kennelId || null,
            reason: req.body.hospitalizationReason,
            diagnosis: req.body.admissionDiagnosis || null,
            weight: req.body.admissionWeight || null,
            estimated: req.body.estimatedDischargeDate || null,
            instructions: req.body.specialInstructions || null,
            uid: req.user.userId,
          }
        );
        return {
          id: r.insertId,
          branch_id: req.user.branchId,
          patient_id: req.body.patientId,
          medical_record_id: resolvedMedicalRecordId,
          responsible_vet_id: req.body.responsibleVetId,
          kennel_id: req.body.kennelId || null,
          hospitalization_reason: req.body.hospitalizationReason,
          admission_diagnosis: req.body.admissionDiagnosis || null,
          hospitalization_status: 'admitted',
          admission_weight: req.body.admissionWeight || null,
          estimated_discharge_date: req.body.estimatedDischargeDate || null,
          special_instructions: req.body.specialInstructions || null,
          created_by: req.user.userId,
        };
      });
      return R.created(res, admission);
    } catch (e) {
      if (e.httpStatus === 404) return R.notFound(res, e.message);
      if (e.httpStatus === 403) return R.forbidden(res, e.message);
      if (e.httpStatus === 409) return R.conflict(res, e.message);
      if (e.message?.includes('SQLSTATE')) {
        return R.conflict(res, e.message.replace(/.*SQLSTATE\[45000\]:.*: \d+ /, ''));
      }
      logHospitalizationError('POST /hospitalizations', e, { branchId: req.user?.branchId, body: req.body });
      next(e);
    }
  }
);

router.post('/:id(\\d+)/monitoring',
  body('recordedAt').isISO8601(),
  validate,
  async (req, res, next) => {
    try {
      const activeHosp = await db.queryOne(
        `SELECT id FROM hospitalizations WHERE id = :id AND branch_id = :bid AND discharge_date IS NULL`,
        { id: req.params.id, bid: req.user.branchId }
      );
      if (!activeHosp) return R.conflict(res, 'Cannot add monitoring to a discharged or non-existent hospitalization');

      const {
        recordedAt, temperature, heartRate, respiratoryRate,
        systolicBp, diastolicBp, spo2, weight,
        consciousness, painScore, hydration,
        appetite, urination, defecation,
        woundStatus, ivSiteStatus, notes,
      } = req.body;

      const [r] = await db.query(
        `INSERT INTO hospitalization_monitoring
           (hospitalization_id, recorded_at,
            temperature_celsius, heart_rate, respiratory_rate,
            systolic_bp, diastolic_bp, spo2_percent, weight_kg,
            consciousness_level, pain_score, hydration_status,
            appetite, urination, defecation,
            wound_status, iv_site_status, notes, recorded_by)
         VALUES (:hid,:at,:temp,:hr,:rr,:sbp,:dbp,:spo2,:wt,
                 :cons,:pain,:hyd,:app,:uri,:def,:wound,:iv,:notes,:uid)` ,
        {
          hid: req.params.id, at: recordedAt,
          temp: temperature ?? null, hr: heartRate ?? null, rr: respiratoryRate ?? null,
          sbp: systolicBp ?? null, dbp: diastolicBp ?? null, spo2: spo2 ?? null,
          wt: weight ?? null, cons: consciousness || null, pain: painScore ?? null,
          hyd: hydration || null, app: appetite || null, uri: urination || null,
          def: defecation || null, wound: woundStatus || null, iv: ivSiteStatus || null,
          notes: notes || null, uid: req.user.userId,
        }
      );
      return R.created(res, { id: r.insertId });
    } catch (e) {
      logHospitalizationError('POST /hospitalizations/:id/monitoring', e, { hospitalizationId: req.params.id, body: req.body });
      next(e);
    }
  }
);

router.post('/:id(\\d+)/medications',
  body('medicationId').optional().isInt(),
  body('medicationName').optional().isString().trim().notEmpty(),
  body('dose').notEmpty(),
  body('frequency').notEmpty(),
  validate,
  async (req, res, next) => {
    try {
      const { medicationId, medicationName, dose, doseUnit, frequency, route, startDate, endDate, instructions } = req.body;
      const activeHosp = await db.queryOne(
        `SELECT id FROM hospitalizations WHERE id = :id AND branch_id = :bid AND discharge_date IS NULL`,
        { id: req.params.id, bid: req.user.branchId }
      );
      if (!activeHosp) return R.conflict(res, 'Cannot add medication to a discharged or non-existent hospitalization');

      let resolvedMedicationId = medicationId || null;
      if (!resolvedMedicationId && medicationName) {
        const existing = await db.queryOne(
          `SELECT id FROM medications WHERE name = :name LIMIT 1`,
          { name: medicationName }
        );
        if (existing?.id) {
          resolvedMedicationId = existing.id;
        } else {
          const [created] = await db.query(
            `INSERT INTO medications (name, is_active) VALUES (:name, 1)`,
            { name: medicationName }
          );
          resolvedMedicationId = created.insertId;
        }
      }
      if (!resolvedMedicationId) return R.badRequest(res, 'medicationId or medicationName is required');
      const [r] = await db.query(
        `INSERT INTO hospitalization_medications
           (hospitalization_id, medication_id, dose, dose_unit, frequency, route,
            start_date, end_date, instructions, prescribed_by)
         VALUES (:hid,:med,:dose,:unit,:freq,:route,:start,:end,:instr,:uid)`,
        {
          hid: req.params.id, med: resolvedMedicationId, dose,
          unit: doseUnit || null, freq: frequency, route: route || null,
          start: startDate || null, end: endDate || null,
          instr: instructions || null, uid: req.user.userId,
        }
      );
      return R.created(res, { id: r.insertId });
    } catch (e) {
      logHospitalizationError('POST /hospitalizations/:id/medications', e, { hospitalizationId: req.params.id, body: req.body });
      next(e);
    }
  }
);

router.patch('/:id(\\d+)/discharge',
  body('dischargeDate').isISO8601(),
  body('dischargeDiagnosis').optional().isString().trim().isLength({ max: 1000 }),
  body('dischargeInstructions').optional().isString().trim().isLength({ max: 2000 }),
  validate,
  async (req, res, next) => {
    try {
      await db.transaction(async (conn) => {
        const hosp = await conn.queryOne(
          `SELECT id, admission_date, hospitalization_status FROM hospitalizations
           WHERE id = :id AND branch_id = :bid FOR UPDATE`,
          { id: req.params.id, bid: req.user.branchId }
        );
        if (!hosp) {
          const err = new Error('Hospitalization not found');
          err.httpStatus = 404;
          throw err;
        }
        if (!['admitted', 'monitoring', 'critical'].includes(hosp.hospitalization_status)) {
          const err = new Error(`Cannot discharge a hospitalization with status '${hosp.hospitalization_status}'`);
          err.httpStatus = 409;
          throw err;
        }
        const dischargeDate = new Date(req.body.dischargeDate);
        if (dischargeDate < new Date(hosp.admission_date)) {
          const err = new Error('Discharge date cannot be before admission date');
          err.httpStatus = 400;
          throw err;
        }
        await conn.query(
          `UPDATE hospitalizations
           SET discharge_date = :dischargeDate,
               discharge_diagnosis = :diagnosis,
               discharge_instructions = :instructions,
               follow_up_date = :followUpDate,
               hospitalization_status = 'discharged',
               updated_at = NOW()
           WHERE id = :id AND branch_id = :bid`,
          {
            id: req.params.id,
            bid: req.user.branchId,
            dischargeDate: req.body.dischargeDate,
            diagnosis: req.body.dischargeDiagnosis || null,
            instructions: req.body.dischargeInstructions || null,
            followUpDate: req.body.followUpDate || null,
          }
        );
      });
      return R.ok(res, { message: 'Patient discharged successfully' });
    } catch (e) {
      if (e.httpStatus === 404) return R.notFound(res, e.message);
      if (e.httpStatus === 409) return R.conflict(res, e.message);
      if (e.httpStatus === 400) return R.badRequest(res, e.message);
      if (e.message?.includes('SQLSTATE')) {
        return R.conflict(res, e.message.replace(/.*SQLSTATE\[45000\]:.*: \d+ /, ''));
      }
      logHospitalizationError('PATCH /hospitalizations/:id/discharge', e, { hospitalizationId: req.params.id, body: req.body });
      next(e);
    }
  }
);

module.exports = { router };
