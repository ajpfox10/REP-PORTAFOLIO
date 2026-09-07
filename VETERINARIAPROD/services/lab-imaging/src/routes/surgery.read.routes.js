'use strict';

const { Router } = require('express');
const { db, R, logSurgeryError } = require('./surgery.common');

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const { patientId, status, from, to } = req.query;
    const limit  = Math.min(Math.max(parseInt(req.query.limit || '20', 10) || 20, 1), 100); // BUG-9
    const page   = Math.max(parseInt(req.query.page || '1', 10) || 1, 1);
    const offset = (page - 1) * limit;
    const conds = ['s.branch_id = :bid'];
    const p = { bid: req.user.branchId, limit, offset };
    if (patientId) { conds.push('s.patient_id = :pid'); p.pid = patientId; }
    if (status) { conds.push('s.status = :status'); p.status = status; }
    if (from) { conds.push('s.scheduled_date >= :from'); p.from = from; }
    if (to) { conds.push('s.scheduled_date <= :to'); p.to = to; }

    const rows = await db.query(
      `SELECT s.id, s.medical_record_id, s.scheduled_date, s.start_time, s.end_time, s.status,
              s.duration_minutes, s.urgency,
              st.name AS surgery_type, sc.name AS surgery_category,
              p.name AS patient_name, sp.common_name AS species,
              CONCAT(u.first_name,' ',u.last_name) AS lead_surgeon,
              ar.id AS anesthesia_record_id, ar.anesthesia_type
       FROM surgeries s
       JOIN surgery_types  st ON s.surgery_type_id = st.id
       JOIN surgery_categories sc ON st.category_id = sc.id
       JOIN patients p           ON s.patient_id    = p.id
       JOIN species  sp          ON p.species_id    = sp.id
       JOIN users    u           ON s.lead_surgeon_id = u.id
       LEFT JOIN anesthesia_records ar ON ar.surgery_id = s.id
       WHERE ${conds.join(' AND ')}
       ORDER BY s.scheduled_date DESC, s.start_time DESC
       LIMIT :limit OFFSET :offset`,
      p
    );
    return R.ok(res, rows);
  } catch (e) {
    logSurgeryError('GET /surgeries', e, { branchId: req.user?.branchId, query: req.query });
    next(e);
  }
});

router.get('/types/all', async (_req, res, next) => {
  try {
    const rows = await db.query(
      `SELECT st.id, st.name, st.description, st.estimated_duration_minutes,
              sc.name AS category
       FROM surgery_types st
       JOIN surgery_categories sc ON st.category_id = sc.id
       WHERE st.is_active = TRUE ORDER BY sc.name, st.name`
    );
    return R.ok(res, rows);
  } catch (e) {
    logSurgeryError('GET /surgeries/types/all', e, {});
    next(e);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const surgery = await db.queryOne(
      `SELECT s.*,
              st.name AS type_name, sc.name AS category_name,
              p.name AS patient_name, p.sex, p.birthdate, p.weight_kg,
              sp.common_name AS species,
              CONCAT(u.first_name,' ',u.last_name) AS lead_surgeon_name
       FROM surgeries s
       JOIN surgery_types st  ON s.surgery_type_id  = st.id
       JOIN surgery_categories sc ON st.category_id = sc.id
       JOIN patients p        ON s.patient_id        = p.id
       JOIN species  sp       ON p.species_id         = sp.id
       JOIN users    u        ON s.lead_surgeon_id    = u.id
       WHERE s.id = :id AND s.branch_id = :bid`,
      { id: req.params.id, bid: req.user.branchId }
    );
    if (!surgery) return R.notFound(res);

    const anesthesia = await db.queryOne(
      `SELECT ar.*, CONCAT(u.first_name,' ',u.last_name) AS anesthesiologist_name
       FROM anesthesia_records ar
       JOIN users u ON ar.anesthesiologist_id = u.id
       WHERE ar.surgery_id = :sid`,
      { sid: req.params.id }
    );

    return R.ok(res, { ...surgery, anesthesia });
  } catch (e) {
    logSurgeryError('GET /surgeries/:id', e, { surgeryId: req.params.id, branchId: req.user?.branchId });
    next(e);
  }
});

module.exports = { router };
