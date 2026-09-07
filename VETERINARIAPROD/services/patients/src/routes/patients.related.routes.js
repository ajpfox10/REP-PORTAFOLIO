'use strict';

const { Router } = require('express');
const {
  body,
  db,
  R,
  ALLOWED_MIME_SIGNATURES,
  upload,
  validate,
  deletedPredicate,
  sanitizeFilename,
  getPatientSchema,
  ensurePatientVisible,
} = require('./patients.common');

const router = Router();

router.post('/:id/photo', upload.single('photo'), async (req, res, next) => {
  try {
    if (!req.file) return R.badRequest(res, 'No file uploaded or invalid file type');

    const buf = req.file.buffer;
    const mimeOk = Object.values(ALLOWED_MIME_SIGNATURES).some((sigs) =>
      sigs.some((sig) => buf.slice(0, sig.length).equals(sig))
    );
    if (!mimeOk) return R.badRequest(res, 'Invalid file content - upload rejected');

    const visiblePatient = await ensurePatientVisible(req.params.id, req.user);
    if (!visiblePatient) return R.notFound(res, 'Patient not found');

    const safeFilename = sanitizeFilename(req.file.originalname);
    const url = `/uploads/patients/${req.params.id}/${Date.now()}-${safeFilename}`;
    await db.query(
      `UPDATE patients SET photo_url = :url WHERE id = :id`,
      { url, id: req.params.id }
    );
    return R.ok(res, { url });
  } catch (e) { next(e); }
});

router.get('/:id/owners', async (req, res, next) => {
  try {
    const visiblePatient = await ensurePatientVisible(req.params.id, req.user);
    if (!visiblePatient) return R.notFound(res, 'Patient not found');

    const schema = await getPatientSchema();
    const clientCols = schema.clients || new Set();
    const ownerCols = schema.patient_owners || new Set();
    const ownerPhoneExpr = clientCols.has('phone') ? 'cl.phone' : (clientCols.has('phone_primary') ? 'cl.phone_primary' : 'NULL');

    const owners = await db.query(
      `SELECT cl.id, cl.first_name, cl.last_name, cl.email, ${ownerPhoneExpr} AS phone,
              po.ownership_type, po.start_date, po.end_date, po.notes
       FROM patient_owners po
       JOIN clients cl ON cl.id = po.client_id
       WHERE po.patient_id = :patientId
         AND ${deletedPredicate(ownerCols, 'po')}
         AND ${deletedPredicate(clientCols, 'cl')}
         ${ownerCols.has('active') ? 'AND po.active = 1' : ''}
       ORDER BY FIELD(po.ownership_type, 'primary', 'secondary', 'temporary_guardian', 'foster'), cl.last_name, cl.first_name`,
      { patientId: req.params.id }
    );
    return R.ok(res, owners);
  } catch (e) { next(e); }
});

router.post('/:id/owners',
  body('clientId').isInt(),
  body('ownershipType').isIn(['secondary', 'temporary_guardian', 'foster']),
  validate,
  async (req, res, next) => {
    try {
      const visiblePatient = await ensurePatientVisible(req.params.id, req.user);
      if (!visiblePatient) return R.notFound(res, 'Patient not found');

      const schema = await getPatientSchema();
      const clientCols = schema.clients || new Set();
      const ownerCols = schema.patient_owners || new Set();
      const client = await db.queryOne(
        `SELECT id
         FROM clients
         WHERE id = :clientId
           AND branch_id = :branchId
           AND ${deletedPredicate(clientCols, 'clients')}
           ${clientCols.has('organization_id') ? 'AND organization_id = :orgId' : ''}`,
        { clientId: req.body.clientId, branchId: req.user.branchId, orgId: req.user.orgId }
      );
      if (!client) return R.notFound(res, 'Client not found in current organization/branch');

      await db.transaction(async (conn) => {
        const existing = await conn.queryOne(
          `SELECT id
           FROM patient_owners
           WHERE patient_id = :patientId AND client_id = :clientId
           LIMIT 1`,
          { patientId: req.params.id, clientId: req.body.clientId }
        );

        if (existing) {
          const sets = ['ownership_type = :ownershipType', 'start_date = COALESCE(start_date, CURDATE())', 'end_date = NULL'];
          if (ownerCols.has('active')) sets.push('active = 1');
          await conn.query(
            `UPDATE patient_owners
             SET ${sets.join(', ')}
             WHERE id = :id`,
            { id: existing.id, ownershipType: req.body.ownershipType }
          );
          return;
        }

        const columns = ['patient_id', 'client_id', 'ownership_type', 'start_date'];
        const values = [':patientId', ':clientId', ':ownershipType', 'CURDATE()'];
        if (ownerCols.has('active')) {
          columns.push('active');
          values.push('1');
        }
        await conn.query(
          `INSERT INTO patient_owners (${columns.join(', ')})
           VALUES (${values.join(', ')})`,
          { patientId: req.params.id, clientId: req.body.clientId, ownershipType: req.body.ownershipType }
        );
      });

      return R.created(res, { patientId: parseInt(req.params.id, 10), clientId: req.body.clientId });
    } catch (e) { next(e); }
  }
);

router.post('/:id/allergies',
  body('allergen').notEmpty().isString().trim().isLength({ max: 200 }),
  body('severity').isIn(['mild', 'moderate', 'severe']),
  body('reaction').optional().isString().trim().isLength({ max: 500 }),
  body('notes').optional().isString().trim().isLength({ max: 1000 }),
  validate,
  async (req, res, next) => {
    try {
      const visiblePatient = await ensurePatientVisible(req.params.id, req.user);
      if (!visiblePatient) return R.notFound(res, 'Patient not found');
      const { allergen, severity, reaction, notes } = req.body;
      await db.query(
        `INSERT INTO patient_allergies (patient_id, allergen, severity, reaction_description, notes)
         VALUES (:pid, :allergen, :severity, :reaction, :notes)`,
        { pid: req.params.id, allergen, severity, reaction: reaction || null, notes: notes || null }
      );
      return R.created(res);
    } catch (e) { next(e); }
  }
);

router.post('/:id/chronic-conditions',
  body('conditionName').notEmpty().isString().trim().isLength({ max: 200 }),
  body('diagnosisCode').optional().isString().trim().isLength({ max: 50 }),
  body('managedWith').optional().isString().trim().isLength({ max: 500 }),
  body('notes').optional().isString().trim().isLength({ max: 1000 }),
  validate,
  async (req, res, next) => {
    try {
      const visiblePatient = await ensurePatientVisible(req.params.id, req.user);
      if (!visiblePatient) return R.notFound(res, 'Patient not found');
      const { conditionName, diagnosisCode, diagnosedAt, managedWith, notes } = req.body;
      await db.query(
        `INSERT INTO patient_chronic_conditions
           (patient_id, condition_name, diagnosis_code, diagnosed_at, managed_with, notes)
         VALUES (:pid, :name, :code, :date, :managed, :notes)`,
        {
          pid: req.params.id,
          name: conditionName,
          code: diagnosisCode || null,
          date: diagnosedAt || null,
          managed: managedWith || null,
          notes: notes || null,
        }
      );
      return R.created(res);
    } catch (e) { next(e); }
  }
);

router.delete('/:id/allergies/:aid', async (req, res, next) => {
  try {
    const visiblePatient = await ensurePatientVisible(req.params.id, req.user);
    if (!visiblePatient) return R.notFound(res, 'Patient not found');
    await db.query(
      `UPDATE patient_allergies SET is_active = 0 WHERE id = :aid AND patient_id = :pid`,
      { aid: req.params.aid, pid: req.params.id }
    );
    return R.noContent(res);
  } catch (e) { next(e); }
});

router.delete('/:id/chronic-conditions/:cid', async (req, res, next) => {
  try {
    const visiblePatient = await ensurePatientVisible(req.params.id, req.user);
    if (!visiblePatient) return R.notFound(res, 'Patient not found');
    await db.query(
      `UPDATE patient_chronic_conditions SET is_active = 0 WHERE id = :cid AND patient_id = :pid`,
      { cid: req.params.cid, pid: req.params.id }
    );
    return R.noContent(res);
  } catch (e) { next(e); }
});

module.exports = router;
