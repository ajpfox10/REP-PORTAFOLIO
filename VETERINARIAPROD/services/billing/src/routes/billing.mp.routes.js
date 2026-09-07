'use strict';

const { Router } = require('express');
const { body } = require('express-validator');
const { db, R, mp, validate, logBillingError } = require('./billing.common');
const { requirePerm } = require('../../../../shared/serviceBase');

const router = Router();

async function createPreference(req, res, next) {
  try {
    const { invoiceId } = req.body;

    const inv = await db.queryOne(
      `SELECT i.id, i.invoice_number, i.total_amount, i.paid_amount, i.status,
              cur.code AS currency,
              CONCAT(cl.first_name,' ',cl.last_name) AS client_name,
              cl.email AS client_email
       FROM invoices i
       JOIN clients cl ON i.client_id = cl.id
       JOIN currencies cur ON i.currency_id = cur.id
       WHERE i.id = :id AND i.branch_id = :bid`,
      { id: invoiceId, bid: req.user.branchId }
    );
    if (!inv) return R.notFound(res, 'Factura no encontrada');
    if (inv.status === 'paid') return R.conflict(res, 'La factura ya esta pagada');
    if (inv.status === 'cancelled') return R.conflict(res, 'La factura esta cancelada');
    if (inv.status === 'refunded') return R.conflict(res, 'La factura esta reembolsada');

    const balance = Number(inv.total_amount || 0) - Number(inv.paid_amount || 0);
    if (balance <= 0) return R.conflict(res, 'La factura no tiene saldo pendiente');

    // MercadoPago requires a real payer_email for payment receipts and fraud checks.
    const pref = await mp.createPreference({
      invoiceId: inv.id,
      invoiceNumber: inv.invoice_number,
      amount: balance,
      currency: inv.currency,
      payerEmail: inv.client_email,
      payerName: inv.client_name,
      description: `Factura ${inv.invoice_number} - VetManager Pro`,
      orgId: req.user.orgId,
      branchId: req.user.branchId,
      idempotencyKey: `inv-${inv.id}-org-${req.user.orgId}-amount-${Math.round(balance * 100)}`,
    });

    await db.query(
      `UPDATE invoices SET mp_preference_id = :pref, updated_at = NOW() WHERE id = :id`,
      { pref: pref.preferenceId, id: invoiceId }
    );

    return R.ok(res, pref);
  } catch (e) {
    logBillingError('POST /payments/mp/preference', e, { branchId: req.user?.branchId, body: req.body });
    next(e);
  }
}

async function getPayment(req, res, next) {
  try {
    // Validar que mpPaymentId sea numérico para evitar strings arbitrarios hacia la API MP
    if (!/^\d+$/.test(String(req.params.mpPaymentId))) {
      return R.badRequest(res, 'mpPaymentId debe ser un número entero');
    }
    const localPayment = await db.queryOne(
      `SELECT p.id, p.invoice_id, i.branch_id, b.organization_id AS org_id
       FROM payments p
       JOIN invoices i ON i.id = p.invoice_id
       JOIN branches b ON b.id = i.branch_id
       WHERE p.mp_payment_id = :mpid
         AND i.branch_id = :branchId
       LIMIT 1`,
      { mpid: String(req.params.mpPaymentId), branchId: req.user.branchId }
    );
    if (!localPayment) return R.notFound(res, 'Pago MercadoPago no encontrado');
    if (req.user.orgId && Number(localPayment.org_id) !== Number(req.user.orgId)) {
      return R.forbidden(res, 'Pago fuera de la organizacion');
    }

    const data = await mp.getPayment(req.params.mpPaymentId);
    return R.ok(res, {
      id: data.id,
      localPaymentId: localPayment.id,
      invoiceId: localPayment.invoice_id,
      status: data.status,
      statusDetail: data.status_detail,
      amount: data.transaction_amount,
      currency: data.currency_id,
      payer: data.payer,
      createdAt: data.date_created,
      approvedAt: data.date_approved,
    });
  } catch (e) {
    logBillingError('GET /payments/mp/:mpPaymentId', e, { mpPaymentId: req.params.mpPaymentId });
    next(e);
  }
}

async function refundPayment(req, res, next) {
  try {
    // Validar que mpPaymentId sea numérico para evitar strings arbitrarios hacia la API MP
    if (!/^\d+$/.test(String(req.params.mpPaymentId))) {
      return R.badRequest(res, 'mpPaymentId debe ser un número entero');
    }
    const { mpPaymentId } = req.params;
    const { amount, reason } = req.body;
    const payment = await db.queryOne(
      `SELECT p.id, p.invoice_id, p.amount, i.paid_amount, i.branch_id, b.organization_id AS org_id
       FROM payments p
       JOIN invoices i ON i.id = p.invoice_id
       JOIN branches b ON b.id = i.branch_id
       WHERE p.mp_payment_id = :mpid
         AND p.amount > 0
         AND i.branch_id = :branchId
       LIMIT 1`,
      { mpid: String(mpPaymentId), branchId: req.user.branchId }
    );
    if (!payment) return R.notFound(res, 'Pago MercadoPago no encontrado');
    if (req.user.orgId && Number(payment.org_id) !== Number(req.user.orgId)) {
      return R.forbidden(res, 'Pago fuera de la organizacion');
    }

    const refunded = await db.queryOne(
      `SELECT COALESCE(SUM(ABS(amount)), 0) AS total
       FROM payments
       WHERE invoice_id = :invoiceId
         AND payment_method = 'mercadopago'
         AND payment_status = 'refunded'
         AND reference LIKE :prefix`,
      { invoiceId: payment.invoice_id, prefix: `refund:${mpPaymentId}:%` }
    );
    const refundable = Number(payment.amount || 0) - Number(refunded?.total || 0);
    const requestedAmount = amount ? Number(amount) : refundable;
    if (!refundable || refundable <= 0) return R.conflict(res, 'El pago ya fue reembolsado');
    if (!requestedAmount || requestedAmount <= 0) return R.badRequest(res, 'Monto de reembolso invalido');
    if (requestedAmount > refundable) return R.conflict(res, 'El reembolso supera el monto disponible');

    const refund = await mp.refundPayment(mpPaymentId, requestedAmount);
    const refundRef = `refund:${mpPaymentId}:${refund.id || Math.round(requestedAmount * 100)}`;

    let applied = false;
    await db.transaction(async (conn) => {
      const lockedPayment = await conn.queryOne(
        `SELECT p.id, p.invoice_id, p.amount, i.paid_amount
         FROM payments p
         JOIN invoices i ON i.id = p.invoice_id
         WHERE p.id = :id
           AND i.branch_id = :branchId
         FOR UPDATE`,
        { id: payment.id, branchId: req.user.branchId }
      );
      if (!lockedPayment) throw Object.assign(new Error('Pago MercadoPago no encontrado'), { http: 404 });

      const existingRefund = await conn.queryOne(
        `SELECT id FROM payments WHERE reference = :ref AND payment_status = 'refunded' LIMIT 1`,
        { ref: refundRef }
      );
      if (existingRefund) return;

      const alreadyRefunded = await conn.queryOne(
        `SELECT COALESCE(SUM(ABS(amount)), 0) AS total
         FROM payments
         WHERE invoice_id = :invoiceId
           AND payment_method = 'mercadopago'
           AND payment_status = 'refunded'
           AND reference LIKE :prefix`,
        { invoiceId: lockedPayment.invoice_id, prefix: `refund:${mpPaymentId}:%` }
      );
      const remaining = Number(lockedPayment.amount || 0) - Number(alreadyRefunded?.total || 0);
      const amountToApply = Math.min(requestedAmount, remaining, Number(lockedPayment.paid_amount || 0));
      if (!amountToApply || amountToApply <= 0) return;

      await conn.query(
        `INSERT INTO payments
           (invoice_id, amount, payment_method, reference, notes, payment_status, paid_at, created_by)
         VALUES (:iid, :amt, 'mercadopago', :ref, :notes, 'refunded', NOW(), :uid)`,
        {
          iid: lockedPayment.invoice_id,
          amt: -amountToApply,
          ref: refundRef,
          notes: reason || 'Reembolso MercadoPago',
          uid: req.user.userId,
        }
      );
      await conn.query(
        `UPDATE invoices
         SET paid_amount = GREATEST(0, paid_amount - :amt),
             status = CASE
               WHEN GREATEST(0, paid_amount - :amt) <= 0 THEN 'refunded'
               ELSE 'partial'
             END,
             updated_at = NOW()
         WHERE id = :iid`,
        { amt: amountToApply, iid: lockedPayment.invoice_id }
      );
      applied = true;
    });

    return R.ok(res, { refundId: refund.id, status: refund.status, applied });
  } catch (e) {
    logBillingError('POST /payments/mp/:mpPaymentId/refund', e, { mpPaymentId: req.params.mpPaymentId, body: req.body });
    next(e);
  }
}

router.post('/preference', requirePerm('payments:create'), body('invoiceId').isInt(), validate, createPreference);
// NOTE: /webhook/preference duplicaba el handler — se eliminó para evitar confusión de rutas
router.get('/webhook/:mpPaymentId', requirePerm('payments:read'), getPayment);
router.get('/:mpPaymentId', requirePerm('payments:read'), getPayment);
router.post('/webhook/:mpPaymentId/refund', requirePerm('payments:refund'), body('amount').optional().isFloat({ min: 0.01 }), validate, refundPayment);
router.post('/:mpPaymentId/refund', requirePerm('payments:refund'), body('amount').optional().isFloat({ min: 0.01 }), validate, refundPayment);

module.exports = { router };
