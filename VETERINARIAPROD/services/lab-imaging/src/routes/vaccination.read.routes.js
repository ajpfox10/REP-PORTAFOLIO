'use strict';

const { Router } = require('express');
const { body } = require('express-validator');
const { getRows, getInsertResult, R, validate, resolveBranchFromPatient, logVaccinationError } = require('./vaccination.common');

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const { patientId, upcoming } = req.query;
    const safePage  = Math.max(1, parseInt(req.query.page  || 1, 10));
    const safeLimit = Math.min(Math.max(1, parseInt(req.query.limit || 30, 10)), 100);
    const offset = (safePage - 1) * safeLimit;

    let branchId = req.user?.branchId || null;

    if (!branchId && patientId) {
      const resolved = await resolveBranchFromPatient(req, patientId);
      if (resolved.error) return R.badRequest(res, resolved.error);
      branchId = resolved.branchId;
    }

    if (!branchId) {
      return R.badRequest(res, 'No se pudo determinar la sucursal');
    }

    const conds = ['v.branch_id = :bid'];
    const p = {
      bid: branchId,
      limit: safeLimit,
      offset,
    };

    if (patientId) {
      conds.push('v.patient_id = :pid');
      p.pid = patientId;
    }

    if (upcoming === 'true') {
      conds.push('v.next_due_date BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 30 DAY)');
    }

    const rows = await getRows(
      `SELECT v.id, v.vaccination_date, v.next_due_date, v.batch_number, v.notes,
              vac.name AS vaccine_name, vac.disease_covered, vac.manufacturer,
              p.name AS patient_name, sp.common_name AS species,
              CONCAT(u.first_name,' ',u.last_name) AS administered_by
       FROM vaccinations v
       JOIN vaccines vac ON v.vaccine_id = vac.id
       JOIN patients p   ON v.patient_id = p.id
       JOIN species sp   ON p.species_id = sp.id
       JOIN users u      ON v.administered_by = u.id
       WHERE ${conds.join(' AND ')}
       ORDER BY v.vaccination_date DESC
       LIMIT :limit OFFSET :offset`,
      p
    );

    return R.ok(res, rows);
  } catch (e) {
    logVaccinationError('GET /vaccinations', e, { branchId: req.user?.branchId, query: req.query });
    next(e);
  }
});

router.get('/alerts', async (req, res, next) => {
  try {
    const branchId = req.user?.branchId || null;

    if (!branchId) {
      return R.badRequest(res, 'No se pudo determinar la sucursal');
    }

    const rows = await getRows(
      `SELECT * FROM v_vaccination_alerts WHERE branch_id = :bid ORDER BY next_due_date`,
      { bid: branchId }
    );

    return R.ok(res, rows);
  } catch (e) {
    logVaccinationError('GET /vaccinations/alerts', e, { branchId: req.user?.branchId });
    next(e);
  }
});

router.get('/vaccines', async (req, res, next) => {
  try {
    const { speciesId } = req.query;

    const where = speciesId
      ? `WHERE (v.target_species LIKE :s OR v.target_species = 'all') AND v.is_active = TRUE`
      : `WHERE v.is_active = TRUE`;

    const rows = await getRows(
      `SELECT v.*, vm.name AS manufacturer_name
       FROM vaccines v
       LEFT JOIN vaccine_manufacturers vm ON v.manufacturer_id = vm.id
       ${where}
       ORDER BY v.name`,
      speciesId ? { s: `%${speciesId}%` } : {}
    );

    return R.ok(res, rows);
  } catch (e) {
    logVaccinationError('GET /vaccinations/vaccines', e, { query: req.query });
    next(e);
  }
});

const MAX_VACCINE_FUTURE_DAYS = 1; // vaccination_date no puede ser futura
const MAX_NEXT_DUE_YEARS = 5;      // next_due_date max 5 años en el futuro

router.post('/',
  body('patientId').isInt(),
  body('vaccineId').isInt(),
  body('vaccinationDate').isISO8601().custom((val) => {
    const d = new Date(val);
    const now = new Date();
    now.setHours(23, 59, 59, 999); // tolerar zona horaria del mismo día
    if (d > now) throw new Error('La fecha de vacunación no puede ser futura');
    return true;
  }),
  body('nextDueDate').optional().isISO8601().custom((val) => {
    const d = new Date(val);
    const maxFuture = new Date();
    maxFuture.setFullYear(maxFuture.getFullYear() + MAX_NEXT_DUE_YEARS);
    if (d > maxFuture) throw new Error(`La próxima fecha no puede ser más de ${MAX_NEXT_DUE_YEARS} años en el futuro`);
    return true;
  }),
  body('notes').optional().isString().trim().isLength({ max: 1000 }),
  body('batchNumber').optional().isString().trim().isLength({ max: 100 }),
  validate,
  async (req, res, next) => {
    try {
      const {
        patientId, vaccineId, vaccinationDate,
        batchNumber, nextDueDate, dose, expiryDate,
        route, administrationSite, medicalRecordId, notes,
      } = req.body;

      const resolved = await resolveBranchFromPatient(req, patientId);
      if (resolved.error) return R.badRequest(res, resolved.error);
      const { branchId } = resolved;

      const vaccines = await getRows(
        'SELECT id FROM vaccines WHERE id = :vaccineId AND is_active = TRUE LIMIT 1',
        { vaccineId }
      );
      if (!vaccines[0]) return R.badRequest(res, 'Vacuna no encontrada');

      const r = await getInsertResult(
        `INSERT INTO vaccinations
           (branch_id, patient_id, vaccine_id, vaccination_date,
            batch_number, next_due_date, dose, expiry_date,
            route, administration_site, medical_record_id, notes, administered_by)
         VALUES
           (:bid, :pid, :vid, :date,
            :batch, :next, :dose, :expiry,
            :route, :site, :mrid, :notes, :uid)`,
        {
          bid:    branchId,
          pid:    patientId,
          vid:    vaccineId,
          date:   vaccinationDate,
          batch:  batchNumber  || null,
          next:   nextDueDate  || null,
          dose:   dose         || null,
          expiry: expiryDate   || null,
          route:  route        || null,
          site:   administrationSite || null,
          mrid:   medicalRecordId    || null,
          notes:  notes        || null,
          uid:    req.user.userId,
        }
      );

      return R.created(res, { id: r.insertId });
    } catch (e) {
      logVaccinationError('POST /vaccinations', e, { body: req.body });
      next(e);
    }
  }
);

module.exports = { router };
