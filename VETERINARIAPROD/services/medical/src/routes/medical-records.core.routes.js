'use strict';

const { Router } = require('express');
const { body, db, R, validate, logMedicalError } = require('./medical.common');
const {
  encrypt,
  decrypt,
  decryptFields,
  decryptRows,
  MEDICAL_RECORD_FIELDS,
  ANAMNESIS_FIELDS,
  PHYSICAL_EXAM_FIELDS,
  DIAGNOSIS_FIELDS,
  TREATMENT_FIELDS,
  PRESCRIPTION_FIELDS,
} = require('../../../../shared/encryption');

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const { patientId, status, page = 1 } = req.query;
    const limit = Math.min(parseInt(req.query.limit || 20, 10) || 20, 100);
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const offset = (pageNum - 1) * limit;
    const conditions = ['a.branch_id = :bid', 'p.organization_id = :orgId'];
    const params = { bid: req.user.branchId, orgId: req.user.orgId, limit, offset };

    if (patientId) { conditions.push('mr.patient_id = :pid'); params.pid = patientId; }
    if (status) { conditions.push('mr.status = :status'); params.status = status; }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const rows = await db.query(
      `SELECT mr.id, mr.patient_id, mr.status, mr.opened_at, mr.signed_at,
              mr.chief_complaint, mr.weight_kg,
              p.name AS patient_name, sp.common_name AS species,
              CONCAT(u.first_name,' ',u.last_name) AS vet_name,
              DATE(a.scheduled_date) AS visit_date
       FROM medical_records mr
       JOIN appointments a ON mr.appointment_id = a.id
       JOIN patients p     ON mr.patient_id = p.id
       JOIN species sp     ON p.species_id  = sp.id
       JOIN users u        ON mr.vet_id     = u.id
       ${where}
       ORDER BY mr.opened_at DESC
       LIMIT :limit OFFSET :offset`,
      params
    );
    return R.ok(res, decryptRows(rows, ['chief_complaint']));
  } catch (e) {
    logMedicalError('records.GET /medical-records', e, { orgId: req.user?.orgId, branchId: req.user?.branchId, query: req.query });
    next(e);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const mr = await db.queryOne(
      `SELECT mr.*,
              mr.chief_complaint AS reason_for_visit,
              mr.opened_at AS visit_date,
              p.name AS patient_name, sp.common_name AS species,
              CONCAT(u.first_name,' ',u.last_name) AS vet_name
       FROM medical_records mr
       JOIN patients p   ON mr.patient_id = p.id
       JOIN species sp   ON p.species_id  = sp.id
       JOIN users   u    ON mr.vet_id     = u.id
       LEFT JOIN appointments a ON a.id = mr.appointment_id
       WHERE mr.id = :id
         AND p.organization_id = :orgId
         AND (:branchId IS NULL OR a.branch_id = :branchId)`,
      { id: req.params.id, orgId: req.user.orgId, branchId: req.user.branchId || null }
    );
    if (!mr) return R.notFound(res);

    const [anamnesis, physExam, diagnoses, treatments, prescriptions] = await Promise.all([
      db.queryOne(`SELECT * FROM anamnesis WHERE medical_record_id = :mid`, { mid: req.params.id }),
      db.queryOne(`SELECT * FROM physical_examinations WHERE medical_record_id = :mid`, { mid: req.params.id }),
      // T-5: límites configurables vía env — paso previo a paginación cursor-based por sección
      db.query(`SELECT * FROM diagnoses WHERE medical_record_id = :mid ORDER BY is_primary DESC, created_at LIMIT ${parseInt(process.env.MEDICAL_SECTION_LIMIT || '200', 10)}`, { mid: req.params.id }),
      db.query(
        `SELECT t.*, m.name AS medication_name, m.unit, m.concentration
         FROM treatments t
         LEFT JOIN medications m ON t.medication_id = m.id
         WHERE t.medical_record_id = :mid ORDER BY t.created_at LIMIT ${parseInt(process.env.MEDICAL_SECTION_LIMIT || '200', 10)}`,
        { mid: req.params.id }
      ),
      db.query(
        `SELECT p.*, pi.medication_name, pi.dose, pi.frequency, pi.duration_days
         FROM prescriptions p
         LEFT JOIN prescription_items pi ON pi.prescription_id = p.id
         WHERE p.medical_record_id = :mid LIMIT ${parseInt(process.env.MEDICAL_PRESCRIPTION_LIMIT || '100', 10)}`,
        { mid: req.params.id }
      ),
    ]);

    return R.ok(res, {
      ...mr,
      chief_complaint: mr.chief_complaint ? decrypt(mr.chief_complaint) : null,
      reason_for_visit: mr.reason_for_visit ? decrypt(mr.reason_for_visit) : null,
      notes: mr.notes ? decrypt(mr.notes) : null,
      anamnesis: decryptFields(anamnesis, ANAMNESIS_FIELDS),
      physicalExam: decryptFields(physExam, PHYSICAL_EXAM_FIELDS),
      diagnoses: decryptRows(diagnoses, DIAGNOSIS_FIELDS),
      treatments: decryptRows(treatments, TREATMENT_FIELDS),
      prescriptions: decryptRows(prescriptions, PRESCRIPTION_FIELDS),
    });
  } catch (e) {
    logMedicalError('records.GET /medical-records/:id', e, { recordId: req.params.id, orgId: req.user?.orgId });
    next(e);
  }
});

router.post('/',
  body('chiefComplaint').notEmpty().withMessage('El motivo de consulta es requerido').isString().isLength({ max: 4000 }),
  body('notes').optional({ nullable: true }).isString().isLength({ max: 4000 }),
  body('weightKg').optional({ nullable: true }).isFloat({ min: 0, max: 1000 }),
  body('bodyConditionScore').optional({ nullable: true }).isFloat({ min: 1, max: 9 }),
  body('temperatureC').optional({ nullable: true }).isFloat({ min: 30, max: 45 }),
  validate,
  async (req, res, next) => {
    try {
      let { appointmentId, patientId, chiefComplaint, weightKg, bodyConditionScore, temperatureC } = req.body;

      if (!appointmentId && !patientId) {
        return R.badRequest(res, 'Se requiere appointmentId o patientId');
      }

      if (!appointmentId) {
        const canAutoCreateAppt = req.user.roles?.some((role) => ['vet', 'veterinarian', 'tele_vet'].includes(role));
        if (!canAutoCreateAppt) {
          return R.badRequest(res, 'Se requiere appointmentId para usuarios sin rol de veterinario');
        }

        const vetId = req.body.vetId || req.user.userId;

        let branchId = req.user.branchId || null;
        const vet = await db.queryOne(
          `SELECT u.id, u.branch_id
           FROM users u
           JOIN branches b ON b.id = u.branch_id
           WHERE u.id = :vetId
             AND u.is_active = TRUE
             AND b.organization_id = :orgId
             AND (:branchId IS NULL OR u.branch_id = :branchId)`,
          { vetId, orgId: req.user.orgId, branchId }
        );
        if (!vet) return R.notFound(res, 'Veterinario no encontrado');
        branchId = branchId || vet.branch_id;

        const patient = await db.queryOne(
          `SELECT id FROM patients WHERE id = :pid AND organization_id = :orgId`,
          { pid: patientId, orgId: req.user.orgId }
        );
        if (!patient) return R.notFound(res, 'Paciente no encontrado');

        const [apptResult] = await db.query(
          `INSERT INTO appointments
             (branch_id, patient_id, vet_id, scheduled_date, duration_minutes,
              status, reason, notes, is_emergency)
           VALUES (:bid, :pid, :vid, NOW(), 30,
                   'in_progress', :reason, NULL, 0)`,
          {
            bid: branchId,
            pid: patientId,
            vid: vetId,
            reason: encrypt(chiefComplaint),
          }
        );
        appointmentId = apptResult.insertId;
      } else {
        const appt = await db.queryOne(
          `SELECT a.patient_id
           FROM appointments a
           JOIN patients p ON a.patient_id = p.id
           WHERE a.id = :id AND a.branch_id = :bid AND p.organization_id = :orgId`,
          { id: appointmentId, bid: req.user.branchId, orgId: req.user.orgId }
        );
        if (!appt) return R.notFound(res, 'Cita no encontrada');
        patientId = appt.patient_id;
      }

      const { notes } = req.body;
      const [r] = await db.query(
        `INSERT INTO medical_records
           (appointment_id, patient_id, vet_id, status,
            chief_complaint, weight_kg, body_condition_score,
            temperature_celsius, notes, opened_at)
         VALUES (:apptId, :pid, :uid, 'open',
                 :cc, :wt, :bcs, :temp, :notes, NOW())`,
        {
          apptId: appointmentId,
          pid: patientId,
          uid: req.user.userId,
          cc: encrypt(chiefComplaint),
          wt: weightKg || null,
          bcs: bodyConditionScore || null,
          temp: temperatureC || null,
          notes: encrypt(notes || null),
        }
      );

      return R.created(res, { id: r.insertId, appointmentId, patientId });
    } catch (e) {
      logMedicalError('records.POST /medical-records', e, { orgId: req.user?.orgId, branchId: req.user?.branchId, body: req.body });
      next(e);
    }
  }
);

module.exports = { router };
