'use strict';

const { Router } = require('express');
const { db, R, portalAuth, mp, publishPortalEvent } = require('../portal.common');

const router = Router();

router.get('/', portalAuth, async (req, res, next) => {
  try {
    const { status, page = 1 } = req.query;
    const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);
    const offset = (Math.max(parseInt(page, 10), 1) - 1) * limit;
    const conds = ['i.client_id=:cid', 'b.organization_id=:orgId'];
    const p = { cid: req.owner.clientId, orgId: req.owner.orgId, limit, offset };
    if (status) { conds.push('i.status=:status'); p.status = status; }

    const rows = await db.query(
      `SELECT i.id, i.invoice_number, i.status, i.issued_date, i.due_date,
              i.total_amount, i.paid_amount, cur.code AS currency,
              p.name AS patient_name, b.name AS clinic_name
       FROM invoices i
       JOIN currencies cur ON i.currency_id=cur.id
       LEFT JOIN patients p ON i.patient_id=p.id
       JOIN branches b ON i.branch_id=b.id
       WHERE ${conds.join(' AND ')}
       ORDER BY i.issued_date DESC
       LIMIT :limit OFFSET :offset`,
      p
    );
    return R.ok(res, rows);
  } catch (e) { next(e); }
});

router.get('/:id', portalAuth, async (req, res, next) => {
  try {
    const inv = await db.queryOne(
      `SELECT i.*, cur.code AS currency, b.name AS clinic_name
       FROM invoices i
       JOIN currencies cur ON i.currency_id=cur.id
       JOIN branches b ON i.branch_id=b.id
       WHERE i.id=:id AND i.client_id=:cid AND b.organization_id=:orgId`,
      { id: req.params.id, cid: req.owner.clientId, orgId: req.owner.orgId }
    );
    if (!inv) return R.notFound(res, 'Factura no encontrada');

    const items = await db.query(
      `SELECT ii.description, ii.quantity, ii.unit_price, ii.discount_pct, ii.tax_pct,
              (ii.quantity * ii.unit_price) AS subtotal
       FROM invoice_items ii WHERE ii.invoice_id=:id`,
      { id: inv.id }
    );
    return R.ok(res, { ...inv, items });
  } catch (e) { next(e); }
});

router.post('/:id/pay', portalAuth, async (req, res, next) => {
  try {
    const inv = await db.queryOne(
      `SELECT i.*, cur.code AS currency, CONCAT(c.first_name,' ',c.last_name) AS client_name, c.email
       FROM invoices i
       JOIN currencies cur ON i.currency_id=cur.id
       JOIN clients c ON i.client_id=c.id
       JOIN branches b ON i.branch_id=b.id
       WHERE i.id=:id AND i.client_id=:cid AND b.organization_id=:orgId
         AND i.status IN ('pending','overdue','partial')`,
      { id: req.params.id, cid: req.owner.clientId, orgId: req.owner.orgId }
    );
    if (!inv) return R.notFound(res, 'Factura no encontrada o ya pagada');

    const pref = await mp.createPreference({
      invoiceId: inv.id,
      invoiceNumber: inv.invoice_number,
      amount: inv.total_amount - inv.paid_amount,
      currency: inv.currency,
      payerEmail: inv.email,
      payerName: inv.client_name,
      description: `Factura ${inv.invoice_number}`,
      orgId: req.owner.orgId,
      branchId: inv.branch_id,
      idempotencyKey: `inv-${inv.id}-org-${req.owner.orgId}-amount-${Math.round((inv.total_amount - inv.paid_amount) * 100)}`,
    });
    publishPortalEvent('portal.invoice.payment_requested', {
      invoiceId: inv.id,
      clientId: req.owner.clientId,
      orgId: req.owner.orgId || null,
      branchId: inv.branch_id || null,
      amount: inv.total_amount - inv.paid_amount,
      currency: inv.currency,
    }, req);

    return R.ok(res, pref);
  } catch (e) { next(e); }
});

module.exports = router;
