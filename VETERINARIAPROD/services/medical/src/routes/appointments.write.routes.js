'use strict';

const { Router } = require('express');
const { body, db, R, validate, logAppointmentsError } = require('./appointments.common');

const router = Router();

function httpError(status, message, code) {
  return Object.assign(new Error(message), { httpStatus: status, code });
}

router.post('/',
  body('patientId').isInt(),
  body('vetId').isInt(),
  body('scheduledDate').isISO8601(),
  body('durationMinutes').optional().isInt({ min: 5, max: 480 }),
  body('reason').optional().isString().trim().isLength({ max: 500 }),
  body('notes').optional().isString().trim().isLength({ max: 4000 }),
  validate,
  async (req, res, next) => {
    try {
      const {
        patientId, vetId, scheduledDate, durationMinutes = 30,
        appointmentTypeId, reason, notes, isEmergency = false,
      } = req.body;

      const appointmentId = await db.transaction(async (conn) => {
        const entities = await conn.queryOne(
          `SELECT p.id AS patient_id, p.organization_id AS patient_org_id,
                  u.id AS vet_id, u.branch_id AS vet_branch_id
           FROM patients p
           JOIN users u ON u.id = :vid AND u.is_active = TRUE
           JOIN branches vb ON vb.id = u.branch_id
           WHERE p.id = :pid
             AND p.organization_id = :orgId
             AND vb.organization_id = :orgId
           FOR UPDATE`,
          { pid: patientId, vid: vetId, orgId: req.user.orgId }
        );
        if (!entities) {
          throw httpError(404, 'Paciente o veterinario no encontrado en la organización', 'APPOINTMENT_SCOPE_INVALID');
        }

        const branchId = req.user.branchId || entities.vet_branch_id;
        if (!branchId || String(entities.vet_branch_id) !== String(branchId)) {
          throw httpError(403, 'El veterinario no pertenece a la sucursal seleccionada', 'APPOINTMENT_BRANCH_MISMATCH');
        }

        if (appointmentTypeId) {
          const type = await conn.queryOne(
            `SELECT id
             FROM appointment_types
             WHERE id = :typeId
               AND COALESCE(is_active, TRUE) = TRUE
               AND (organization_id IS NULL OR organization_id = :orgId)
               AND (branch_id IS NULL OR branch_id = :branchId)
             FOR UPDATE`,
            { typeId: appointmentTypeId, orgId: req.user.orgId, branchId }
          );
          if (!type) throw httpError(400, 'Tipo de turno inválido para la sucursal', 'APPOINTMENT_TYPE_INVALID');
        }

        const vetConflict = await conn.queryOne(
          `SELECT id
           FROM appointments
           WHERE branch_id = :branchId
             AND status NOT IN ('cancelled', 'no_show')
             AND vet_id = :vetId
             AND scheduled_date < DATE_ADD(:scheduledDate, INTERVAL :durationMinutes MINUTE)
             AND DATE_ADD(scheduled_date, INTERVAL COALESCE(duration_minutes, 30) MINUTE) > :scheduledDate
           LIMIT 1
           FOR UPDATE`,
          { branchId, vetId, scheduledDate, durationMinutes }
        );
        if (vetConflict) {
          throw httpError(409, 'El veterinario ya tiene un turno en ese horario', 'APPOINTMENT_CONFLICT');
        }

        const patientConflict = await conn.queryOne(
          `SELECT id
           FROM appointments
           WHERE branch_id = :branchId
             AND status NOT IN ('cancelled', 'no_show')
             AND patient_id = :patientId
             AND scheduled_date < DATE_ADD(:scheduledDate, INTERVAL :durationMinutes MINUTE)
             AND DATE_ADD(scheduled_date, INTERVAL COALESCE(duration_minutes, 30) MINUTE) > :scheduledDate
           LIMIT 1
           FOR UPDATE`,
          { branchId, patientId, scheduledDate, durationMinutes }
        );
        if (patientConflict) {
          throw httpError(409, 'El paciente ya tiene un turno en ese horario', 'APPOINTMENT_CONFLICT');
        }

        const [r] = await conn.query(
          `INSERT INTO appointments
             (branch_id, patient_id, vet_id, scheduled_date, duration_minutes,
              appointment_type_id, reason, notes, is_emergency, status)
           VALUES (:bid, :pid, :vid, :date, :dur, :typeId, :reason, :notes, :emerg, 'scheduled')`,
          {
            bid: branchId,
            pid: patientId,
            vid: vetId,
            date: scheduledDate,
            dur: durationMinutes,
            typeId: appointmentTypeId || null,
            reason: reason || null,
            notes: notes || null,
            emerg: isEmergency ? 1 : 0,
          }
        );
        return r.insertId;
      });
      return R.created(res, { id: appointmentId });
    } catch (e) {
      logAppointmentsError('POST /appointments', e, { orgId: req.user?.orgId, branchId: req.user?.branchId, body: req.body });
      next(e);
    }
  }
);

router.patch('/:id/status',
  body('status').isIn(['scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show']),
  validate,
  async (req, res, next) => {
    try {
      const [result] = await db.query(
        `UPDATE appointments SET status = :status, updated_at = NOW()
         WHERE id = :id AND branch_id = :bid`,
        { status: req.body.status, id: req.params.id, bid: req.user.branchId }
      );
      if (!result?.affectedRows) return R.notFound(res, 'Turno no encontrado');
      return R.noContent(res);
    } catch (e) {
      logAppointmentsError('PATCH /appointments/:id/status', e, { appointmentId: req.params.id, branchId: req.user?.branchId, body: req.body });
      next(e);
    }
  }
);

const postTriage = [
  body('priority').isIn(['immediate', 'urgent', 'less_urgent', 'non_urgent']),
  body('chiefComplaint').isString().trim().notEmpty(),
  body('notes').optional().isString().trim().isLength({ max: 4000 }),
  validate,
  async (req, res, next) => {
    try {
      const {
        priority, chiefComplaint,
        heartRate, respiratoryRate, temperature,
        systolicBp, mucousMembranes,
        consciousnessLevel, painScore, notes,
      } = req.body;

      const triageId = await db.transaction(async (conn) => {
        const appointment = await conn.queryOne(
          `SELECT a.id
           FROM appointments a
           JOIN patients p ON p.id = a.patient_id
           WHERE a.id = :appointmentId
             AND a.branch_id = :branchId
             AND p.organization_id = :orgId
           FOR UPDATE`,
          {
            appointmentId: req.params.id,
            branchId: req.user.branchId,
            orgId: req.user.orgId,
          }
        );
        if (!appointment) throw httpError(404, 'Turno no encontrado', 'APPOINTMENT_NOT_FOUND');

        const [r] = await conn.query(
          `INSERT INTO emergency_triage
             (appointment_id, priority, chief_complaint,
              heart_rate, respiratory_rate, temperature_celsius,
              systolic_bp, mucous_membranes,
              consciousness_level, pain_score, notes,
              triaged_by)
           VALUES (:apptId, :priority, :cc, :hr, :rr, :temp,
                   :sbp, :mm, :cl, :pain, :notes, :user)`,
          {
            apptId: req.params.id,
            priority,
            cc: chiefComplaint,
            hr: heartRate || null,
            rr: respiratoryRate || null,
            temp: temperature || null,
            sbp: systolicBp || null,
            mm: mucousMembranes || null,
            cl: consciousnessLevel || null,
            pain: painScore || null,
            notes: notes || null,
            user: req.user.userId,
          }
        );
        return r.insertId;
      });
      return R.created(res, { id: triageId });
    } catch (e) {
      logAppointmentsError('POST /appointments/:id/triage', e, { appointmentId: req.params.id, userId: req.user?.userId, body: req.body });
      next(e);
    }
  },
];

router.post('/:id/triage', ...postTriage);

module.exports = {
  router,
  postTriage,
};
