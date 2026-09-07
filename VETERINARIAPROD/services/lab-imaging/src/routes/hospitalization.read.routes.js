'use strict';

const { Router } = require('express');
const { db, R, logHospitalizationError } = require('./hospitalization.common');

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const { status = 'active' } = req.query;
    const limit  = Math.min(Math.max(parseInt(req.query.limit || '30', 10) || 30, 1), 100); // BUG-9
    const page   = Math.max(parseInt(req.query.page || '1', 10) || 1, 1);
    const offset = (page - 1) * limit;
    const conds = ['h.branch_id = :bid'];
    const p = { bid: req.user.branchId, limit, offset };

    if (status === 'active') conds.push('h.discharge_date IS NULL');
    else if (status === 'discharged') conds.push('h.discharge_date IS NOT NULL');

    const rows = await db.query(
      `SELECT h.id, h.medical_record_id, h.admission_date, h.discharge_date, h.estimated_discharge_date,
              h.hospitalization_reason, h.hospitalization_status, h.hospitalization_status AS status,
              p.name AS patient_name, sp.common_name AS species,
              CONCAT(u.first_name,' ',u.last_name) AS responsible_vet,
              k.kennel_number, w.name AS ward_name,
              DATEDIFF(COALESCE(h.discharge_date, NOW()), h.admission_date) AS days_admitted,
              (SELECT hm.temperature_celsius FROM hospitalization_monitoring hm
               WHERE hm.hospitalization_id = h.id ORDER BY hm.recorded_at DESC LIMIT 1) AS last_temp,
              (SELECT hm.heart_rate FROM hospitalization_monitoring hm
               WHERE hm.hospitalization_id = h.id ORDER BY hm.recorded_at DESC LIMIT 1) AS last_hr
       FROM hospitalizations h
       JOIN patients p ON h.patient_id = p.id
       JOIN species  sp ON p.species_id = sp.id
       JOIN users    u  ON h.responsible_vet_id = u.id
       LEFT JOIN kennels k ON h.kennel_id = k.id
       LEFT JOIN wards   w ON k.ward_id = w.id
       WHERE ${conds.join(' AND ')}
       ORDER BY h.admission_date DESC
       LIMIT :limit OFFSET :offset`,
      p
    );
    return R.ok(res, rows);
  } catch (e) {
    logHospitalizationError('GET /hospitalizations', e, { branchId: req.user?.branchId, query: req.query });
    next(e);
  }
});

router.get('/board', async (req, res, next) => {
  try {
    const rows = await db.query(
      `SELECT * FROM v_active_hospitalizations WHERE branch_id = :bid ORDER BY ward_name, kennel_number`,
      { bid: req.user.branchId }
    );
    return R.ok(res, rows);
  } catch (e) {
    logHospitalizationError('GET /hospitalizations/board', e, { branchId: req.user?.branchId });
    next(e);
  }
});

router.get('/wards/availability', async (req, res, next) => {
  try {
    const rows = await db.query(
      `SELECT w.id AS ward_id, w.name AS ward_name, w.ward_type,
              k.id AS kennel_id, k.kennel_number, k.kennel_type, k.size_category,
              CASE WHEN h.id IS NOT NULL THEN 'occupied' ELSE 'available' END AS status,
              CASE WHEN h.id IS NOT NULL THEN p.name ELSE NULL END AS current_patient
       FROM wards w
       JOIN kennels k ON k.ward_id = w.id
       LEFT JOIN hospitalizations h ON h.kennel_id = k.id AND h.discharge_date IS NULL
       LEFT JOIN patients p ON h.patient_id = p.id
       WHERE w.branch_id = :bid AND k.is_active = TRUE
       ORDER BY w.name, k.kennel_number`,
      { bid: req.user.branchId }
    );
    return R.ok(res, rows);
  } catch (e) {
    logHospitalizationError('GET /hospitalizations/wards/availability', e, { branchId: req.user?.branchId });
    next(e);
  }
});

router.get('/:id(\\d+)', async (req, res, next) => {
  try {
    const hosp = await db.queryOne(
      `SELECT h.*, p.name AS patient_name, p.sex, p.birthdate, p.weight_kg, p.chip_number,
              sp.common_name AS species,
              CONCAT(u.first_name,' ',u.last_name) AS vet_name,
              k.kennel_number, w.name AS ward_name
       FROM hospitalizations h
       JOIN patients p ON h.patient_id = p.id
       JOIN species sp  ON p.species_id  = sp.id
       JOIN users   u   ON h.responsible_vet_id = u.id
       LEFT JOIN kennels k ON h.kennel_id = k.id
       LEFT JOIN wards   w ON k.ward_id   = w.id
       WHERE h.id = :id AND h.branch_id = :bid`,
      { id: req.params.id, bid: req.user.branchId }
    );
    if (!hosp) return R.notFound(res);

    const [monitoring, medications] = await Promise.all([
      db.query(
        `SELECT hm.*, CONCAT(u.first_name,' ',u.last_name) AS recorded_by_name
         FROM hospitalization_monitoring hm
         JOIN users u ON hm.recorded_by = u.id
         WHERE hm.hospitalization_id = :hid ORDER BY hm.recorded_at DESC LIMIT 50`,
        { hid: req.params.id }
      ),
      db.query(
        `SELECT hm2.*, m.name AS medication_name, m.unit,
                CONCAT(u.first_name,' ',u.last_name) AS prescribed_by_name
         FROM hospitalization_medications hm2
         JOIN medications m ON hm2.medication_id = m.id
         JOIN users u ON hm2.prescribed_by = u.id
         WHERE hm2.hospitalization_id = :hid AND hm2.is_active = TRUE`,
        { hid: req.params.id }
      ),
    ]);

    return R.ok(res, { ...hosp, monitoring, medications });
  } catch (e) {
    logHospitalizationError('GET /hospitalizations/:id', e, { hospitalizationId: req.params.id, branchId: req.user?.branchId });
    next(e);
  }
});

module.exports = { router };
