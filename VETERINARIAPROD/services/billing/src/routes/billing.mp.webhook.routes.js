'use strict';

const { Router } = require('express');
const { db, mp, enqueue, eventBus, logBillingError } = require('./billing.common');
const R = require('../../../../shared/response');
const { createLogger } = require('../../../../shared/logger');

const router = Router();
const log = createLogger('billing-mp-webhook');

router.post('/', async (req, res, next) => {
  try {
    const xSig = req.headers['x-signature'] || '';
    const xReqId = req.headers['x-request-id'] || req.headers['x-idempotency-key'] || '';
    const dataId = req.query['data.id'] || req.body?.data?.id || '';

    if (!mp.validateWebhookSignature(xSig, xReqId, dataId)) {
      return R.error(res, 401, 'Firma inválida', null, 'AUTH_012');
    }

    const type = req.body?.type || req.query?.type;
    if (type !== 'payment') return res.status(200).json({ received: true });

    const mpPaymentId = req.body?.data?.id || req.query?.['data.id'];
    if (!mpPaymentId) return res.status(200).json({ received: true });

    const paymentData = await mp.getPayment(mpPaymentId);
    const status = mp.mapMpStatus(paymentData.status);

    const extRef = paymentData.external_reference || '';
    const invMatch = extRef.match(/^inv:(\d+)(?::org:(\d+))?(?::branch:(\d+))?$/);
    if (!invMatch) return res.status(200).json({ received: true });

    const invoiceId = parseInt(invMatch[1], 10);
    const extOrgId = invMatch[2] ? parseInt(invMatch[2], 10) : null;
    const extBranchId = invMatch[3] ? parseInt(invMatch[3], 10) : null;

    if (status === 'completed') {
      let appliedPayment = null;
      await db.transaction(async (conn) => {
        // OT-040: idempotencia — evitar double-charge si el webhook llega dos veces
        const existing = await conn.queryOne(
          `SELECT id FROM payments WHERE mp_payment_id = :mpid LIMIT 1`,
          { mpid: String(mpPaymentId) }
        );
        if (existing) return;

        const invoice = await conn.queryOne(
          `SELECT i.id, i.branch_id, b.organization_id AS org_id,
                  i.total_amount, i.paid_amount, i.status, cur.code AS currency
           FROM invoices i
           JOIN branches b ON b.id = i.branch_id
           JOIN currencies cur ON cur.id = i.currency_id
           WHERE i.id = :id
           FOR UPDATE`,
          { id: invoiceId }
        );
        if (!invoice) return;
        if ((extOrgId && Number(invoice.org_id) !== extOrgId) || (extBranchId && Number(invoice.branch_id) !== extBranchId)) {
          log.warn('MP webhook: external_reference tenant mismatch', {
            invoiceId,
            mpPaymentId,
            extOrgId,
            extBranchId,
            invoiceOrgId: invoice.org_id,
            invoiceBranchId: invoice.branch_id,
          });
          return;
        }
        if (['paid', 'cancelled', 'refunded'].includes(invoice.status)) {
          log.warn('MP webhook: ignoring payment for closed invoice', { invoiceId, mpPaymentId, status: invoice.status });
          return;
        }

        // OT-041: verificar que el monto acreditado sea razonable
        const receivedAmount = Number(paymentData.transaction_amount);
        if (!receivedAmount || receivedAmount <= 0) {
          log.error('MP webhook: invalid transaction_amount', { invoiceId, mpPaymentId, receivedAmount });
          return;
        }
        const invoiceCurrency = (invoice.currency || 'ARS').toUpperCase();
        const paymentCurrency = (paymentData.currency_id || '').toUpperCase();
        if (paymentCurrency && paymentCurrency !== invoiceCurrency) {
          log.error('MP webhook: currency mismatch', { invoiceId, mpPaymentId, invoiceCurrency, paymentCurrency });
          return;
        }
        const balance = Number(invoice.total_amount || 0) - Number(invoice.paid_amount || 0);
        if (receivedAmount > balance) {
          log.warn('MP webhook: ignoring overpayment', {
            invoiceId, mpPaymentId, received: receivedAmount, balance,
          });
          return;
        }

        await conn.query(
          `INSERT INTO payments
             (invoice_id, amount, payment_method, reference, mp_payment_id, payment_status, notes, paid_at, created_by)
           VALUES (:iid, :amount, 'mercadopago', :reference, :mpid, 'completed', :notes, NOW(), NULL)`,
          {
            iid: invoiceId,
            amount: receivedAmount,
            reference: String(mpPaymentId),
            mpid: String(mpPaymentId),
            notes: `MercadoPago - ${paymentData.payment_type_id}`,
          }
        );

        await conn.query(
          `UPDATE invoices
           SET paid_amount = paid_amount + :amount,
               status = CASE WHEN paid_amount + :amount >= total_amount THEN 'paid' ELSE 'partial' END,
               updated_at = NOW()
           WHERE id = :id`,
          { amount: receivedAmount, id: invoiceId }
        );
        appliedPayment = { invoiceId, mpPaymentId, amount: receivedAmount };
      });

      if (appliedPayment) {
        enqueue({ event: 'payment.approved', payload: appliedPayment }).catch((err) => {
          log.warn('MP webhook enqueue failed', { error: err.message, invoiceId, mpPaymentId });
        });
        eventBus.publish('billing.payment.approved', appliedPayment).catch((err) => {
          log.warn('MP webhook event publish failed', { error: err.message, invoiceId, mpPaymentId });
        });
      }
    }

    if (status === 'refunded') {
      let appliedRefund = null;
      await db.transaction(async (conn) => {
        const invoice = await conn.queryOne(
          `SELECT i.id, i.branch_id, b.organization_id AS org_id, i.paid_amount
           FROM invoices i
           JOIN branches b ON b.id = i.branch_id
           WHERE i.id = :id
           FOR UPDATE`,
          { id: invoiceId }
        );
        if (!invoice) return;
        if ((extOrgId && Number(invoice.org_id) !== extOrgId) || (extBranchId && Number(invoice.branch_id) !== extBranchId)) {
          log.warn('MP refund webhook: external_reference tenant mismatch', { invoiceId, mpPaymentId, extOrgId, extBranchId });
          return;
        }

        const originalPayment = await conn.queryOne(
          `SELECT id, amount
           FROM payments
           WHERE mp_payment_id = :mpid
             AND invoice_id = :invoiceId
             AND amount > 0
           LIMIT 1`,
          { mpid: String(mpPaymentId), invoiceId }
        );
        if (!originalPayment) {
          log.warn('MP refund webhook: original payment not found', { invoiceId, mpPaymentId });
          return;
        }

        const mpRefunds = Array.isArray(paymentData.refunds) ? paymentData.refunds : [];
        const totalRefundedByMp = Number(
          paymentData.transaction_amount_refunded
          || mpRefunds.reduce((sum, refund) => sum + Number(refund.amount || 0), 0)
          || paymentData.transaction_amount
          || originalPayment.amount
        );
        if (!totalRefundedByMp || totalRefundedByMp <= 0) {
          log.warn('MP refund webhook: invalid refund amount', { invoiceId, mpPaymentId, totalRefundedByMp });
          return;
        }

        const refundId = mpRefunds[mpRefunds.length - 1]?.id || 'full';
        const refundRef = `refund:${mpPaymentId}:${refundId}`;
        const existingRefund = await conn.queryOne(
          `SELECT id FROM payments WHERE reference = :ref AND payment_status = 'refunded' LIMIT 1`,
          { ref: refundRef }
        );
        if (existingRefund) return;

        const refunded = await conn.queryOne(
          `SELECT COALESCE(SUM(ABS(amount)), 0) AS total
           FROM payments
           WHERE invoice_id = :invoiceId
             AND payment_method = 'mercadopago'
             AND payment_status = 'refunded'
             AND reference LIKE :prefix`,
          { invoiceId, prefix: `refund:${mpPaymentId}:%` }
        );
        const remainingRefundable = Number(originalPayment.amount || 0) - Number(refunded?.total || 0);
        const deltaFromWebhook = totalRefundedByMp - Number(refunded?.total || 0);
        const amountToApply = Math.min(deltaFromWebhook, remainingRefundable, Number(invoice.paid_amount || 0));
        if (!amountToApply || amountToApply <= 0) return;

        await conn.query(
          `INSERT INTO payments
             (invoice_id, amount, payment_method, reference, payment_status, notes, paid_at, created_by)
           VALUES (:iid, :amount, 'mercadopago', :reference, 'refunded', :notes, NOW(), NULL)`,
          {
            iid: invoiceId,
            amount: -amountToApply,
            reference: refundRef,
            notes: 'Reembolso MercadoPago webhook',
          }
        );

        await conn.query(
          `UPDATE invoices
           SET paid_amount = GREATEST(0, paid_amount - :amount),
               status = CASE
                 WHEN GREATEST(0, paid_amount - :amount) <= 0 THEN 'refunded'
                 ELSE 'partial'
               END,
               updated_at = NOW()
           WHERE id = :id`,
          { id: invoiceId, amount: amountToApply }
        );
        appliedRefund = { invoiceId, mpPaymentId, amount: amountToApply, refundRef };
      });
      if (appliedRefund) {
        enqueue({ event: 'payment.refunded', payload: appliedRefund }).catch((err) => {
          log.warn('MP webhook enqueue failed', { error: err.message, invoiceId, mpPaymentId });
        });
        eventBus.publish('billing.payment.refunded', appliedRefund).catch((err) => {
          log.warn('MP webhook event publish failed', { error: err.message, invoiceId, mpPaymentId });
        });
      }
    }

    return res.status(200).json({ received: true });
  } catch (e) {
    logBillingError('POST /payments/mp/webhook', e, { body: req.body, query: req.query });
    next(e);
  }
});

module.exports = { router };
