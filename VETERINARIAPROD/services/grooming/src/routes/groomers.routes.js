'use strict';

const { Router } = require('express');
const { param, query } = require('express-validator');
const { db, R, validate, logGroomingError } = require('../grooming.common');

const router = Router();

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

router.get('/', async (req, res, next) => {
  try {
    const rows = await db.query(`SELECT g.id, g.commission_type, g.commission_value, g.specializations, g.is_active, CONCAT(u.first_name,' ',u.last_name) AS name, u.email, u.phone
                                 FROM groomers g JOIN users u ON g.user_id = u.id
                                 WHERE g.branch_id = :bid AND g.is_active = TRUE ORDER BY u.first_name`, { bid: req.user.branchId });
    return R.ok(res, rows);
  } catch (e) {
    logGroomingError('GET /grooming/groomers', e, { branchId: req.user?.branchId });
    next(e);
  }
});

router.get('/performance', async (req, res, next) => {
  try {
    const rows = await db.query(`SELECT * FROM v_groomer_performance WHERE branch_id = :bid ORDER BY total_revenue DESC`, { bid: req.user.branchId });
    return R.ok(res, rows);
  } catch (e) { next(e); }
});

router.get('/:id/commissions',
  param('id').isInt({ min: 1 }),
  query('from').optional().matches(ISO_DATE_RE),
  query('to').optional().matches(ISO_DATE_RE),
  query('paid').optional().isIn(['true', 'false']),
  validate,
  async (req, res, next) => {
    try {
      const { paid } = req.query;
      const from = req.query.from || null;
      const to   = req.query.to   || null;

      // Limitar rango a máximo 1 año para evitar queries sin límite
      if (from && to) {
        const diffDays = (new Date(to) - new Date(from)) / 86_400_000;
        if (diffDays < 0 || diffDays > 366) return R.badRequest(res, 'El rango de fechas no puede superar 366 días');
      }

      const conds = ['gcr.groomer_id = :gid', 'g.branch_id = :bid'];
      const p = { gid: req.params.id, bid: req.user.branchId };
      if (from) { conds.push('gcr.earned_at >= :from'); p.from = from; }
      if (to)   { conds.push('gcr.earned_at <= :to');   p.to = to; }
      if (paid !== undefined) { conds.push('gcr.is_paid = :paid'); p.paid = paid === 'true' ? 1 : 0; }
      const rows = await db.query(
        `SELECT gcr.*, ga.scheduled_at, p.name AS patient_name
         FROM groomer_commission_records gcr
         JOIN groomers g ON g.id = gcr.groomer_id
         JOIN grooming_appointments ga ON gcr.grooming_appointment_id = ga.id
         JOIN patients p ON ga.patient_id = p.id
         WHERE ${conds.join(' AND ')}
         ORDER BY gcr.earned_at DESC
         LIMIT 500`,
        p
      );
      const [{ total_pending }] = await db.query(
        `SELECT COALESCE(SUM(gcr.commission_amount),0) AS total_pending
           FROM groomer_commission_records gcr
           JOIN groomers g ON g.id = gcr.groomer_id
          WHERE gcr.groomer_id=:gid AND g.branch_id=:bid AND gcr.is_paid=FALSE`,
        p
      );
      return R.ok(res, { records: rows, totalPending: total_pending });
    } catch (e) { next(e); }
  }
);

module.exports = router;
