'use strict';

const { Router } = require('express');
const {
  db,
  R,
  deletedPredicate,
  logPatientsError,
  getPatientSchema,
  getPatientListSchema,
  boolFromQuery,
  ensurePatientVisible,
} = require('./patients.common');
const { CROSS_BRANCH_ROLES } = require('../../../../shared/abac');

const router = Router();

function firstExistingColumn(cols, candidates, fallback = 'NULL') {
  return candidates.find((column) => cols.has(column)) || fallback;
}

router.get('/', async (req, res, next) => {
  try {
    const {
      search,
      speciesId,
      species,
      isActive: isActiveQuery,
      is_active: isActiveLegacy,
      page = 1,
    } = req.query;
    const parsedPage = Math.max(parseInt(`${page}`, 10) || 1, 1);
    const isActive = isActiveQuery ?? isActiveLegacy ?? 'true';
    const limit = Math.min(parseInt(`${req.query.limit || '20'}`, 10) || 20, 100);
    const offset = (parsedPage - 1) * limit;
    const branchId = req.user.branchId;
    const orgId = req.user.orgId;
    const schema = await getPatientListSchema();
    const patientCols = schema.patients || new Set();
    const clientCols = schema.clients || new Set();
    const ownerCols = schema.patient_owners || new Set();

    const activeCol = patientCols.has('is_active') ? 'p.is_active' : (patientCols.has('active') ? 'p.active' : null);
    const chipCol = patientCols.has('chip_number')
      ? `COALESCE(p.chip_number, ${patientCols.has('microchip_number') ? 'p.microchip_number' : 'NULL'})`
      : (patientCols.has('microchip_number') ? 'p.microchip_number' : 'NULL');
    const hcCol = patientCols.has('hc_number') ? 'p.hc_number' : 'NULL';
    const tattooCol = patientCols.has('tattoo_number') ? 'p.tattoo_number' : (patientCols.has('tattoo_code') ? 'p.tattoo_code' : 'NULL');
    const sexCol = patientCols.has('sex')
      ? 'p.sex'
      : (patientCols.has('gender') ? `CASE p.gender WHEN 'M' THEN 'male' WHEN 'F' THEN 'female' ELSE 'unknown' END` : `'unknown'`);
    const birthdateCol = patientCols.has('birthdate')
      ? `COALESCE(p.birthdate, ${patientCols.has('birth_date') ? 'p.birth_date' : (patientCols.has('date_of_birth') ? 'p.date_of_birth' : 'NULL')})`
      : (patientCols.has('birth_date') ? 'p.birth_date' : (patientCols.has('date_of_birth') ? 'p.date_of_birth' : 'NULL'));
    const coatJoinCol = patientCols.has('coat_color_id') ? 'p.coat_color_id' : (patientCols.has('color_id') ? 'p.color_id' : null);
    const bodyConditionCol = patientCols.has('body_condition_score') ? 'p.body_condition_score' : 'NULL';
    const ownerPhoneCol = clientCols.has('phone') ? 'cl.phone' : (clientCols.has('phone_primary') ? 'cl.phone_primary' : 'NULL');
    // Tenant isolation: organization SIEMPRE obligatoria (AND). La sucursal es un
    // filtro adicional solo para roles acotados a su sucursal; los roles cross-branch
    // (superadmin, org_admin, branch_manager, billing_admin) y los usuarios sin
    // branchId ven toda la organización. Antes se combinaba con OR, lo que hacía que
    // un usuario de sucursal viera todos los pacientes de la organización.
    const isCrossBranch = (req.user?.roles || []).some((r) => CROSS_BRANCH_ROLES.has(r));
    const scopeConditions = [];
    if (patientCols.has('organization_id')) scopeConditions.push('p.organization_id = :orgId');
    if (clientCols.has('branch_id') && branchId != null && !isCrossBranch) {
      scopeConditions.push('cl.branch_id = :branchId');
    }
    // Esquemas sin organization_id: degradar a aislamiento por sucursal del cliente.
    if (!scopeConditions.length && clientCols.has('branch_id')) {
      scopeConditions.push('cl.branch_id = :branchId');
    }
    const ownerPrimaryCondition = ownerCols.has('active')
      ? `po.ownership_type = 'primary' AND po.active = 1`
      : `po.ownership_type = 'primary'`;

    if (!scopeConditions.length) {
      throw new Error('Patients list schema unsupported: missing clients.branch_id and patients.organization_id');
    }

    const conditions = [
      ...scopeConditions,
      deletedPredicate(patientCols, 'p'),
      deletedPredicate(clientCols, 'cl'),
      deletedPredicate(ownerCols, 'po'),
    ];
    const params = { branchId, orgId, limit, offset };

    if (isActive !== 'all' && activeCol) {
      conditions.push(`${activeCol} = :isActive`);
      params.isActive = boolFromQuery(isActive, 1);
    }
    if (search) {
      conditions.push(`(p.name LIKE :s OR ${hcCol} LIKE :s OR ${chipCol} LIKE :s OR ${tattooCol} LIKE :s OR CONCAT(cl.first_name,' ',cl.last_name) LIKE :s)`);
      params.s = `%${search}%`;
    }
    if (speciesId) {
      conditions.push(`p.species_id = :speciesId`);
      params.speciesId = speciesId;
    } else if (species) {
      conditions.push(`sp.common_name = :species`);
      params.species = species;
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const countParams = { ...params };
    delete countParams.limit;
    delete countParams.offset;

    const [rows, [{ total }]] = await Promise.all([
      db.query(
        `SELECT p.id, p.name, ${hcCol} AS hc_number,
                ${chipCol} AS chip_number,
                ${sexCol} AS sex,
                ${birthdateCol} AS birthdate,
                ${activeCol || '1'} AS is_active,
                sp.common_name AS species, b.name AS breed, co.name AS coat_color,
                CONCAT(cl.first_name,' ',cl.last_name) AS primary_owner,
                cl.id AS owner_id, ${ownerPhoneCol} AS owner_phone,
                p.photo_url, p.weight_kg, ${bodyConditionCol} AS body_condition_score
         FROM patients p
         JOIN patient_owners po ON po.patient_id = p.id AND ${ownerPrimaryCondition}
         JOIN clients cl ON po.client_id = cl.id
         LEFT JOIN species sp ON p.species_id = sp.id
         LEFT JOIN breeds b ON p.breed_id = b.id
         LEFT JOIN coat_colors co ON ${coatJoinCol ? `${coatJoinCol} = co.id` : '1 = 0'}
         ${where}
         ORDER BY p.name
         LIMIT :limit OFFSET :offset`,
        params
      ),
      db.query(
        `SELECT COUNT(DISTINCT p.id) AS total
         FROM patients p
         JOIN patient_owners po ON po.patient_id = p.id AND ${ownerPrimaryCondition}
         JOIN clients cl ON po.client_id = cl.id
         LEFT JOIN species sp ON p.species_id = sp.id
         ${where}`,
        countParams
      ),
    ]);

    return R.paginated(res, rows, total, parsedPage, limit);
  } catch (e) {
    logPatientsError('GET /patients', e, {
      branchId: req.user?.branchId,
      orgId: req.user?.orgId,
      query: req.query,
    });
    next(e);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const visiblePatient = await ensurePatientVisible(req.params.id, req.user);
    if (!visiblePatient) return R.notFound(res, 'Patient not found');

    const schema = await getPatientSchema();
    const patientCols = schema.patients || new Set();
    const clientCols = schema.clients || new Set();
    const ownerCols = schema.patient_owners || new Set();
    const allergyCols = schema.patient_allergies || new Set();
    const conditionCols = schema.patient_chronic_conditions || new Set();

    const chipExpr = patientCols.has('chip_number')
      ? `COALESCE(p.chip_number, ${patientCols.has('microchip_number') ? 'p.microchip_number' : 'NULL'})`
      : (patientCols.has('microchip_number') ? 'p.microchip_number' : 'NULL');
    const birthExpr = patientCols.has('birthdate')
      ? `COALESCE(p.birthdate, ${patientCols.has('birth_date') ? 'p.birth_date' : (patientCols.has('date_of_birth') ? 'p.date_of_birth' : 'NULL')})`
      : (patientCols.has('birth_date') ? 'p.birth_date' : (patientCols.has('date_of_birth') ? 'p.date_of_birth' : 'NULL'));
    const activeExpr = patientCols.has('is_active') ? 'p.is_active' : (patientCols.has('active') ? 'p.active' : '1');
    const colorJoinExpr = patientCols.has('coat_color_id') ? 'p.coat_color_id' : (patientCols.has('color_id') ? 'p.color_id' : null);
    const ownerPhoneExpr = clientCols.has('phone') ? 'cl.phone' : (clientCols.has('phone_primary') ? 'cl.phone_primary' : 'NULL');
    const ownerActiveFilter = ownerCols.has('active') ? 'AND po.active = 1' : '';
    const allergyActiveFilter = allergyCols.has('is_active') ? 'AND is_active = TRUE' : '';
    const conditionActiveFilter = conditionCols.has('is_active') ? 'AND is_active = TRUE' : '';

    const patient = await db.queryOne(
      `SELECT p.*,
              ${patientCols.has('hc_number') ? 'p.hc_number' : 'NULL'} AS hc_number,
              ${chipExpr} AS chip_number,
              ${birthExpr} AS birthdate,
              ${activeExpr} AS is_active,
              sp.common_name AS species_name, sp.scientific_name,
              b.name AS breed_name,
              co.name AS coat_color_name
       FROM patients p
       LEFT JOIN species sp ON p.species_id = sp.id
       LEFT JOIN breeds b ON p.breed_id = b.id
       LEFT JOIN coat_colors co ON ${colorJoinExpr ? `${colorJoinExpr} = co.id` : '1 = 0'}
       WHERE p.id = :id
         AND ${deletedPredicate(patientCols, 'p')}`,
      { id: req.params.id }
    );
    if (!patient) return R.notFound(res, 'Patient not found');

    const [owners, allergies, conditions] = await Promise.all([
      db.query(
        `SELECT cl.id, cl.first_name, cl.last_name, cl.email, ${ownerPhoneExpr} AS phone,
                po.ownership_type, po.start_date, po.end_date, po.notes
         FROM patient_owners po
         JOIN clients cl ON po.client_id = cl.id
         WHERE po.patient_id = :pid
           AND ${deletedPredicate(ownerCols, 'po')}
           AND ${deletedPredicate(clientCols, 'cl')}
           ${ownerActiveFilter}
         ORDER BY FIELD(po.ownership_type,'primary','secondary')`,
        { pid: req.params.id }
      ),
      db.query(`SELECT * FROM patient_allergies WHERE patient_id = :pid ${allergyActiveFilter}`, { pid: req.params.id }),
      db.query(`SELECT * FROM patient_chronic_conditions WHERE patient_id = :pid ${conditionActiveFilter}`, { pid: req.params.id }),
    ]);

    return R.ok(res, { ...patient, owners, allergies, chronicConditions: conditions });
  } catch (e) {
    logPatientsError('GET /patients/:id', e, {
      patientId: req.params.id,
      branchId: req.user?.branchId,
      orgId: req.user?.orgId,
    });
    next(e);
  }
});

router.get('/:id/timeline', async (req, res, next) => {
  try {
    const visiblePatient = await ensurePatientVisible(req.params.id, req.user);
    if (!visiblePatient) return R.notFound(res, 'Patient not found');

    const schema = await getPatientSchema();
    const patientId = req.params.id;
    const timeline = [];
    const sourceSql = [];
    const sourceParams = { patientId };
    const appointmentCols = schema.appointments || new Set();
    const medicalCols = schema.medical_records || new Set();
    const appointmentEventCol = firstExistingColumn(appointmentCols, ['scheduled_date', 'appointment_date', 'created_at']);
    const appointmentTitleCol = firstExistingColumn(appointmentCols, ['reason', 'notes'], null);
    if (appointmentCols.has('patient_id') && appointmentEventCol) {
      sourceSql.push({
        table: 'appointments',
        type: 'appointment',
        sql: `SELECT id,
                     ${appointmentEventCol} AS event_at,
                     ${appointmentCols.has('status') ? 'status,' : ''}
                     ${appointmentTitleCol ? `${appointmentTitleCol} AS title` : `'Appointment' AS title`},
                     ${appointmentCols.has('notes') ? 'notes' : 'NULL AS notes'}
              FROM appointments
              WHERE patient_id = :patientId`,
      });
    }

    const medicalEventCol = firstExistingColumn(medicalCols, ['recorded_at', 'visit_date', 'opened_at', 'created_at']);
    const medicalTitleCols = ['diagnosis', 'reason_for_visit', 'chief_complaint', 'notes'].filter((column) => medicalCols.has(column));
    if (medicalCols.has('patient_id') && medicalEventCol) {
      const medicalTitleExpr = medicalTitleCols.length
        ? `COALESCE(${medicalTitleCols.join(', ')}, 'Medical record')`
        : `'Medical record'`;
      sourceSql.push({
        table: 'medical_records',
        type: 'medical_record',
        sql: `SELECT id,
                     ${medicalEventCol} AS event_at,
                     ${medicalTitleExpr} AS title,
                     ${medicalCols.has('notes') ? 'notes' : 'NULL AS notes'}
              FROM medical_records
              WHERE patient_id = :patientId`,
      });
    }

    const sources = [
      { table: 'vaccinations', type: 'vaccination', event: ['administered_at', 'application_date', 'created_at'], title: ['vaccine_name', 'name'], fallback: 'Vaccination' },
      { table: 'deworming_records', type: 'deworming', event: ['administered_at', 'application_date', 'created_at'], title: ['product_name', 'medication_name'], fallback: 'Deworming' },
      { table: 'surgeries', type: 'surgery', event: ['performed_at', 'surgery_date', 'created_at'], title: ['procedure_name', 'surgery_type'], fallback: 'Surgery' },
      { table: 'hospitalizations', type: 'hospitalization', event: ['admitted_at', 'admission_date', 'created_at'], title: ['reason', 'diagnosis'], fallback: 'Hospitalization' },
      { table: 'tele_sessions', type: 'telemedicine', event: ['started_at', 'scheduled_for', 'scheduled_at', 'created_at'], title: ['topic', 'reason'], fallback: 'Telemedicine session' },
      { table: 'grooming_appointments', type: 'grooming', event: ['scheduled_date', 'appointment_date', 'created_at'], title: ['service_name', 'notes'], fallback: 'Grooming' },
    ].map((source) => {
      const cols = schema[source.table] || new Set();
      const eventCol = firstExistingColumn(cols, source.event);
      const titleCols = source.title.filter((column) => cols.has(column));
      if (!cols.has('patient_id') || !eventCol) return null;
      const titleExpr = titleCols.length ? `COALESCE(${titleCols.join(', ')}, '${source.fallback}')` : `'${source.fallback}'`;
      return {
        table: source.table,
        type: source.type,
        sql: `SELECT id,
                     ${eventCol} AS event_at,
                     ${titleExpr} AS title,
                     ${cols.has('status') ? 'status,' : ''}
                     ${cols.has('notes') ? 'notes' : 'NULL AS notes'}
              FROM ${source.table}
              WHERE patient_id = :patientId`,
      };
    }).filter(Boolean);

    await Promise.all(
      [...sourceSql, ...sources]
        .filter((source) => schema[source.table]?.has('patient_id'))
        .map(async (source) => {
          try {
            const rows = await db.query(source.sql, sourceParams);
            for (const row of rows) timeline.push({ ...row, type: source.type });
          } catch (sourceError) {
            logPatientsError('GET /patients/:id/timeline source failed', sourceError, {
              patientId: req.params.id,
              table: source.table,
              type: source.type,
            });
          }
        })
    );

    timeline.sort((a, b) => {
      const left = a.event_at ? new Date(a.event_at).getTime() : 0;
      const right = b.event_at ? new Date(b.event_at).getTime() : 0;
      return right - left;
    });

    return R.ok(res, timeline);
  } catch (e) {
    logPatientsError('GET /patients/:id/timeline', e, {
      patientId: req.params.id,
      branchId: req.user?.branchId,
      orgId: req.user?.orgId,
    });
    next(e);
  }
});

module.exports = router;
