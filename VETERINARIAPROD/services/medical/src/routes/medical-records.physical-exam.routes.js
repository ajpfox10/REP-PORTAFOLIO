'use strict';

const {
  Router,
  body,
  db,
  R,
  validate,
  logMedicalError,
  encryptFields,
  ensureMedicalRecordInScope,
} = require('./medical-records.sections.common');

// Longitud máxima para campos de texto libre del examen físico
const PE_TEXT_MAX = 1000;

const router = Router();

router.post('/:id/physical-exam',
  body('temperatureCelsius').optional({ nullable: true }).isFloat({ min: 30, max: 45 }),
  body('heartRate').optional({ nullable: true }).isInt({ min: 0, max: 400 }),
  body('respiratoryRate').optional({ nullable: true }).isInt({ min: 0, max: 200 }),
  body('weightKg').optional({ nullable: true }).isFloat({ min: 0, max: 1000 }),
  body('bodyConditionScore').optional({ nullable: true }).isFloat({ min: 1, max: 9 }),
  body('mucousMembranes').optional({ nullable: true }).isString().isLength({ max: PE_TEXT_MAX }),
  body('hydrationStatus').optional({ nullable: true }).isString().isLength({ max: PE_TEXT_MAX }),
  body('lymphNodes').optional({ nullable: true }).isString().isLength({ max: PE_TEXT_MAX }),
  body('skinCoat').optional({ nullable: true }).isString().isLength({ max: PE_TEXT_MAX }),
  body('eyes').optional({ nullable: true }).isString().isLength({ max: PE_TEXT_MAX }),
  body('ears').optional({ nullable: true }).isString().isLength({ max: PE_TEXT_MAX }),
  body('noseThroat').optional({ nullable: true }).isString().isLength({ max: PE_TEXT_MAX }),
  body('oralCavity').optional({ nullable: true }).isString().isLength({ max: PE_TEXT_MAX }),
  body('cardiovascular').optional({ nullable: true }).isString().isLength({ max: PE_TEXT_MAX }),
  body('respiratory').optional({ nullable: true }).isString().isLength({ max: PE_TEXT_MAX }),
  body('abdomen').optional({ nullable: true }).isString().isLength({ max: PE_TEXT_MAX }),
  body('musculoskeletal').optional({ nullable: true }).isString().isLength({ max: PE_TEXT_MAX }),
  body('neurological').optional({ nullable: true }).isString().isLength({ max: PE_TEXT_MAX }),
  body('urogenital').optional({ nullable: true }).isString().isLength({ max: PE_TEXT_MAX }),
  body('painAssessment').optional({ nullable: true }).isString().isLength({ max: PE_TEXT_MAX }),
  body('generalObservations').optional({ nullable: true }).isString().isLength({ max: 4000 }),
  validate,
  async (req, res, next) => {
  try {
    const scopedRecord = await ensureMedicalRecordInScope(req, req.params.id);
    if (!scopedRecord) return R.notFound(res, 'Historia clinica no encontrada');

    const fields = req.body;
    const encryptedTextFields = encryptFields(fields, [
      'mucousMembranes',
      'hydrationStatus',
      'lymphNodes',
      'skinCoat',
      'eyes',
      'ears',
      'noseThroat',
      'oralCavity',
      'cardiovascular',
      'respiratory',
      'abdomen',
      'musculoskeletal',
      'neurological',
      'urogenital',
      'painAssessment',
      'generalObservations',
    ]);

    const ALLOWED_PE_COLS = new Set([
      'mucous_membranes', 'hydration_status', 'lymph_nodes', 'skin_coat', 'eyes', 'ears',
      'nose_throat', 'oral_cavity', 'cardiovascular', 'respiratory', 'abdomen',
      'musculoskeletal', 'neurological', 'urogenital', 'pain_assessment', 'general_observations',
      'temperature_celsius', 'heart_rate', 'respiratory_rate', 'weight_kg', 'body_condition_score',
    ]);
    const cols = Object.entries(encryptedTextFields).map(([k, v]) => {
      const col = k.replace(/([A-Z])/g, '_$1').toLowerCase();
      return { col, v };
    }).filter(({ col }) => ALLOWED_PE_COLS.has(col));

    const colNames = cols.map((c) => c.col).join(', ');
    const vals = cols.map(() => '?').join(', ');
    const values = cols.map((c) => c.v);
    if (!cols.length) return R.badRequest(res, 'Sin campos validos para actualizar');

    await db.query(
      `INSERT INTO physical_examinations (medical_record_id, ${colNames})
       VALUES (?, ${vals})
       ON DUPLICATE KEY UPDATE ${cols.map((c) => `${c.col} = VALUES(${c.col})`).join(', ')}`,
      [req.params.id, ...values]
    );
    return R.created(res);
  } catch (e) {
    logMedicalError('records.POST /medical-records/:id/physical-exam', e, { recordId: req.params.id, body: req.body });
    next(e);
  }
});

module.exports = { router };
