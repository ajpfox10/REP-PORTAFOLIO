'use strict';

const crypto = require('crypto');
const { Router } = require('express');
const { requirePerm } = require('../../../../shared/serviceBase');
const {
  body,
  db,
  R,
  validate,
  getPatientSchema,
  boolFromQuery,
  ensurePatientVisible,
  logPatientsError,
} = require('./patients.common');

const router = Router();

router.post('/',
  body('name').notEmpty().trim(),
  body('speciesId').isInt(),
  body('primaryOwnerId').isInt(),
  body('sex').isIn(['male', 'female', 'unknown']),
  validate,
  async (req, res, next) => {
    try {
      const {
        name, speciesId, breedId, coatColorId, sex,
        birthdate: rawBirthdate, birthDate,
        chipNumber: rawChipNumber, microchip, microchipNumber,
        tattooNumber, passportNumber,
        weightKg, bodyConditionScore,
        isNeutered, isDeceased, photoUrl, notes,
        primaryOwnerId,
      } = req.body;
      const birthdate = rawBirthdate ?? birthDate;
      const chipNumber = rawChipNumber ?? microchipNumber ?? microchip;
      const schema = await getPatientSchema();
      const patientCols = schema.patients || new Set();
      const clientCols = schema.clients || new Set();
      const ownerCols = schema.patient_owners || new Set();

      await db.transaction(async (conn) => {
        const userBranchId = req.user.branchId || null;
        let ownerQuery;
        let ownerParams;
        if (userBranchId) {
          ownerQuery = `SELECT id, branch_id FROM clients WHERE id = :clientId AND branch_id = :branchId ${clientCols.has('organization_id') ? 'AND organization_id = :orgId' : ''}`;
          ownerParams = { clientId: primaryOwnerId, branchId: userBranchId, orgId: req.user.orgId };
        } else {
          ownerQuery = `SELECT id, branch_id FROM clients WHERE id = :clientId ${clientCols.has('organization_id') ? 'AND organization_id = :orgId' : ''}`;
          ownerParams = { clientId: primaryOwnerId, orgId: req.user.orgId };
        }
        const owner = await conn.queryOne(ownerQuery, ownerParams);
        if (!owner) throw new Error('Primary owner not found in current organization/branch');

        const branchId = userBranchId || owner.branch_id || null;

        const columns = ['name', 'species_id'];
        const values = [':name', ':speciesId'];
        const params = {
          name,
          speciesId,
          breedId: breedId || null,
          coatColorId: coatColorId || null,
          sex,
          birthdate: birthdate || null,
          chipNumber: chipNumber || null,
          tattooNumber: tattooNumber || null,
          passportNumber: passportNumber || null,
          weightKg: weightKg || null,
          bodyConditionScore: bodyConditionScore || null,
          isNeutered: isNeutered ? 1 : 0,
          isDeceased: isDeceased ? 1 : 0,
          photoUrl: photoUrl || null,
          notes: notes || null,
          orgId: req.user.orgId,
          branchId,
        };

        if (patientCols.has('organization_id')) { columns.push('organization_id'); values.push(':orgId'); }
        if (patientCols.has('hc_number')) { columns.push('hc_number'); values.push(':hcNumber'); }
        if (patientCols.has('branch_id')) { columns.push('branch_id'); values.push(':branchId'); }
        if (patientCols.has('breed_id')) { columns.push('breed_id'); values.push(':breedId'); }
        if (patientCols.has('coat_color_id')) { columns.push('coat_color_id'); values.push(':coatColorId'); }
        if (patientCols.has('color_id')) { columns.push('color_id'); values.push(':coatColorId'); }
        if (patientCols.has('sex')) { columns.push('sex'); values.push(':sex'); }
        if (patientCols.has('gender')) { columns.push('gender'); values.push(`CASE :sex WHEN 'male' THEN 'M' WHEN 'female' THEN 'F' ELSE 'U' END`); }
        if (patientCols.has('birthdate')) { columns.push('birthdate'); values.push(':birthdate'); }
        if (patientCols.has('birth_date')) { columns.push('birth_date'); values.push(':birthdate'); }
        if (patientCols.has('date_of_birth')) { columns.push('date_of_birth'); values.push(':birthdate'); }
        if (patientCols.has('chip_number')) { columns.push('chip_number'); values.push(':chipNumber'); }
        if (patientCols.has('microchip_number')) { columns.push('microchip_number'); values.push(':chipNumber'); }
        if (patientCols.has('tattoo_number')) { columns.push('tattoo_number'); values.push(':tattooNumber'); }
        if (patientCols.has('tattoo_code')) { columns.push('tattoo_code'); values.push(':tattooNumber'); }
        if (patientCols.has('passport_number')) { columns.push('passport_number'); values.push(':passportNumber'); }
        if (patientCols.has('weight_kg')) { columns.push('weight_kg'); values.push(':weightKg'); }
        if (patientCols.has('body_condition_score')) { columns.push('body_condition_score'); values.push(':bodyConditionScore'); }
        if (patientCols.has('is_sterilized')) { columns.push('is_sterilized'); values.push(':isNeutered'); }
        if (patientCols.has('is_deceased')) { columns.push('is_deceased'); values.push(':isDeceased'); }
        if (patientCols.has('is_active')) { columns.push('is_active'); values.push('1'); }
        if (patientCols.has('active')) { columns.push('active'); values.push('1'); }
        if (patientCols.has('photo_url')) { columns.push('photo_url'); values.push(':photoUrl'); }
        if (patientCols.has('notes')) { columns.push('notes'); values.push(':notes'); }

        const [r] = await conn.query(
          `INSERT INTO patients (${columns.join(', ')})
           VALUES (${values.join(', ')})`,
          {
            ...params,
            hcNumber: `TMP${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`,
          }
        );
        const patientId = r.insertId;

        if (patientCols.has('hc_number')) {
          await conn.query(
            `UPDATE patients
                SET hc_number = :hcNumber
              WHERE id = :patientId`,
            {
              patientId,
              hcNumber: `HC${String(patientId).padStart(6, '0')}`,
            }
          );
        }

        const ownerColumns = ['patient_id', 'client_id', 'ownership_type', 'start_date'];
        const ownerValues = [':patientId', ':clientId', `'primary'`, 'CURDATE()'];
        if (ownerCols.has('active')) {
          ownerColumns.push('active');
          ownerValues.push('1');
        }

        await conn.query(
          `INSERT INTO patient_owners (${ownerColumns.join(', ')})
           VALUES (${ownerValues.join(', ')})`,
          { patientId, clientId: primaryOwnerId }
        );
      });

      return R.created(res, { message: 'Patient created' });
    } catch (e) {
      logPatientsError('POST /patients', e, {
        branchId: req.user?.branchId,
        orgId: req.user?.orgId,
        body: req.body,
      });
      next(e);
    }
  }
);

router.put('/:id',
  body('name').optional().notEmpty().trim(),
  body('sex').optional().isIn(['male', 'female', 'unknown']),
  body('bodyConditionScore').optional().isInt({ min: 1, max: 9 }),
  validate,
  async (req, res, next) => {
    try {
      const visiblePatient = await ensurePatientVisible(req.params.id, req.user);
      if (!visiblePatient) return R.notFound(res, 'Patient not found');

      const schema = await getPatientSchema();
      const patientCols = schema.patients || new Set();
      const clientCols = schema.clients || new Set();
      const ownerCols = schema.patient_owners || new Set();
      const rawMap = {
        name: ['name'],
        speciesId: ['species_id'],
        breedId: ['breed_id'],
        coatColorId: ['coat_color_id', 'color_id'],
        sex: ['sex', 'gender'],
        birthdate: ['birthdate', 'birth_date', 'date_of_birth'],
        birthDate: ['birthdate', 'birth_date', 'date_of_birth'],
        chipNumber: ['chip_number', 'microchip_number'],
        microchip: ['chip_number', 'microchip_number'],
        microchipNumber: ['chip_number', 'microchip_number'],
        tattooNumber: ['tattoo_number', 'tattoo_code'],
        passportNumber: ['passport_number'],
        weightKg: ['weight_kg'],
        bodyConditionScore: ['body_condition_score'],
        isNeutered: ['is_sterilized'],
        isDeceased: ['is_deceased'],
        photoUrl: ['photo_url'],
        notes: ['notes'],
        isActive: ['is_active', 'active'],
      };

      const sets = [];
      const params = {
        id: req.params.id,
        orgId: req.user.orgId,
        branchId: req.user.branchId,
      };
      for (const [key, value] of Object.entries(req.body)) {
        const targets = rawMap[key] || [];
        for (const column of targets) {
          if (!patientCols.has(column)) continue;
          const paramKey = `${column}_${sets.length}`;
          sets.push(`\`${column}\` = :${paramKey}`);
          if (column === 'gender') params[paramKey] = value === 'male' ? 'M' : (value === 'female' ? 'F' : 'U');
          else if (column === 'is_active' || column === 'active') params[paramKey] = boolFromQuery(value, 1);
          else params[paramKey] = value;
        }
      }
      if (!sets.length) return R.badRequest(res, 'No valid fields');

      const scopes = [];
      if (patientCols.has('organization_id')) scopes.push('p.organization_id = :orgId');
      if (clientCols.has('branch_id')) {
        scopes.push(
          `EXISTS (
             SELECT 1
             FROM patient_owners po
             JOIN clients cl ON cl.id = po.client_id
             WHERE po.patient_id = p.id
               ${ownerCols.has('deleted_at') ? 'AND po.deleted_at IS NULL' : ''}
               ${clientCols.has('deleted_at') ? 'AND cl.deleted_at IS NULL' : ''}
               ${ownerCols.has('active') ? 'AND po.active = 1' : ''}
               AND cl.branch_id = :branchId
           )`
        );
      }
      if (!scopes.length) throw new Error('Patients update schema unsupported');

      await db.query(
        `UPDATE patients p
         SET ${sets.join(', ')}, updated_at = NOW()
         WHERE p.id = :id
           ${patientCols.has('deleted_at') ? 'AND p.deleted_at IS NULL' : ''}
           AND (${scopes.join(' OR ')})`,
        params
      );
      return R.noContent(res);
    } catch (e) {
      logPatientsError('PUT /patients/:id', e, {
        patientId: req.params.id,
        branchId: req.user?.branchId,
        orgId: req.user?.orgId,
        body: req.body,
      });
      next(e);
    }
  }
);

router.delete('/:id', requirePerm('patients:delete'), async (req, res, next) => {
  try {
    const visiblePatient = await ensurePatientVisible(req.params.id, req.user);
    if (!visiblePatient) return R.notFound(res, 'Patient not found');

    const schema = await getPatientSchema();
    const patientCols = schema.patients || new Set();

    if (patientCols.has('deleted_at')) {
      await db.query(
        `UPDATE patients SET deleted_at = NOW(), updated_at = NOW() WHERE id = :id`,
        { id: req.params.id }
      );
    } else {
      await db.query(`DELETE FROM patients WHERE id = :id`, { id: req.params.id });
    }

    return R.noContent(res);
  } catch (e) {
    logPatientsError('DELETE /patients/:id', e, {
      patientId: req.params.id,
      branchId: req.user?.branchId,
      orgId: req.user?.orgId,
    });
    next(e);
  }
});

module.exports = router;
