'use strict';

const { Router } = require('express');
const { body } = require('express-validator');
const { db, R, validate, resolveMedicalRecordId, logSurgeryError } = require('./surgery.common');

const router = Router();

router.post('/',
  body('patientId').isInt(),
  body('surgeryTypeId').isInt(),
  body('leadSurgeonId').isInt(),
  body('scheduledDate').isISO8601(),
  body('anesthesiologistId').optional().isInt({ min: 1 }),
  body('assistantSurgeonId').optional().isInt({ min: 1 }),
  body('surgicalNurseId').optional().isInt({ min: 1 }),
  body('urgency').optional().isIn(['elective', 'urgent', 'emergency']),
  body('preoperativeDiagnosis').optional().isString().trim().isLength({ max: 1000 }),
  body('surgicalApproach').optional().isString().trim().isLength({ max: 1000 }),
  body('notes').optional().isString().trim().isLength({ max: 2000 }),
  validate,
  async (req, res, next) => {
    try {
      const {
        patientId, medicalRecordId, surgeryTypeId, leadSurgeonId,
        assistantSurgeonId, anesthesiologistId, surgicalNurseId,
        scheduledDate, startTime, urgency = 'elective',
        preoperativeDiagnosis, surgicalApproach, notes,
      } = req.body;
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
      const staffIds = [leadSurgeonId, assistantSurgeonId, anesthesiologistId, surgicalNurseId].filter(Boolean);
      if (staffIds.length) {
        const staff = await db.query(
          `SELECT id FROM users WHERE branch_id = ? AND id IN (${staffIds.map(() => '?').join(',')})`,
          [req.user.branchId, ...staffIds]
        );
        if (staff.length !== new Set(staffIds).size) return R.forbidden(res, 'Equipo quirurgico fuera de sucursal');
      }

      const resolvedMedicalRecordId = await resolveMedicalRecordId(db, {
        patientId,
        branchId: req.user.branchId,
        medicalRecordId: medicalRecordId || null,
      });

      // Verificar que el paciente no tenga ya una cirugía activa/programada el mismo día
      if (scheduledDate) {
        const clash = await db.queryOne(
          `SELECT id FROM surgeries
            WHERE branch_id = :bid
              AND patient_id = :pid
              AND DATE(scheduled_date) = DATE(:date)
              AND status NOT IN ('cancelled', 'completed')
            LIMIT 1`,
          { bid: req.user.branchId, pid: patientId, date: scheduledDate }
        );
        if (clash) return R.conflict(res, 'El paciente ya tiene una cirugía programada para ese día');
      }

      const [r] = await db.query(
        `INSERT INTO surgeries
           (branch_id, patient_id, medical_record_id, surgery_type_id,
            lead_surgeon_id, assistant_surgeon_id, anesthesiologist_id, surgical_nurse_id,
            scheduled_date, start_time, urgency,
            preoperative_diagnosis, surgical_approach, notes, status)
         VALUES (:bid,:pid,:mid,:type,:lead,:asst,:anes,:nurse,
                 :date,:time,:urg,:prediag,:approach,:notes,'scheduled')`,
        {
          bid: req.user.branchId, pid: patientId, mid: resolvedMedicalRecordId,
          type: surgeryTypeId, lead: leadSurgeonId,
          asst: assistantSurgeonId || null, anes: anesthesiologistId || null,
          nurse: surgicalNurseId || null, date: scheduledDate,
          time: startTime || null, urg: urgency,
          prediag: preoperativeDiagnosis || null, approach: surgicalApproach || null,
          notes: notes || null,
        }
      );
      return R.created(res, { id: r.insertId });
    } catch (e) {
      if (e.httpStatus === 403) return R.forbidden(res, e.message);
      logSurgeryError('POST /surgeries', e, { branchId: req.user?.branchId, body: req.body });
      next(e);
    }
  }
);

const VALID_SURGERY_TRANSITIONS = {
  scheduled:   ['in_progress', 'postponed', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  postponed:   ['scheduled', 'cancelled'],
  completed:   [],
  cancelled:   [],
};

router.patch('/:id/status',
  body('status').isIn(['scheduled','in_progress','completed','cancelled','postponed']),
  body('postoperativeDiagnosis').optional().isString().trim().isLength({ max: 1000 }),
  body('complications').optional().isString().trim().isLength({ max: 2000 }),
  body('surgicalFindings').optional().isString().trim().isLength({ max: 2000 }),
  validate,
  async (req, res, next) => {
    try {
      await db.transaction(async (conn) => {
        const surgery = await conn.queryOne(
          `SELECT id, status FROM surgeries WHERE id = :id AND branch_id = :bid FOR UPDATE`,
          { id: req.params.id, bid: req.user.branchId }
        );
        if (!surgery) {
          const err = new Error('Surgery not found');
          err.httpStatus = 404;
          throw err;
        }
        const allowed = VALID_SURGERY_TRANSITIONS[surgery.status] || [];
        if (!allowed.includes(req.body.status)) {
          const err = new Error(`Cannot transition surgery from '${surgery.status}' to '${req.body.status}'`);
          err.httpStatus = 409;
          throw err;
        }
        const extra = {};
        if (req.body.status === 'in_progress') extra.start_time = req.body.startTime || null;
        if (req.body.status === 'completed') {
          extra.end_time = req.body.endTime || null;
          if (req.body.startTime && req.body.endTime) {
            const dur = Math.round((new Date(req.body.endTime) - new Date(req.body.startTime)) / 60000);
            if (dur < 0) {
              const err = new Error('End time must be after start time');
              err.httpStatus = 400;
              throw err;
            }
            extra.duration_minutes = dur;
          }
          if (req.body.postoperativeDiagnosis) extra.postoperative_diagnosis = req.body.postoperativeDiagnosis;
          if (req.body.complications) extra.complications = req.body.complications;
          if (req.body.surgicalFindings) extra.surgical_findings = req.body.surgicalFindings;
        }

        const setClauses = [`status = :status`];
        const p = { status: req.body.status, id: req.params.id, bid: req.user.branchId };
        for (const [k, v] of Object.entries(extra)) { setClauses.push(`${k} = :${k}`); p[k] = v; }

        await conn.query(
          `UPDATE surgeries SET ${setClauses.join(', ')}, updated_at=NOW() WHERE id=:id AND branch_id=:bid`,
          p
        );
      });
      return R.noContent(res);
    } catch (e) {
      if (e.httpStatus === 404) return R.notFound(res, e.message);
      if (e.httpStatus === 409) return R.conflict(res, e.message);
      if (e.httpStatus === 400) return R.badRequest(res, e.message);
      logSurgeryError('PATCH /surgeries/:id/status', e, { surgeryId: req.params.id, branchId: req.user?.branchId, body: req.body });
      next(e);
    }
  }
);

router.post('/:id/anesthesia',
  body('anesthesiaType').isIn(['general','local','regional','epidural','sedation','loco_regional']),
  body('anesthesiologistId')
    .if(body('anesthesiaType').equals('general'))
    .notEmpty().withMessage('Se requiere un anestesiólogo para anestesia general')
    .isInt({ min: 1 }),
  body('anesthesiologistId')
    .if(body('anesthesiaType').not().equals('general'))
    .optional().isInt({ min: 1 }),
  validate,
  async (req, res, next) => {
    try {
      const {
        anesthesiologistId, anesthesiaType,
        inductionAgents, maintenanceAgents, analgesics, reversalAgents,
        premedications, inductionTime, extubationTime,
        totalAnesthesiaMinutes, complications,
        monitoringChart,
        recoveryNotes,
        anestheticAgents, recoveryTime, totalDurationMinutes,
        complicationNotes, monitoringNotes,
      } = req.body;
      const surgery = await db.queryOne(
        `SELECT id FROM surgeries WHERE id = :id AND branch_id = :bid`,
        { id: req.params.id, bid: req.user.branchId }
      );
      if (!surgery) return R.notFound(res, 'Surgery not found');
      if (anesthesiologistId) {
        const user = await db.queryOne(
          `SELECT id FROM users WHERE id = :id AND branch_id = :bid`,
          { id: anesthesiologistId, bid: req.user.branchId }
        );
        if (!user) return R.forbidden(res, 'Anestesiologo fuera de sucursal');
      }

      const [r] = await db.query(
        `INSERT INTO anesthesia_records
           (surgery_id, anesthesiologist_id, anesthesia_type,
            induction_agents, maintenance_agents, analgesics, reversal_agents,
            premedications, induction_time, extubation_time,
            total_anesthesia_minutes, complications,
            monitoring_chart, recovery_notes)
         VALUES (:sid,:uid,:type,:ind,:main,:anal,:rev,:pre,:indt,:extt,:total,:comp,:chart,:rec)`,
        {
          sid: req.params.id, uid: anesthesiologistId || req.user.userId, type: anesthesiaType,
          ind: inductionAgents || anestheticAgents || null, main: maintenanceAgents || null,
          anal: analgesics || null, rev: reversalAgents || null,
          pre: premedications || null, indt: inductionTime || null,
          extt: extubationTime || recoveryTime || null, total: totalAnesthesiaMinutes || totalDurationMinutes || null,
          comp: complications ? 1 : 0,
          chart: monitoringChart ? JSON.stringify(monitoringChart) : null,
          rec: recoveryNotes || monitoringNotes || complicationNotes || null,
        }
      );
      return R.created(res, { id: r.insertId });
    } catch (e) {
      logSurgeryError('POST /surgeries/:id/anesthesia', e, { surgeryId: req.params.id, branchId: req.user?.branchId, body: req.body });
      next(e);
    }
  }
);

module.exports = { router };
