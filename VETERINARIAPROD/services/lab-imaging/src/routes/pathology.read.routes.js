'use strict';

const { Router } = require('express');
const { db, R, logPathologyError } = require('./pathology.common');

const router = Router();

router.get('/orders', async (req, res, next) => {
  try {
    const { patientId, status } = req.query;
    const limit  = Math.min(Math.max(parseInt(req.query.limit || '20', 10) || 20, 1), 100); // BUG-9
    const page   = Math.max(parseInt(req.query.page || '1', 10) || 1, 1);
    const offset = (page - 1) * limit;
    const conds = ['po.branch_id = :bid'];
    const p = { bid: req.user.branchId, limit, offset };
    if (patientId) { conds.push('po.patient_id = :pid'); p.pid = patientId; }
    if (status) { conds.push('po.status = :status'); p.status = status; }

    const rows = await db.query(
      `SELECT po.id, po.order_number, po.status, po.ordered_at, po.clinical_history,
              pt.name AS pathology_type,
              p.name AS patient_name, sp.common_name AS species,
              CONCAT(u.first_name,' ',u.last_name) AS ordered_by,
              COUNT(ps.id) AS sample_count
       FROM pathology_orders po
       JOIN pathology_types pt ON po.pathology_type_id = pt.id
       JOIN patients p         ON po.patient_id        = p.id
       JOIN species  sp        ON p.species_id          = sp.id
       JOIN users    u         ON po.ordered_by         = u.id
       LEFT JOIN pathology_samples ps ON ps.pathology_order_id = po.id
       WHERE ${conds.join(' AND ')}
       GROUP BY po.id, po.order_number, po.status, po.ordered_at, po.clinical_history,
                pt.name, p.name, sp.common_name, u.first_name, u.last_name
       ORDER BY po.ordered_at DESC
       LIMIT :limit OFFSET :offset`,
      p
    );
    return R.ok(res, rows);
  } catch (e) {
    logPathologyError('GET /pathology/orders', e, { branchId: req.user?.branchId, orgId: req.user?.orgId, query: req.query });
    next(e);
  }
});

router.get('/orders/:id', async (req, res, next) => {
  try {
    const order = await db.queryOne(
      `SELECT po.*, pt.name AS type_name,
              p.name AS patient_name, sp.common_name AS species
       FROM pathology_orders po
       JOIN pathology_types pt ON po.pathology_type_id = pt.id
       JOIN patients p ON po.patient_id = p.id
       JOIN species sp ON p.species_id  = sp.id
       WHERE po.id = :id AND po.branch_id = :bid`,
      { id: req.params.id, bid: req.user.branchId }
    );
    if (!order) return R.notFound(res);

    const [samples, result] = await Promise.all([
      db.query(
        `SELECT * FROM pathology_samples WHERE pathology_order_id = :oid ORDER BY sample_number`,
        { oid: req.params.id }
      ),
      db.queryOne(
        `SELECT pr.*, CONCAT(u.first_name,' ',u.last_name) AS pathologist_name
         FROM pathology_results pr
         JOIN users u ON pr.pathologist_id = u.id
         WHERE pr.pathology_order_id = :oid`,
        { oid: req.params.id }
      ),
    ]);
    return R.ok(res, { ...order, samples, result });
  } catch (e) {
    logPathologyError('GET /pathology/orders/:id', e, { branchId: req.user?.branchId, orgId: req.user?.orgId, params: req.params });
    next(e);
  }
});

router.get('/types', async (req, res, next) => {
  try {
    const rows = await db.query(
      `SELECT id, name, is_active, created_at
       FROM pathology_types
       WHERE is_active = TRUE
       ORDER BY name`
    );
    return R.ok(res, rows);
  } catch (e) {
    logPathologyError('GET /pathology/types', e, { branchId: req.user?.branchId, orgId: req.user?.orgId });
    next(e);
  }
});

module.exports = { router };
