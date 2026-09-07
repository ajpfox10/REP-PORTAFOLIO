'use strict';

const { Router } = require('express');
const { body } = require('express-validator');
const { db, R, validate, logBillingError } = require('./billing.common');

const router = Router();

// OT-062: list payments — optionally filtered by invoice
router.get('/', async (req, res, next) => {
  try {
    const page  = Math.max(parseInt(req.query.page  || '1',  10) || 1,  1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '50', 10) || 50, 1), 200);
    const { invoiceId } = req.query;
    const offset = (page - 1) * limit;
    const conds = ['i.branch_id = :bid'];
    const p = { bid: req.user.branchId, limit, offset };

    if (invoiceId) { conds.push('p.invoice_id = :invoiceId'); p.invoiceId = invoiceId; }

    const rows = await db.query(
      `SELECT p.id, p.invoice_id, p.amount, p.payment_method, p.reference,
              p.payment_status, p.notes, p.paid_at, p.created_by,
              i.invoice_number,
              CONCAT(cl.first_name,' ',cl.last_name) AS client_name
       FROM payments p
       JOIN invoices i  ON p.invoice_id = i.id
       JOIN clients cl  ON i.client_id  = cl.id
       WHERE ${conds.join(' AND ')}
       ORDER BY p.paid_at DESC
       LIMIT :limit OFFSET :offset`,
      p
    );
    const [{ total }] = await db.query(
      `SELECT COUNT(*) AS total FROM payments p JOIN invoices i ON p.invoice_id = i.id
       WHERE ${conds.join(' AND ')}`,
      { bid: req.user.branchId, ...(invoiceId && { invoiceId }) }
    );
    return R.paginated(res, rows, total, page, limit);
  } catch (e) {
    logBillingError('GET /payments', e, { branchId: req.user?.branchId, query: req.query });
    next(e);
  }
});

router.post('/',
  body('invoiceId').isInt(),
  body('amount').isFloat({ min: 0.01 }),
  body('paymentMethod').isIn(['cash','credit_card','debit_card','bank_transfer','check','crypto','other']),
  validate,
  async (req, res, next) => {
    try {
      const { invoiceId, amount, paymentMethod, reference, notes } = req.body;
      await db.transaction(async (conn) => {
        const invoice = await conn.queryOne(
          `SELECT id, total_amount, paid_amount, status
           FROM invoices
           WHERE id = :id AND branch_id = :bid
           FOR UPDATE`,
          { id: invoiceId, bid: req.user.branchId }
        );
        if (!invoice) throw Object.assign(new Error('Factura no encontrada'), { http: 404 });
        if (['cancelled', 'refunded'].includes(invoice.status)) {
          throw Object.assign(new Error('No se pueden registrar pagos en facturas cerradas'), { http: 409, code: 'INVOICE_CLOSED' });
        }

        const balance = Number(invoice.total_amount || 0) - Number(invoice.paid_amount || 0);
        if (Number(amount) > balance) {
          throw Object.assign(new Error('El pago supera el saldo pendiente'), { http: 409, code: 'PAYMENT_EXCEEDS_BALANCE' });
        }
        const nextPaid = Number(invoice.paid_amount || 0) + Number(amount);
        const nextStatus = nextPaid >= Number(invoice.total_amount || 0) ? 'paid' : 'partial';

        await conn.query(
          `INSERT INTO payments
             (invoice_id, amount, payment_method, reference, payment_status, notes, paid_at, created_by)
           VALUES (:iid, :amount, :method, :reference, 'completed', :notes, NOW(), :uid)`,
          {
            iid: invoiceId,
            amount,
            method: paymentMethod,
            reference: reference || null,
            notes: notes || null,
            uid: req.user.userId,
          }
        );

        await conn.query(
          `UPDATE invoices
           SET paid_amount = paid_amount + :amount,
               status = :status,
               updated_at = NOW()
           WHERE id = :id`,
          { amount, status: nextStatus, id: invoiceId }
        );
      });
      return R.created(res, { message: 'Payment recorded' });
    } catch (e) {
      logBillingError('POST /payments', e, { branchId: req.user?.branchId, body: req.body });
      next(e);
    }
  }
);

module.exports = { router };
