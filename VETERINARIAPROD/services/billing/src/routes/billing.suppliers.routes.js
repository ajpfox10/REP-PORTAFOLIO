'use strict';

const { Router } = require('express');
const { body } = require('express-validator');
const { db, R, validate, notDeleted, logBillingError } = require('./billing.common');

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const rows = await db.query(
      `SELECT * FROM suppliers
       WHERE org_id = :oid AND is_active = 1 AND ${notDeleted('suppliers')}
       ORDER BY name`,
      { oid: req.user.orgId }
    );
    return R.ok(res, rows);
  } catch (e) {
    logBillingError('GET /suppliers', e, { orgId: req.user?.orgId });
    next(e);
  }
});

router.post('/',
  body('name').notEmpty().isLength({ max: 120 }),
  body('email').optional().isEmail(),
  validate,
  async (req, res, next) => {
    try {
      const { name, taxId, contactName, email, phone, address, paymentTerms = 30, notes } = req.body;
      const [result] = await db.query(
        `INSERT INTO suppliers (org_id, name, tax_id, contact_name, email, phone, address, payment_terms, notes)
         VALUES (:oid, :name, :taxId, :contact, :email, :phone, :address, :terms, :notes)`,
        { oid: req.user.orgId, name, taxId: taxId||null, contact: contactName||null, email: email||null, phone: phone||null, address: address||null, terms: paymentTerms, notes: notes||null }
      );
      return R.created(res, { id: result.insertId });
    } catch (e) {
      logBillingError('POST /suppliers', e, { orgId: req.user?.orgId, body: req.body });
      next(e);
    }
  }
);

router.put('/:id',
  body('name').notEmpty().isLength({ max: 120 }),
  body('email').optional({ nullable: true, checkFalsy: true }).isEmail(),
  validate,
  async (req, res, next) => {
    try {
      const { name, taxId, contactName, email, phone, address, paymentTerms, notes } = req.body;
      const [result] = await db.query(
        `UPDATE suppliers SET name=:name, tax_id=:taxId, contact_name=:contact, email=:email,
          phone=:phone, address=:address, payment_terms=:terms, notes=:notes, updated_at=NOW()
         WHERE id=:id AND org_id=:oid AND ${notDeleted('suppliers')}`,
        { id: req.params.id, oid: req.user.orgId, name, taxId: taxId||null, contact: contactName||null, email: email||null, phone: phone||null, address: address||null, terms: paymentTerms||30, notes: notes||null }
      );
      if (!result.affectedRows) return R.notFound(res, 'Proveedor no encontrado');
      return R.noContent(res);
    } catch (e) {
      logBillingError('PUT /suppliers/:id', e, { supplierId: req.params.id, orgId: req.user?.orgId, body: req.body });
      next(e);
    }
  }
);

router.delete('/:id', async (req, res, next) => {
  try {
    const activePOs = await db.queryOne(
      `SELECT COUNT(*) AS cnt FROM purchase_orders WHERE supplier_id = :id AND status IN ('draft','sent','partial') AND deleted_at IS NULL`,
      { id: req.params.id }
    );
    if (activePOs?.cnt > 0) return R.conflict(res, 'El proveedor tiene órdenes de compra activas');

    const [result] = await db.query(
      `UPDATE suppliers SET is_active=0, deleted_at=NOW(), updated_at=NOW()
       WHERE id=:id AND org_id=:oid AND ${notDeleted('suppliers')}`,
      { id: req.params.id, oid: req.user.orgId }
    );
    if (!result.affectedRows) return R.notFound(res, 'Proveedor no encontrado');
    return R.noContent(res);
  } catch (e) {
    logBillingError('DELETE /suppliers/:id', e, { supplierId: req.params.id, orgId: req.user?.orgId });
    next(e);
  }
});

module.exports = { router };
