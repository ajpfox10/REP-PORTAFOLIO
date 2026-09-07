'use strict';

const { Router } = require('express');
const { body } = require('express-validator');
const { db, R, validate, notDeleted, logBillingError } = require('./billing.common');

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const page  = Math.max(parseInt(req.query.page  || '1',  10) || 1,  1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10) || 20, 1), 100);
    const { status, supplierId } = req.query;
    const offset = (page - 1) * limit;
    const conds = ['po.branch_id = :bid'];
    const p = { bid: req.user.branchId, limit, offset };
    if (status) { conds.push('po.status = :status'); p.status = status; }
    if (supplierId) { conds.push('po.supplier_id = :supplierId'); p.supplierId = supplierId; }

    const rows = await db.query(
      `SELECT po.id, po.po_number, po.status, po.ordered_date, po.expected_date,
              po.received_date, po.total_amount, s.name AS supplier_name, po.created_at
       FROM purchase_orders po
       JOIN suppliers s ON po.supplier_id = s.id AND ${notDeleted('s')}
       WHERE ${conds.join(' AND ')} AND ${notDeleted('po')}
       ORDER BY po.created_at DESC
       LIMIT :limit OFFSET :offset`,
      p
    );
    return R.ok(res, rows);
  } catch (e) {
    logBillingError('GET /purchase-orders', e, { branchId: req.user?.branchId, query: req.query });
    next(e);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const po = await db.queryOne(
      `SELECT po.*, s.name AS supplier_name, s.email AS supplier_email, s.phone AS supplier_phone
       FROM purchase_orders po
       JOIN suppliers s ON po.supplier_id = s.id AND ${notDeleted('s')}
       WHERE po.id = :id AND po.branch_id = :bid AND ${notDeleted('po')}`,
      { id: req.params.id, bid: req.user.branchId }
    );
    if (!po) return R.notFound(res, 'Orden de compra no encontrada');
    const items = await db.query(
      `SELECT poi.*, ii.name AS item_name, ii.sku
       FROM purchase_order_items poi
       JOIN inventory_items ii ON poi.item_id = ii.id AND ${notDeleted('ii')}
       WHERE poi.purchase_order_id = :pid AND ${notDeleted('poi')}`,
      { pid: po.id }
    );
    return R.ok(res, { ...po, items });
  } catch (e) {
    logBillingError('GET /purchase-orders/:id', e, { purchaseOrderId: req.params.id, branchId: req.user?.branchId });
    next(e);
  }
});

router.post('/',
  body('supplierId').isInt({ min: 1 }),
  body('items').isArray({ min: 1 }),
  body('items.*.itemId').isInt({ min: 1 }),
  body('items.*.quantity').isFloat({ min: 0.001 }),
  body('items.*.unitCost').isFloat({ min: 0 }),
  validate,
  async (req, res, next) => {
    try {
      const { supplierId, items, orderedDate, expectedDate, notes } = req.body;

      // Verify supplier belongs to org to prevent IDOR across organizations
      const supplier = await db.queryOne(
        `SELECT id FROM suppliers WHERE id = :sid AND org_id = :oid AND is_active = 1 AND deleted_at IS NULL`,
        { sid: supplierId, oid: req.user.orgId }
      );
      if (!supplier) return R.notFound(res, 'Proveedor no encontrado');

      const r2 = (n) => Math.round(n * 100) / 100;
      const subtotal = r2(items.reduce((s, i) => s + r2(Number(i.quantity) * Number(i.unitCost)), 0));

      const { insertId, poNumber } = await db.transaction(async (conn) => {
        for (const itemId of new Set(items.map(item => Number(item.itemId)))) {
          const itemOwner = await conn.queryOne(
            `SELECT ist.item_id
             FROM inventory_stock ist
             JOIN inventory_items ii ON ii.id = ist.item_id AND ${notDeleted('ii')}
             WHERE ist.item_id = :itemId AND ist.branch_id = :branchId`,
            { itemId, branchId: req.user.branchId }
          );
          if (!itemOwner) {
            const err = new Error('Item de inventario no encontrado en esta sucursal');
            err.http = 404;
            throw err;
          }
        }

        const [{ count }] = await conn.query(
          `SELECT COUNT(*)+1 AS count FROM purchase_orders WHERE branch_id=:bid FOR UPDATE`,
          { bid: req.user.branchId }
        );
        const poNum = `PO-${String(count).padStart(5, '0')}`;
        const [row] = await conn.query(
          `INSERT INTO purchase_orders (branch_id, supplier_id, po_number, status, ordered_date, expected_date, subtotal, total_amount, notes, created_by)
           VALUES (:bid, :sup, :poNum, 'draft', :ordered, :expected, :sub, :total, :notes, :uid)`,
          { bid: req.user.branchId, sup: supplierId, poNum, ordered: orderedDate||null, expected: expectedDate||null, sub: subtotal, total: subtotal, notes: notes||null, uid: req.user.userId }
        );
        for (const item of items) {
          await conn.query(
            `INSERT INTO purchase_order_items (purchase_order_id, item_id, quantity_ordered, unit_cost, lot_number, expiry_date, notes)
             VALUES (:poid, :iid, :qty, :cost, :lot, :exp, :notes)`,
            { poid: row.insertId, iid: item.itemId, qty: item.quantity, cost: item.unitCost, lot: item.lotNumber||null, exp: item.expiryDate||null, notes: item.notes||null }
          );
        }
        return { insertId: row.insertId, poNumber: poNum };
      });

      return R.created(res, { id: insertId, poNumber });
    } catch (e) {
      logBillingError('POST /purchase-orders', e, { branchId: req.user?.branchId, body: req.body });
      next(e);
    }
  }
);

router.patch('/:id/send', async (req, res, next) => {
  try {
    const po = await db.queryOne(
      `SELECT po.*, s.email
       FROM purchase_orders po
       JOIN suppliers s ON po.supplier_id = s.id AND ${notDeleted('s')}
       WHERE po.id = :id AND po.branch_id = :bid AND ${notDeleted('po')}`,
      { id: req.params.id, bid: req.user.branchId }
    );
    if (!po) return R.notFound(res, 'OC no encontrada');
    if (po.status !== 'draft') return R.conflict(res, `No se puede enviar una OC en estado '${po.status}'`);

    await db.query(
      `UPDATE purchase_orders SET status='sent', ordered_date=COALESCE(ordered_date, CURDATE()), updated_at=NOW() WHERE id=:id`,
      { id: po.id }
    );

    if (po.email) {
      const { send } = require('../../../../shared/email');
      send({ to: po.email, subject: `Nueva orden de compra ${po.po_number}`, html: `<p>Se ha emitido la orden de compra <b>${po.po_number}</b>. Por favor confirme recepción.</p>` }).catch(() => {});
    }

    return R.ok(res, { message: 'OC enviada al proveedor' });
  } catch (e) {
    logBillingError('PATCH /purchase-orders/:id/send', e, { purchaseOrderId: req.params.id, branchId: req.user?.branchId });
    next(e);
  }
});

router.post('/:id/receive',
  body('items').isArray({ min: 1 }),
  body('items.*.poItemId').isInt({ min: 1 }),
  body('items.*.quantityReceived').isFloat({ min: 0.001 }),
  validate,
  async (req, res, next) => {
    try {
      const { items } = req.body;

      await db.transaction(async (conn) => {
        const po = await conn.queryOne(
          `SELECT * FROM purchase_orders
           WHERE id=:id AND branch_id=:bid AND status IN ('sent','partial') AND ${notDeleted('purchase_orders')}
           FOR UPDATE`,
          { id: req.params.id, bid: req.user.branchId }
        );
        if (!po) {
          const err = new Error('OC no encontrada o no está en estado enviada');
          err.http = 404;
          throw err;
        }

        for (const item of items) {
          const poi = await conn.queryOne(
            `SELECT * FROM purchase_order_items
             WHERE id=:id AND purchase_order_id=:poid AND deleted_at IS NULL
             FOR UPDATE`,
            { id: item.poItemId, poid: po.id }
          );
          if (!poi) {
            const err = new Error('Item de orden de compra no encontrado');
            err.http = 404;
            throw err;
          }

          const qtyReceiving = Math.min(item.quantityReceived, poi.quantity_ordered - poi.quantity_received);
          if (qtyReceiving <= 0) continue;

          const stock = await conn.queryOne(
            `SELECT item_id FROM inventory_stock
             WHERE item_id = :itemId AND branch_id = :branchId
             FOR UPDATE`,
            { itemId: poi.item_id, branchId: req.user.branchId }
          );
          if (!stock) {
            const err = new Error('Item de inventario no encontrado en esta sucursal');
            err.http = 409;
            throw err;
          }

          await conn.execute(
            `UPDATE purchase_order_items SET quantity_received = quantity_received + ?, lot_number=COALESCE(?,lot_number), expiry_date=COALESCE(?,expiry_date) WHERE id=?`,
            [qtyReceiving, item.lotNumber||null, item.expiryDate||null, poi.id]
          );

          const [batchResult] = await conn.execute(
            `INSERT INTO inventory_batches (item_id, branch_id, supplier_id, lot_number, expiry_date, quantity_received, quantity_available, unit_cost, purchase_order_id, created_by)
             VALUES (?,?,?,?,?,?,?,?,?,?)`,
            [poi.item_id, req.user.branchId, po.supplier_id, item.lotNumber||poi.lot_number||'SIN-LOTE', item.expiryDate||poi.expiry_date||null, qtyReceiving, qtyReceiving, poi.unit_cost, po.id, req.user.userId]
          );

          await conn.execute(
            `UPDATE inventory_stock SET quantity_available = quantity_available + ? WHERE item_id=? AND branch_id=?`,
            [qtyReceiving, poi.item_id, req.user.branchId]
          );

          await conn.execute(
            `INSERT INTO inventory_movements (item_id, branch_id, movement_type, quantity, unit_cost, reference, batch_id, created_by)
             VALUES (?,?,'purchase',?,?,?,?,?)`,
            [poi.item_id, req.user.branchId, qtyReceiving, poi.unit_cost, po.po_number, batchResult.insertId, req.user.userId]
          );

          await conn.execute(
            `UPDATE stock_alerts sa
             JOIN inventory_stock ist ON ist.item_id = sa.item_id AND ist.branch_id = sa.branch_id
             SET sa.resolved=1, sa.resolved_at=NOW()
             WHERE sa.branch_id=? AND sa.item_id=? AND sa.resolved=0
               AND sa.alert_type IN ('low_stock','out_of_stock')
               AND sa.deleted_at IS NULL
               AND ist.quantity_available > ist.reorder_point`,
            [req.user.branchId, poi.item_id]
          );
        }

        const [pending] = await conn.execute(
          `SELECT COUNT(*) AS c FROM purchase_order_items
           WHERE purchase_order_id=? AND quantity_received < quantity_ordered AND deleted_at IS NULL`,
          [po.id]
        );
        const newStatus = pending[0].c > 0 ? 'partial' : 'received';
        await conn.execute(
          `UPDATE purchase_orders SET status=?, received_date=COALESCE(received_date, CURDATE()), updated_at=NOW() WHERE id=?`,
          [newStatus, po.id]
        );

      });

      return R.ok(res, { message: 'Mercadería recibida correctamente' });
    } catch (e) {
      logBillingError('POST /purchase-orders/:id/receive', e, { purchaseOrderId: req.params.id, branchId: req.user?.branchId, body: req.body });
      next(e);
    }
  }
);

router.patch('/:id/cancel', async (req, res, next) => {
  try {
    const [result] = await db.query(
      `UPDATE purchase_orders SET status='cancelled', updated_at=NOW()
       WHERE id=:id AND branch_id=:bid AND status IN ('draft','sent')`,
      { id: req.params.id, bid: req.user.branchId }
    );
    if (!result.affectedRows) return R.conflict(res, 'No se puede cancelar esta OC');
    return R.noContent(res);
  } catch (e) {
    logBillingError('PATCH /purchase-orders/:id/cancel', e, { purchaseOrderId: req.params.id, branchId: req.user?.branchId });
    next(e);
  }
});

module.exports = { router };
