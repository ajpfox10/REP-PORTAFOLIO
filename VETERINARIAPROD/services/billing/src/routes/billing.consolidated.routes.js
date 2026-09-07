'use strict';

const { Router } = require('express');
const { db, R, mb, logBillingError } = require('./billing.common');

const router = Router();

// Regex para validar formato de fecha YYYY-MM-DD
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

router.get('/summary', async (req, res, next) => {
  try {
    const from = req.query.from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
    const to = req.query.to || new Date().toISOString().slice(0, 10);
    // BUG-FIX: validar formato de fechas para evitar strings arbitrarios
    if (!DATE_RE.test(from) || !DATE_RE.test(to)) return R.badRequest(res, 'Formato de fecha inválido, use YYYY-MM-DD');
    const data = await mb.consolidatedFinancials(req.user.orgId, from, to);
    return R.ok(res, data, { from, to });
  } catch (e) {
    logBillingError('GET /billing/consolidated/summary', e, { orgId: req.user?.orgId, query: req.query });
    next(e);
  }
});

router.get('/invoices', async (req, res, next) => {
  try {
    const { branchId, from, to, status } = req.query;
    const limit  = Math.min(Math.max(parseInt(req.query.limit  || '50', 10) || 50, 1), 200); // BUG-23
    const page   = Math.max(parseInt(req.query.page || '1', 10) || 1, 1);
    const now = new Date();
    const f = from || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const t = to || now.toISOString().slice(0, 10);
    // BUG-FIX: validar formato de fechas
    if (!DATE_RE.test(f) || !DATE_RE.test(t)) return R.badRequest(res, 'Formato de fecha inválido, use YYYY-MM-DD');
    const offset = (page - 1) * limit;
    const conds = ['b.organization_id = :orgId', 'i.issued_date BETWEEN :from AND :to', "i.status != 'cancelled'"];
    const p = { orgId: req.user.orgId, from: f, to: t, limit, offset };
    if (branchId) {
      // BUG-FIX: verificar que el branchId pertenece al orgId del usuario (IDOR cross-org)
      // La condición b.organization_id = :orgId en el WHERE ya filtra por org, pero si
      // branchId es de otra org el JOIN lo descarta sin responder 403. Verificamos explícitamente.
      const branchOwner = await db.queryOne(
        `SELECT id FROM branches WHERE id = :branchId AND organization_id = :orgId LIMIT 1`,
        { branchId, orgId: req.user.orgId }
      );
      if (!branchOwner) return R.forbidden(res, 'Sucursal fuera de la organización');
      conds.push('i.branch_id = :branchId'); p.branchId = branchId;
    }
    if (status) { conds.push('i.status = :status'); p.status = status; }
    const rows = await db.query(
      `SELECT i.id, i.invoice_number, i.status, i.issued_date, i.total_amount, i.paid_amount,
              b.name AS branch_name, b.id AS branch_id,
              CONCAT(cl.first_name,' ',cl.last_name) AS client_name
       FROM invoices i
       JOIN branches b ON i.branch_id = b.id
       JOIN clients cl ON i.client_id = cl.id
       WHERE ${conds.join(' AND ')}
       ORDER BY i.issued_date DESC
       LIMIT :limit OFFSET :offset`,
      p
    );
    return R.ok(res, rows, { from: f, to: t });
  } catch (e) {
    logBillingError('GET /billing/consolidated/invoices', e, { orgId: req.user?.orgId, query: req.query });
    next(e);
  }
});

router.get('/revenue-trend', async (req, res, next) => {
  try {
    const { from, to, groupBy = 'month' } = req.query;
    // BUG-FIX: whitelist explícita de groupBy para evitar valores inesperados
    const VALID_GROUP_BY = new Set(['day', 'week', 'month']);
    if (!VALID_GROUP_BY.has(groupBy)) return R.badRequest(res, 'groupBy debe ser day, week o month');
    const now = new Date();
    const f = from || new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
    const t = to || now.toISOString().slice(0, 10);
    // BUG-FIX: validar formato de fechas
    if (!DATE_RE.test(f) || !DATE_RE.test(t)) return R.badRequest(res, 'Formato de fecha inválido, use YYYY-MM-DD');
    const fmt = groupBy === 'day' ? '%Y-%m-%d' : groupBy === 'week' ? '%x-W%v' : '%Y-%m';
    const rows = await db.query(
      `SELECT DATE_FORMAT(i.issued_date, :fmt) AS period,
              b.id AS branch_id, b.name AS branch_name,
              ROUND(SUM(i.total_amount), 2) AS revenue,
              COUNT(DISTINCT i.id) AS invoices
       FROM invoices i
       JOIN branches b ON i.branch_id = b.id AND b.organization_id = :orgId
       WHERE i.issued_date BETWEEN :from AND :to AND i.status != 'cancelled'
       GROUP BY period, b.id ORDER BY period, b.name`,
      { fmt, orgId: req.user.orgId, from: f, to: t }
    );
    const periods = {};
    const branches = [...new Set(rows.map(r => r.branch_name))];
    for (const row of rows) {
      if (!periods[row.period]) periods[row.period] = { period: row.period };
      periods[row.period][row.branch_name] = row.revenue;
    }
    return R.ok(res, { branches, data: Object.values(periods), raw: rows }, { from: f, to: t });
  } catch (e) {
    logBillingError('GET /billing/consolidated/revenue-trend', e, { orgId: req.user?.orgId, query: req.query });
    next(e);
  }
});

router.get('/outstanding', async (req, res, next) => {
  try {
    const rows = await db.query(
      `SELECT b.id AS branch_id, b.name AS branch_name,
              COUNT(i.id) AS overdue_invoices,
              ROUND(SUM(i.total_amount - i.paid_amount), 2) AS outstanding_amount,
              ROUND(AVG(DATEDIFF(NOW(), i.due_date)), 1) AS avg_days_overdue
       FROM invoices i
       JOIN branches b ON i.branch_id = b.id AND b.organization_id = :orgId
       WHERE i.status IN ('partial', 'pending')
         AND i.due_date < NOW()
       GROUP BY b.id ORDER BY outstanding_amount DESC`,
      { orgId: req.user.orgId }
    );
    return R.ok(res, rows);
  } catch (e) {
    logBillingError('GET /billing/consolidated/outstanding', e, { orgId: req.user?.orgId });
    next(e);
  }
});

module.exports = { router };
