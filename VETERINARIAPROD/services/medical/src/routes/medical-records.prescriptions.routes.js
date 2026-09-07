'use strict';

const { Router } = require('express');
const { body, db, R, validate, logMedicalError } = require('./medical.common');
const { ensureMedicalRecordInScope } = require('./medical-records.sections.common');
const { encrypt, decryptRows, PRESCRIPTION_FIELDS } = require('../../../../shared/encryption');

const router = Router();

let prescriptionSchemaPromise;
async function getPrescriptionSchema() {
  if (!prescriptionSchemaPromise) {
    prescriptionSchemaPromise = db.query(
      `SELECT TABLE_NAME, COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME IN ('prescriptions', 'prescription_items')`
    ).then((rows) => {
      const schema = {};
      for (const row of rows) {
        if (!schema[row.TABLE_NAME]) schema[row.TABLE_NAME] = new Set();
        schema[row.TABLE_NAME].add(row.COLUMN_NAME);
      }
      return schema;
    });
  }
  return prescriptionSchemaPromise;
}

const getPrescriptions = [async (req, res, next) => {
  try {
    // SEC: verificar que la ficha pertenezca a la org/sucursal del usuario antes de
    // exponer prescripciones (PHI). Sin esto era posible leer recetas de otra org por id.
    const scopedRecord = await ensureMedicalRecordInScope(req, req.params.id);
    if (!scopedRecord) return R.notFound(res, 'Historia clinica no encontrada');

    const rows = await db.query(
      `SELECT p.*, pi.medication_name, pi.dose, pi.frequency, pi.duration_days, pi.quantity, pi.instructions
       FROM prescriptions p
       LEFT JOIN prescription_items pi ON pi.prescription_id = p.id
       WHERE p.medical_record_id = :mid`,
      { mid: req.params.id }
    );
    return R.ok(res, decryptRows(rows, PRESCRIPTION_FIELDS));
  } catch (e) {
    logMedicalError('records.GET /medical-records/:id/prescriptions', e, { recordId: req.params.id });
    next(e);
  }
}];

const postPrescriptions = [
  body('items').isArray({ min: 1 }),
  validate,
  async (req, res, next) => {
    try {
      // Roles habilitados para prescribir. Incluye 'veterinarian' (rol real) además de
      // 'vet' (legacy); el check anterior solo aceptaba 'vet'/'admin', bloqueando a los
      // veterinarios reales -> 403 al guardar una evolución con receta.
      const VET_RX_ROLES = ['veterinarian', 'vet', 'tele_vet', 'surgeon', 'org_admin', 'superadmin'];
      const userRoles = req.user.roles || [];
      if (!userRoles.some((role) => VET_RX_ROLES.includes(role))) {
        return R.forbidden(res, 'Solo veterinarios pueden crear prescripciones');
      }

      // SEC: la ficha debe pertenecer a la org/sucursal del usuario (evita crear
      // recetas sobre historias de otro tenant via medical_record_id arbitrario).
      const scopedRecord = await ensureMedicalRecordInScope(req, req.params.id);
      if (!scopedRecord) return R.notFound(res, 'Historia clinica no encontrada');

      const { items, notes, refills = 0 } = req.body;
      const schema = await getPrescriptionSchema();
      const prescriptionCols = schema.prescriptions || new Set();
      const itemCols = schema.prescription_items || new Set();

      const prescriptionColumns = ['medical_record_id', 'prescribed_by', 'notes', 'refills_allowed', 'status'];
      const prescriptionValues = [':mid', ':uid', ':notes', ':refills', `'active'`];
      const prescriptionParams = {
        mid: req.params.id,
        uid: req.user.userId,
        notes: encrypt(notes || null),
        refills,
        orgId: req.user.orgId,
        branchId: req.user.branchId,
      };
      if (prescriptionCols.has('organization_id')) {
        prescriptionColumns.push('organization_id');
        prescriptionValues.push(':orgId');
      }
      if (prescriptionCols.has('branch_id')) {
        prescriptionColumns.push('branch_id');
        prescriptionValues.push(':branchId');
      }
      if (prescriptionCols.has('refills_used')) {
        prescriptionColumns.push('refills_used');
        prescriptionValues.push('0');
      }
      if (prescriptionCols.has('valid_until')) {
        prescriptionColumns.push('valid_until');
        prescriptionValues.push('NULL');
      }
      if (prescriptionCols.has('created_at')) {
        prescriptionColumns.push('created_at');
        prescriptionValues.push('NOW()');
      }
      if (prescriptionCols.has('updated_at')) {
        prescriptionColumns.push('updated_at');
        prescriptionValues.push('NOW()');
      }

      const [r] = await db.query(
        `INSERT INTO prescriptions
           (${prescriptionColumns.join(', ')})
         VALUES (${prescriptionValues.join(', ')})`,
        prescriptionParams
      );
      const prescId = r.insertId;

      const itemColumns = [
        'prescription_id',
        'medication_id',
        'medication_name',
        'dose',
        'dose_unit',
        'frequency',
        'route',
        'duration_days',
        'quantity',
        'instructions',
      ];
      if (itemCols.has('organization_id')) itemColumns.push('organization_id');
      if (itemCols.has('branch_id')) itemColumns.push('branch_id');
      if (itemCols.has('created_at')) itemColumns.push('created_at');
      if (itemCols.has('updated_at')) itemColumns.push('updated_at');

      const itemRows = items.map((item) => {
        const row = [
          prescId,
          item.medicationId || null,
          encrypt(item.medicationName),
          item.dose,
          item.doseUnit || null,
          item.frequency,
          item.route || null,
          item.durationDays || null,
          item.quantity || null,
          encrypt(item.instructions || null),
        ];
        if (itemCols.has('organization_id')) row.push(req.user.orgId);
        if (itemCols.has('branch_id')) row.push(req.user.branchId);
        if (itemCols.has('created_at')) row.push(new Date());
        if (itemCols.has('updated_at')) row.push(new Date());
        return row;
      });
      const itemPlaceholders = itemRows.map(() => `(${itemColumns.map(() => '?').join(',')})`).join(', ');
      await db.query(
        `INSERT INTO prescription_items
           (${itemColumns.join(', ')})
         VALUES ${itemPlaceholders}`,
        itemRows.flat()
      );
      return R.created(res, { id: prescId });
    } catch (e) {
      logMedicalError('records.POST /medical-records/:id/prescriptions', e, { recordId: req.params.id, body: req.body });
      next(e);
    }
  },
];

router.get('/:id/prescriptions', ...getPrescriptions);
router.post('/:id/prescriptions', ...postPrescriptions);

module.exports = {
  router,
  getPrescriptions,
  postPrescriptions,
};
