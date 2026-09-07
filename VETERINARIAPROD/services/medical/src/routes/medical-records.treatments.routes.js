'use strict';

const {
  Router,
  body,
  db,
  R,
  validate,
  logMedicalError,
  encrypt,
  ensureMedicalRecordInScope,
} = require('./medical-records.sections.common');

const VALID_TREATMENT_TYPES = ['medication', 'surgery', 'procedure', 'therapy', 'diet', 'other'];

const router = Router();

router.post('/:id/treatments',
  body('treatmentType').optional().isIn(VALID_TREATMENT_TYPES),
  body('description').optional({ nullable: true }).isString().isLength({ max: 2000 }),
  body('dose').optional({ nullable: true }).isString().isLength({ max: 100 }),
  body('doseUnit').optional({ nullable: true }).isString().isLength({ max: 50 }),
  body('frequency').optional({ nullable: true }).isString().isLength({ max: 200 }),
  body('route').optional({ nullable: true }).isString().isLength({ max: 100 }),
  body('durationDays').optional({ nullable: true }).isInt({ min: 1, max: 3650 }),
  body('notes').optional({ nullable: true }).isString().isLength({ max: 4000 }),
  validate,
  async (req, res, next) => {
  try {
    const scopedRecord = await ensureMedicalRecordInScope(req, req.params.id);
    if (!scopedRecord) return R.notFound(res, 'Historia clinica no encontrada');

    const {
      medicationId, treatmentType = 'medication',
      description, dose, doseUnit, frequency,
      route, durationDays, startDate, notes,
    } = req.body;

    const [r] = await db.query(
      `INSERT INTO treatments
         (medical_record_id, medication_id, treatment_type,
          description, dose, dose_unit, frequency, route, duration_days, start_date, notes,
          prescribed_by)
       VALUES (:mid, :medId, :type, :desc, :dose, :unit, :freq, :route, :dur, :start, :notes, :user)`,
      {
        mid: req.params.id,
        medId: medicationId || null,
        type: treatmentType,
        desc: encrypt(description || null),
        dose: dose || null,
        unit: doseUnit || null,
        freq: frequency || null,
        route: route || null,
        dur: durationDays || null,
        start: startDate || null,
        notes: encrypt(notes || null),
        user: req.user.userId,
      }
    );
    return R.created(res, { id: r.insertId });
  } catch (e) {
    logMedicalError('records.POST /medical-records/:id/treatments', e, { recordId: req.params.id, body: req.body });
    next(e);
  }
});

module.exports = { router };
