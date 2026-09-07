'use strict';

const { Router } = require('express');
const { R, db, dateRange, aggregateDiagnoses } = require('../reports.common');

const router = Router();

// SECURITY: helper para validar y clamp rangos de fecha en charts
const ISO_DATE_RE_CHARTS = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CHART_DAYS = 366;
function chartDateRange(query, defaultFrom) {
  const now = new Date();
  const f = (query.from && ISO_DATE_RE_CHARTS.test(query.from)) ? query.from : defaultFrom || new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
  const t = (query.to   && ISO_DATE_RE_CHARTS.test(query.to))   ? query.to   : now.toISOString().slice(0, 10);
  const diffDays = (new Date(t) - new Date(f)) / 86_400_000;
  if (diffDays < 0 || diffDays > MAX_CHART_DAYS) {
    return { f, t: new Date(new Date(f).getTime() + MAX_CHART_DAYS * 86_400_000).toISOString().slice(0, 10) };
  }
  return { f, t };
}

router.get('/charts/revenue-trend', async (req, res, next) => {
  try {
    const { groupBy = 'month' } = req.query;
    const { f, t } = chartDateRange(req.query);
    // SECURITY: whitelist de groupBy para evitar valor libre en DATE_FORMAT
    const VALID_GROUP_BY = new Set(['day', 'week', 'month']);
    const safeGroupBy = VALID_GROUP_BY.has(groupBy) ? groupBy : 'month';
    const fmt = safeGroupBy === 'day' ? '%Y-%m-%d' : safeGroupBy === 'week' ? '%x-W%v' : '%Y-%m';

    const rows = await db.query(
      `SELECT DATE_FORMAT(issued_date,:fmt) AS label,
              ROUND(SUM(total_amount),2) AS gross,
              ROUND(SUM(total_amount - discount_amount),2) AS net,
              ROUND(SUM(paid_amount),2) AS collected
       FROM invoices
       WHERE branch_id=:bid AND issued_date BETWEEN :from AND :to AND status!='cancelled'
       GROUP BY label ORDER BY label ASC`,
      { fmt, bid: req.user.branchId, from: f, to: t }
    );


    return R.ok(res, {
      labels: rows.map((r) => r.label),
      datasets: [
        { id: 'gross', label: 'Ingreso Bruto', data: rows.map((r) => r.gross) },
        { id: 'net', label: 'Ingreso Neto', data: rows.map((r) => r.net) },
        { id: 'collected', label: 'Cobrado', data: rows.map((r) => r.collected) },
      ],
    });
  } catch (e) { next(e); }
});

router.get('/charts/appointments-heatmap', async (req, res, next) => {
  try {
    const now = new Date();
    const { f, t } = chartDateRange(req.query, new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10));

    const rows = await db.query(
      `SELECT DAYOFWEEK(scheduled_date) AS dow,
              HOUR(scheduled_date)       AS hour,
              COUNT(*) AS count
       FROM appointments
       WHERE branch_id=:bid
         AND scheduled_date >= :from
         AND scheduled_date < DATE_ADD(:to, INTERVAL 1 DAY)
       GROUP BY dow, hour ORDER BY dow, hour`,
      { bid: req.user.branchId, from: f, to: t }
    );

    const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    return R.ok(res, {
      data: rows.map((r) => ({ day: DAYS[r.dow - 1] || String(r.dow), hour: r.hour, count: r.count })),
    });
  } catch (e) { next(e); }
});

router.get('/charts/species-distribution', async (req, res, next) => {
  try {
    const rows = await db.query(
      `SELECT sp.common_name AS species, COUNT(p.id) AS count,
              ROUND(COUNT(p.id)*100.0/SUM(COUNT(p.id)) OVER(),2) AS pct
       FROM patients p
       JOIN patient_owners po ON po.patient_id=p.id AND po.ownership_type='primary'
       JOIN clients cl ON po.client_id=cl.id AND cl.branch_id=:bid
       JOIN species sp ON p.species_id=sp.id
       WHERE p.is_active=TRUE AND p.is_deceased=FALSE
       GROUP BY sp.common_name ORDER BY count DESC`,
      { bid: req.user.branchId }
    );
    return R.ok(res, {
      labels: rows.map((r) => r.species),
      values: rows.map((r) => r.count),
      percents: rows.map((r) => r.pct),
    });
  } catch (e) { next(e); }
});

router.get('/charts/top-diagnoses-bar', async (req, res, next) => {
  try {
    const { f, t } = chartDateRange(req.query);
    // SECURITY: cap de limit para evitar dump masivo
    const limit = Math.min(Math.max(parseInt(req.query.limit || '10', 10) || 10, 1), 50);

    // SECURITY: LIMIT en SQL para evitar carga masiva en memoria antes de agregar
    const rows = await db.query(
      `SELECT d.diagnosis_name, sp.common_name AS species
       FROM diagnoses d
       JOIN medical_records mr ON d.medical_record_id=mr.id
       JOIN appointments a ON mr.appointment_id=a.id AND a.branch_id=:bid
       JOIN patients p ON mr.patient_id = p.id
       JOIN species sp ON p.species_id = sp.id
       WHERE d.created_at >= :from
         AND d.created_at < DATE_ADD(:to, INTERVAL 1 DAY)
         AND d.is_primary=TRUE
       ORDER BY d.created_at DESC
       LIMIT 5000`,
      { bid: req.user.branchId, from: f, to: t }
    );
    const grouped = aggregateDiagnoses(rows, limit);
    return R.ok(res, { labels: grouped.map((r) => r.diagnosis_name), values: grouped.map((r) => r.frequency) });
  } catch (e) { next(e); }
});

router.get('/charts/payment-methods', async (req, res, next) => {
  try {
    const now = new Date();
    const { f, t } = chartDateRange(req.query, new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10));

    const rows = await db.query(
      `SELECT p.payment_method AS method, COUNT(p.id) AS transactions, ROUND(SUM(p.amount),2) AS total,
              ROUND(SUM(p.amount)*100.0/SUM(SUM(p.amount)) OVER(),2) AS pct
       FROM payments p
       JOIN invoices i ON p.invoice_id=i.id AND i.branch_id=:bid
       WHERE p.paid_at >= :from
         AND p.paid_at < DATE_ADD(:to, INTERVAL 1 DAY)
       GROUP BY p.payment_method ORDER BY total DESC`,
      { bid: req.user.branchId, from: f, to: t }
    );
    return R.ok(res, { labels: rows.map((r) => r.method), values: rows.map((r) => r.total), percents: rows.map((r) => r.pct), transactions: rows.map((r) => r.transactions) });
  } catch (e) { next(e); }
});

module.exports = router;
