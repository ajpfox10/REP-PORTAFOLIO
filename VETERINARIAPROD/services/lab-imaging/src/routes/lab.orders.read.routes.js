'use strict';

const { Router } = require('express');
const { db, R, logLabError } = require('./lab.orders.common');

const router = Router();

router.get('/orders', async (req, res, next) => {
  try {
    const { patientId, status, from, to, page = 1, limit = 20 } = req.query;
    const safePage   = Math.max(1, parseInt(page, 10)  || 1);
    const safeLimit  = Math.min(Math.max(1, parseInt(limit, 10) || 20), 100);
    const offset = (safePage - 1) * safeLimit;
    const conds = ['lo.branch_id = :bid'];
    const p = { bid: req.user.branchId, limit: safeLimit, offset };

    if (patientId) { conds.push('lo.patient_id = :pid'); p.pid = patientId; }
    if (status) { conds.push('lo.status = :status'); p.status = status; }
    if (from) { conds.push('lo.ordered_at >= :from'); p.from = from; }
    if (to) { conds.push('lo.ordered_at <= :to'); p.to = to; }

    const where = `WHERE ${conds.join(' AND ')}`;
    const rows = await db.query(
      `SELECT lo.id, lo.medical_record_id, lo.order_number, lo.status, lo.ordered_at, lo.reported_at,
              lo.priority, lo.clinical_notes,
              p.name AS patient_name, sp.common_name AS species,
              CONCAT(u.first_name,' ',u.last_name) AS ordered_by,
              COUNT(loi.id) AS test_count,
              SUM(CASE WHEN lr.id IS NOT NULL THEN 1 ELSE 0 END) AS results_count
         FROM lab_orders lo
         JOIN patients p       ON lo.patient_id = p.id
         JOIN species sp       ON p.species_id = sp.id
         JOIN users u          ON lo.ordered_by = u.id
    LEFT JOIN lab_order_items loi ON loi.lab_order_id = lo.id
    LEFT JOIN lab_results lr      ON lr.lab_order_item_id = loi.id
        ${where}
        GROUP BY lo.id
        ORDER BY lo.ordered_at DESC
        LIMIT :limit OFFSET :offset`,
      p
    );

    const [{ total }] = await db.query(
      `SELECT COUNT(*) AS total FROM lab_orders lo ${where}`,
      { bid: req.user.branchId, ...(patientId && { pid: patientId }), ...(status && { status }), ...(from && { from }), ...(to && { to }) }
    );

    return R.paginated(res, rows, total, safePage, safeLimit);
  } catch (e) {
    logLabError('GET /lab/orders', e, { branchId: req.user?.branchId, query: req.query });
    next(e);
  }
});

router.get('/orders/pending', async (req, res, next) => {
  try {
    const rows = await db.query(
      `SELECT * FROM v_pending_lab_results WHERE branch_id = :bid ORDER BY ordered_at ASC`,
      { bid: req.user.branchId }
    );
    return R.ok(res, rows);
  } catch (e) {
    logLabError('GET /lab/orders/pending', e, { branchId: req.user?.branchId });
    next(e);
  }
});

router.get('/orders/:id', async (req, res, next) => {
  try {
    const order = await db.queryOne(
      `SELECT lo.*, p.name AS patient_name, p.sex, p.birthdate,
              sp.common_name AS species,
              CONCAT(u.first_name,' ',u.last_name) AS ordered_by_name
         FROM lab_orders lo
         JOIN patients p ON lo.patient_id = p.id
         JOIN species sp ON p.species_id = sp.id
         JOIN users u    ON lo.ordered_by = u.id
        WHERE lo.id = :id AND lo.branch_id = :bid`,
      { id: req.params.id, bid: req.user.branchId }
    );
    if (!order) return R.notFound(res);

    const items = await db.query(
      `SELECT loi.id, lt.name AS test_name, lt.code, loi.status,
              lr.value_text, lr.value_numeric, lr.unit, lr.is_critical,
              lr.reference_range_used, lr.interpretation, lr.reported_at,
              CONCAT(u2.first_name,' ',u2.last_name) AS reported_by
         FROM lab_order_items loi
         JOIN lab_tests lt ON loi.lab_test_id = lt.id
    LEFT JOIN lab_results lr ON lr.lab_order_item_id = loi.id
    LEFT JOIN users u2       ON lr.reported_by = u2.id
        WHERE loi.lab_order_id = :oid
        ORDER BY lt.name`,
      { oid: req.params.id }
    );
    return R.ok(res, { ...order, items });
  } catch (e) {
    logLabError('GET /lab/orders/:id', e, { orderId: req.params.id, branchId: req.user?.branchId });
    next(e);
  }
});

module.exports = { router };
