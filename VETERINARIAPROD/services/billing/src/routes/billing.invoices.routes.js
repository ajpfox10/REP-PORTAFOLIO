'use strict';

const { Router } = require('express');
const { body } = require('express-validator');
const { db, R, validate, buildInvoiceNumber, logBillingError } = require('./billing.common');

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const page  = Math.max(parseInt(req.query.page  || '1',  10) || 1,  1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10) || 20, 1), 100);
    const { status, clientId, from, to, search } = req.query;
    const offset = (page - 1) * limit;
    const conds = ['i.branch_id = :bid'];
    const p = { bid: req.user.branchId, limit, offset };
    const VALID_STATUSES = new Set(['draft', 'pending', 'partial', 'paid', 'cancelled', 'refunded', 'overdue']);
    if (status) {
      if (!VALID_STATUSES.has(status)) return R.badRequest(res, 'Estado de factura inválido');
      conds.push('i.status = :status'); p.status = status;
    }
    if (clientId) { conds.push('i.client_id = :clientId'); p.clientId = clientId; }
    if (from) { conds.push('i.issued_date >= :from'); p.from = from; }
    if (to) { conds.push('i.issued_date <= :to'); p.to = to; }
    // T-2: búsqueda server-side por número de factura o nombre de cliente
    if (search) {
      const s = String(search).trim().slice(0, 100);
      conds.push("(i.invoice_number LIKE :search OR CONCAT(cl.first_name,' ',cl.last_name) LIKE :search)");
      p.search = `%${s}%`;
    }

    const where = `WHERE ${conds.join(' AND ')}`;
    const rows = await db.query(
      `SELECT i.id, i.invoice_number, i.status, i.issued_date, i.due_date,
              i.subtotal, i.tax_amount, i.discount_amount, i.total_amount, i.paid_amount,
              cur.code AS currency,
              CONCAT(cl.first_name,' ',cl.last_name) AS client_name,
              p.name AS patient_name
       FROM invoices i
       JOIN clients cl ON i.client_id  = cl.id
       JOIN currencies cur ON i.currency_id = cur.id
       LEFT JOIN patients p ON i.patient_id = p.id
       ${where}
       ORDER BY i.issued_date DESC
       LIMIT :limit OFFSET :offset`,
      p
    );
    const countP = { ...p };
    delete countP.limit;
    delete countP.offset;
    const [{ total }] = await db.query(
      `SELECT COUNT(*) AS total FROM invoices i JOIN clients cl ON i.client_id = cl.id ${where}`,
      countP
    );
    return R.paginated(res, rows, total, page, limit);
  } catch (e) {
    logBillingError('GET /invoices', e, { branchId: req.user?.branchId, query: req.query });
    next(e);
  }
});

router.get('/aging', async (req, res, next) => {
  try {
    const rows = await db.query(
      `SELECT * FROM v_invoice_aging WHERE branch_id = :bid`,
      { bid: req.user.branchId }
    );
    return R.ok(res, rows);
  } catch (e) {
    logBillingError('GET /invoices/aging', e, { branchId: req.user?.branchId });
    next(e);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const inv = await db.queryOne(
      // OT-099: client PII (email, phone, tax_id) omitted — not needed for invoice rendering
      `SELECT i.*, cur.code AS currency,
              CONCAT(cl.first_name,' ',cl.last_name) AS client_name,
              p.name AS patient_name, sp.common_name AS species
       FROM invoices i
       JOIN clients cl ON i.client_id = cl.id
       JOIN currencies cur ON i.currency_id = cur.id
       LEFT JOIN patients p  ON i.patient_id = p.id
       LEFT JOIN species sp  ON p.species_id  = sp.id
       WHERE i.id = :id AND i.branch_id = :bid`,
      { id: req.params.id, bid: req.user.branchId }
    );
    if (!inv) return R.notFound(res);

    const items = await db.query(
      `SELECT ii.*, sc.name AS service_category
       FROM invoice_items ii
       LEFT JOIN services_catalog svc ON ii.service_id = svc.id
       LEFT JOIN service_categories sc ON svc.category_id = sc.id
       WHERE ii.invoice_id = :iid ORDER BY ii.id`,
      { iid: req.params.id }
    );
    const payments = await db.query(
      `SELECT p.* FROM payments p
       JOIN invoices i ON i.id = p.invoice_id
       WHERE p.invoice_id = :iid AND i.branch_id = :bid
       ORDER BY p.paid_at DESC`,
      { iid: req.params.id, bid: req.user.branchId }
    );
    return R.ok(res, { ...inv, items, payments });
  } catch (e) {
    logBillingError('GET /invoices/:id', e, { invoiceId: req.params.id, branchId: req.user?.branchId });
    next(e);
  }
});

router.post('/',
  body('clientId').isInt(),
  body('currencyId').optional().isInt(),
  // BUG-21: prevenir discountPct y taxPct negativos que inflan facturas
  body('items.*.discountPct').optional().isFloat({ min: 0, max: 100 }).withMessage('discountPct debe estar entre 0 y 100'),
  body('items.*.taxPct').optional().isFloat({ min: 0, max: 100 }).withMessage('taxPct debe estar entre 0 y 100'),
  body('items.*.quantity').optional().isFloat({ min: 0.001 }).withMessage('quantity debe ser positivo'),
  body('items.*.unitPrice').optional().isFloat({ min: 0 }).withMessage('unitPrice debe ser >= 0'),
  validate,
  async (req, res, next) => {
    try {
      const { clientId, patientId, appointmentId, currencyId, dueDate, notes, items = [] } = req.body;
      const invoice = await db.transaction(async (conn) => {
        const client = await conn.queryOne(
          `SELECT c.id, c.branch_id, COALESCE(c.organization_id, b.organization_id) AS org_id
           FROM clients c
           LEFT JOIN branches b ON b.id = c.branch_id
           WHERE c.id = :clientId
             AND (c.branch_id = :branchId OR c.organization_id = :orgId OR b.organization_id = :orgId)
           LIMIT 1`,
          { clientId, branchId: req.user.branchId, orgId: req.user.orgId || null }
        );
        if (!client) throw Object.assign(new Error('Cliente fuera del alcance de la sucursal'), { http: 403, code: 'CLIENT_SCOPE_DENIED' });

        if (patientId) {
          const patient = await conn.queryOne(
            `SELECT p.id, p.organization_id
             FROM patients p
             JOIN patient_owners po ON po.patient_id = p.id
             JOIN clients pc ON pc.id = po.client_id
             WHERE p.id = :patientId
               AND po.client_id = :clientId
               AND po.deleted_at IS NULL
               AND pc.branch_id = :branchId
               AND p.organization_id = :orgId
             LIMIT 1`,
            { patientId, clientId, branchId: req.user.branchId, orgId: req.user.orgId }
          );
          if (!patient) throw Object.assign(new Error('Paciente fuera del alcance de la sucursal'), { http: 403, code: 'PATIENT_SCOPE_DENIED' });
        }

        if (appointmentId) {
          const appointment = await conn.queryOne(
            `SELECT id, patient_id, client_id, branch_id
             FROM appointments
             WHERE id = :appointmentId
               AND branch_id = :branchId
             LIMIT 1`,
            { appointmentId, branchId: req.user.branchId }
          );
          if (!appointment) throw Object.assign(new Error('Turno fuera del alcance de la sucursal'), { http: 403, code: 'APPOINTMENT_SCOPE_DENIED' });
          if (appointment.client_id && Number(appointment.client_id) !== Number(clientId)) {
            throw Object.assign(new Error('Turno no pertenece al cliente indicado'), { http: 422, code: 'APPOINTMENT_CLIENT_MISMATCH' });
          }
          if (patientId && appointment.patient_id && Number(appointment.patient_id) !== Number(patientId)) {
            throw Object.assign(new Error('Turno no pertenece al paciente indicado'), { http: 422, code: 'APPOINTMENT_PATIENT_MISMATCH' });
          }
        }

        if (currencyId) {
          const currency = await conn.queryOne(`SELECT id FROM currencies WHERE id = :currencyId`, { currencyId });
          if (!currency) throw Object.assign(new Error('Moneda no encontrada'), { http: 422, code: 'CURRENCY_NOT_FOUND' });
        }

        await conn.query(
          `INSERT INTO invoice_branch_sequences (branch_id, next_seq)
           VALUES (:bid, 1)
           ON DUPLICATE KEY UPDATE next_seq = next_seq + 1`,
          { bid: req.user.branchId }
        );
        const { seq } = await conn.queryOne(
          `SELECT next_seq AS seq
           FROM invoice_branch_sequences
           WHERE branch_id = :bid
           FOR UPDATE`,
          { bid: req.user.branchId }
        );
        const invoiceNumber = buildInvoiceNumber(req.user.branchId, seq);
        // Round each item calculation to 2 decimals before accumulating to prevent float drift
        const r2 = (n) => Math.round(n * 100) / 100;
        const subtotal       = r2(items.reduce((sum, item) => sum + r2(Number(item.quantity || 1) * Number(item.unitPrice || 0)), 0));
        const taxAmount      = r2(items.reduce((sum, item) => sum + r2(Number(item.quantity || 1) * Number(item.unitPrice || 0) * Number(item.taxPct || 0) / 100), 0));
        const discountAmount = r2(items.reduce((sum, item) => sum + r2(Number(item.quantity || 1) * Number(item.unitPrice || 0) * Number(item.discountPct || 0) / 100), 0));
        const totalAmount    = r2(Math.max(0, subtotal + taxAmount - discountAmount));

        const [result] = await conn.query(
          `INSERT INTO invoices
             (branch_id, client_id, patient_id, appointment_id, currency_id,
              invoice_number, status, issued_date, due_date,
              subtotal, tax_amount, discount_amount, total_amount, paid_amount,
              notes, created_by)
           VALUES (:bid, :cid, :pid, :aid, :curr,
                   :number, 'draft', CURDATE(), :due,
                   :subtotal, :tax, :discount, :total, 0,
                   :notes, :uid)`,
          {
            bid: req.user.branchId,
            cid: clientId,
            pid: patientId || null,
            aid: appointmentId || null,
            curr: currencyId || 1,
            number: invoiceNumber,
            due: dueDate || null,
            subtotal,
            tax: taxAmount,
            discount: discountAmount,
            total: totalAmount,
            notes: notes || null,
            uid: req.user.userId,
          }
        );

        for (const item of items) {
          await conn.query(
            `INSERT INTO invoice_items
               (invoice_id, service_id, description, quantity, unit_price, discount_pct, tax_pct, subtotal)
             VALUES (:iid, :sid, :desc, :qty, :price, :disc, :tax, :subtotal)`,
            {
              iid: result.insertId,
              sid: item.serviceId || null,
              desc: item.description,
              qty: item.quantity || 1,
              price: item.unitPrice,
              disc: item.discountPct || 0,
              tax: item.taxPct || 0,
              subtotal: r2(r2(Number(item.quantity || 1) * Number(item.unitPrice || 0)) * (1 - Number(item.discountPct || 0) / 100) + r2(Number(item.quantity || 1) * Number(item.unitPrice || 0) * Number(item.taxPct || 0) / 100)),
            }
          );
        }

        return {
          id: result.insertId,
          invoice_number: invoiceNumber,
          branch_id: req.user.branchId,
          client_id: clientId,
          patient_id: patientId || null,
          appointment_id: appointmentId || null,
          currency_id: currencyId || 1,
          status: 'draft',
          issued_date: new Date().toISOString().slice(0, 10),
          due_date: dueDate || null,
          subtotal,
          tax_amount: taxAmount,
          discount_amount: discountAmount,
          total_amount: totalAmount,
          paid_amount: 0,
          notes: notes || null,
          created_by: req.user.userId,
        };
      });
      return R.created(res, invoice);
    } catch (e) {
      logBillingError('POST /invoices', e, { branchId: req.user?.branchId, body: req.body });
      next(e);
    }
  }
);

router.patch('/:id/pay', async (req, res, next) => {
  try {
    const paymentMethod = req.body.payment_method || req.body.paymentMethod || 'cash';
    const allowed = new Set(['cash', 'credit_card', 'debit_card', 'bank_transfer', 'check', 'crypto', 'other']);
    if (!allowed.has(paymentMethod)) return R.badRequest(res, 'Invalid payment method');

    const payment = await db.transaction(async (conn) => {
      const invoice = await conn.queryOne(
        `SELECT id, total_amount, paid_amount, status
           FROM invoices
          WHERE id = :id AND branch_id = :bid
          FOR UPDATE`,
        { id: req.params.id, bid: req.user.branchId }
      );
      if (!invoice) return null;
      if (invoice.status === 'cancelled') {
        const error = new Error('Cannot pay a cancelled invoice');
        error.http = 409;
        throw error;
      }

      const remaining = Math.max(0, Number(invoice.total_amount || 0) - Number(invoice.paid_amount || 0));
      const requestedAmount = req.body.amount != null ? Number(req.body.amount) : null;
      if (requestedAmount !== null && (isNaN(requestedAmount) || requestedAmount <= 0)) {
        throw Object.assign(new Error('El monto del pago debe ser mayor a cero'), { http: 400 });
      }
      const amount = requestedAmount != null ? Math.min(requestedAmount, remaining) : remaining;
      if (amount <= 0) return { id: invoice.id, status: invoice.status, paid_amount: invoice.paid_amount };

      await conn.query(
        `INSERT INTO payments
           (invoice_id, amount, payment_method, reference, payment_status, notes, paid_at, created_by)
         VALUES (:iid, :amount, :method, :reference, 'completed', :notes, NOW(), :uid)`,
        {
          iid: invoice.id,
          amount,
          method: paymentMethod,
          reference: req.body.reference || null,
          notes: req.body.notes || null,
          uid: req.user.userId,
        }
      );

      const [updateResult] = await conn.query(
        `UPDATE invoices
            SET paid_amount = paid_amount + :amount,
                status = CASE WHEN paid_amount + :amount >= total_amount THEN 'paid' ELSE 'partial' END,
                updated_at = NOW()
          WHERE id = :id AND branch_id = :bid`,
        { amount, id: invoice.id, bid: req.user.branchId }
      );
      if (!updateResult.affectedRows) {
        const err = new Error('No se pudo registrar el pago');
        err.http = 409;
        throw err;
      }

      const newPaid = Number(invoice.paid_amount || 0) + amount;
      const newStatus = newPaid >= Number(invoice.total_amount || 0) ? 'paid' : 'partial';
      return { id: invoice.id, status: newStatus, paid_amount: newPaid };
    });

    if (!payment) return R.notFound(res);
    return R.ok(res, payment);
  } catch (e) {
    logBillingError('PATCH /invoices/:id/pay', e, { invoiceId: req.params.id, branchId: req.user?.branchId, body: req.body });
    next(e);
  }
});

router.patch('/:id/cancel', async (req, res, next) => {
  try {
    // OT-048: facturas con CAE emitido no pueden cancelarse directamente — incumplimiento AFIP
    // Deben anularse mediante nota de crédito (POST /invoices/:id/credit-note)
    const inv = await db.queryOne(
      `SELECT id, afip_cae, status FROM invoices WHERE id = :id AND branch_id = :bid`,
      { id: req.params.id, bid: req.user.branchId }
    );
    if (!inv) return R.notFound(res, 'Factura no encontrada');
    if (inv.afip_cae) {
      return R.error(res, 422, 'Las facturas electrónicas con CAE no pueden cancelarse directamente. Use la nota de crédito AFIP.', null, 'AFIP_CANCEL_BLOCKED');
    }

    // BUG-22: verificar affectedRows para detectar facturas en estado incancelable
    if (['paid', 'refunded', 'cancelled'].includes(inv.status)) {
      return R.error(res, 409, `No se puede cancelar una factura con estado '${inv.status}'`, null, 'INVOICE_STATUS_CONFLICT');
    }
    const [cancelResult] = await db.query(
      `UPDATE invoices SET status = 'cancelled', notes = CONCAT(COALESCE(notes,''), ' [CANCELLED: ', :reason, ']'), updated_at = NOW()
       WHERE id = :id AND branch_id = :bid AND status IN ('draft','pending')`,
      { reason: req.body.reason || 'n/a', id: req.params.id, bid: req.user.branchId }
    );
    if (!cancelResult.affectedRows) return R.conflict(res, 'No se pudo cancelar la factura');
    return R.noContent(res);
  } catch (e) {
    logBillingError('PATCH /invoices/:id/cancel', e, { invoiceId: req.params.id, branchId: req.user?.branchId, body: req.body });
    next(e);
  }
});

module.exports = { router };
