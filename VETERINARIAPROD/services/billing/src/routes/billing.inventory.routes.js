'use strict';

const { Router } = require('express');
const { body } = require('express-validator');
const { db, R, validate, notDeleted, logBillingError } = require('./billing.common');

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const page  = Math.max(parseInt(req.query.page  || '1',  10) || 1,  1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '30', 10) || 30, 1), 100);
    const { search, itemType, stockStatus } = req.query;
    const offset = (page - 1) * limit;
    const conds = ['ist.branch_id = :bid'];
    const p = { bid: req.user.branchId, limit, offset };
    if (search) { conds.push('(ii.name LIKE :s OR ii.sku LIKE :s)'); p.s = `%${search}%`; }
    if (itemType) { conds.push('ii.item_type = :itemType'); p.itemType = itemType; }
    if (stockStatus === 'low') conds.push('ist.quantity_available <= ist.reorder_point');
    if (stockStatus === 'zero') conds.push('ist.quantity_available = 0');

    const rows = await db.query(
      `SELECT ii.id, ii.sku, ii.name, ii.item_type, ii.unit_cost, ii.sale_price,
              ist.quantity_available, ist.minimum_stock, ist.reorder_point,
              ii.expiry_date, ii.is_active
       FROM inventory_items ii
       JOIN inventory_stock ist ON ist.item_id = ii.id
       WHERE ${conds.join(' AND ')}
       ORDER BY ii.name
       LIMIT :limit OFFSET :offset`,
      p
    );
    return R.ok(res, rows);
  } catch (e) {
    logBillingError('GET /inventory', e, { branchId: req.user?.branchId, query: req.query });
    next(e);
  }
});

const OUTGOING_MOVEMENT_TYPES = new Set(['sale', 'expired', 'loss', 'transfer']);
const INCOMING_MOVEMENT_TYPES = new Set(['purchase', 'adjustment']);

router.post('/movements',
  body('itemId').isInt(),
  body('movementType').isIn(['purchase','sale','adjustment','transfer','expired','loss']),
  body('quantity').isFloat({ min: 0.001 }),
  validate,
  async (req, res, next) => {
    try {
      const { itemId, movementType, quantity, unitCost, reference, notes } = req.body;
      const movementQuantity = Number(quantity);

      // BUG-30: envolver en transacción con FOR UPDATE para evitar race condition y
      // actualizar inventory_stock correctamente en salidas
      const movementId = await db.transaction(async (conn) => {
        // BUG-FIX: verificar que el item pertenece a la branch del usuario (IDOR cross-branch)
        const stock = await conn.queryOne(
          `SELECT ist.item_id, ist.quantity_available FROM inventory_stock ist
           WHERE ist.item_id = :iid AND ist.branch_id = :bid
           FOR UPDATE`,
          { iid: itemId, bid: req.user.branchId }
        );
        if (!stock) {
          const err = new Error('Item de inventario no encontrado en esta sucursal');
          err.http = 404;
          throw err;
        }

        if (OUTGOING_MOVEMENT_TYPES.has(movementType) && Number(stock.quantity_available) < movementQuantity) {
          const err = new Error('Insufficient stock for this movement');
          err.http = 400;
          throw err;
        }

        const [r] = await conn.query(
          `INSERT INTO inventory_movements
             (item_id, branch_id, movement_type, quantity, unit_cost, reference, notes, created_by)
           VALUES (:item, :bid, :type, :qty, :cost, :ref, :notes, :uid)`,
          {
            item: itemId, bid: req.user.branchId, type: movementType,
            qty: movementQuantity, cost: unitCost ?? null, ref: reference || null,
            notes: notes || null, uid: req.user.userId,
          }
        );

        // Actualizar stock disponible según el tipo de movimiento
        if (OUTGOING_MOVEMENT_TYPES.has(movementType)) {
          await conn.query(
            `UPDATE inventory_stock SET quantity_available = GREATEST(0, quantity_available - :qty)
             WHERE item_id = :iid AND branch_id = :bid`,
            { qty: movementQuantity, iid: itemId, bid: req.user.branchId }
          );
        } else if (INCOMING_MOVEMENT_TYPES.has(movementType)) {
          await conn.query(
            `UPDATE inventory_stock SET quantity_available = quantity_available + :qty
             WHERE item_id = :iid AND branch_id = :bid`,
            { qty: movementQuantity, iid: itemId, bid: req.user.branchId }
          );
        }

        return r.insertId;
      });
      return R.created(res, { id: movementId });
    } catch (e) {
      logBillingError('POST /inventory/movements', e, { branchId: req.user?.branchId, body: req.body });
      next(e);
    }
  }
);

router.post('/items',
  body('name').notEmpty(),
  body('itemType').isIn(['medication','supply','food','equipment','vaccine','other']),
  body('salePrice').isFloat({ min: 0 }),
  validate,
  async (req, res, next) => {
    try {
      const { name, sku, itemType, description, unitCost, salePrice, minimumStock, reorderPoint, supplierId, requiresPrescription } = req.body;
      const itemId = await db.transaction(async (conn) => {
        const [r] = await conn.query(
          `INSERT INTO inventory_items (name, sku, item_type, description, unit_cost, sale_price, minimum_stock, requires_prescription, supplier_id, is_active)
           VALUES (:name, :sku, :type, :desc, :cost, :price, :minStock, :rx, :sup, 1)`,
          { name, sku: sku||null, type: itemType, desc: description||null, cost: unitCost||0, price: salePrice, minStock: minimumStock||0, rx: requiresPrescription?1:0, sup: supplierId||null }
        );
        await conn.query(
          `INSERT INTO inventory_stock (item_id, branch_id, quantity_available, minimum_stock, reorder_point)
           VALUES (:iid, :bid, 0, :min, :reorder)`,
          { iid: r.insertId, bid: req.user.branchId, min: minimumStock||0, reorder: reorderPoint||0 }
        );
        return r.insertId;
      });
      return R.created(res, { id: itemId });
    } catch (e) {
      logBillingError('POST /inventory/items', e, { branchId: req.user?.branchId, body: req.body });
      next(e);
    }
  }
);

router.put('/items/:id',
  body('name').notEmpty(),
  validate,
  async (req, res, next) => {
    try {
      const { name, sku, description, unitCost, salePrice, minimumStock, reorderPoint, supplierId, isActive } = req.body;
      // BUG-FIX: verificar que el item pertenece a la branch del usuario (IDOR cross-branch)
      // inventory_items no tiene branch_id propio; la relación es a través de inventory_stock
      const stockOwner = await db.queryOne(
        `SELECT ist.item_id FROM inventory_stock ist
         WHERE ist.item_id = :id AND ist.branch_id = :bid
         LIMIT 1`,
        { id: req.params.id, bid: req.user.branchId }
      );
      if (!stockOwner) return R.notFound(res, 'Item de inventario no encontrado');

      const [updateResult] = await db.query(
        `UPDATE inventory_items SET name=:name, sku=:sku, description=:desc, unit_cost=:cost,
          sale_price=:price, minimum_stock=:min, supplier_id=:sup,
          is_active=:active, updated_at=NOW()
         WHERE id=:id AND ${notDeleted('inventory_items')}`,
        { id: req.params.id, name, sku: sku||null, desc: description||null, cost: unitCost||0, price: salePrice||0, min: minimumStock||0, sup: supplierId||null, active: isActive!==false?1:0 }
      );
      // BUG-FIX: verificar affectedRows para detectar actualizaciones fallidas
      if (!updateResult.affectedRows) return R.notFound(res, 'Item de inventario no encontrado o eliminado');

      if (reorderPoint !== undefined) {
        await db.query(
          `UPDATE inventory_stock SET reorder_point=:rp, minimum_stock=:min WHERE item_id=:id AND branch_id=:bid`,
          { rp: reorderPoint, min: minimumStock||0, id: req.params.id, bid: req.user.branchId }
        );
      }
      return R.noContent(res);
    } catch (e) {
      logBillingError('PUT /inventory/items/:id', e, { itemId: req.params.id, branchId: req.user?.branchId, body: req.body });
      next(e);
    }
  }
);

router.get('/batches', async (req, res, next) => {
  try {
    const { itemId, expiringDays } = req.query;
    // BUG-FIX: aplicar cap en limit para evitar DoS por queries masivas
    const page  = Math.max(parseInt(req.query.page  || '1',  10) || 1,  1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '30', 10) || 30, 1), 100);
    const offset = (page - 1) * limit;
    const conds = ['ib.branch_id = :bid', 'ib.quantity_available > 0'];
    const p = { bid: req.user.branchId, limit, offset };
    if (itemId) { conds.push('ib.item_id = :itemId'); p.itemId = itemId; }
    if (expiringDays) { conds.push('ib.expiry_date <= DATE_ADD(NOW(), INTERVAL :days DAY)'); p.days = expiringDays; }

    const rows = await db.query(
      `SELECT ib.id, ib.lot_number, ib.expiry_date, ib.manufacture_date,
              ib.quantity_received, ib.quantity_available, ib.unit_cost,
              ii.name AS item_name, ii.sku,
              s.name AS supplier_name
       FROM inventory_batches ib
       JOIN inventory_items ii ON ib.item_id = ii.id AND ${notDeleted('ii')}
       LEFT JOIN suppliers s ON ib.supplier_id = s.id AND ${notDeleted('s')}
       WHERE ${conds.join(' AND ')} AND ${notDeleted('ib')}
       ORDER BY ib.expiry_date ASC
       LIMIT :limit OFFSET :offset`,
      p
    );
    return R.ok(res, rows);
  } catch (e) {
    logBillingError('GET /inventory/batches', e, { branchId: req.user?.branchId, query: req.query });
    next(e);
  }
});

router.post('/batches',
  body('itemId').isInt(),
  body('lotNumber').notEmpty(),
  body('quantityReceived').isFloat({ min: 0.001 }),
  validate,
  async (req, res, next) => {
    try {
      const { itemId, lotNumber, expiryDate, manufactureDate, quantityReceived, unitCost, supplierId, notes } = req.body;
      const batchId = await db.transaction(async (conn) => {
        // BUG-FIX: verificar que el item pertenece a la branch del usuario antes de crear el lote (IDOR cross-branch)
        const itemOwner = await conn.queryOne(
          `SELECT ist.item_id FROM inventory_stock ist
           WHERE ist.item_id = :iid AND ist.branch_id = :bid
           FOR UPDATE`,
          { iid: itemId, bid: req.user.branchId }
        );
        if (!itemOwner) {
          const err = new Error('Item de inventario no encontrado en esta sucursal');
          err.http = 404;
          throw err;
        }

        const [r] = await conn.query(
          `INSERT INTO inventory_batches
             (item_id, branch_id, supplier_id, lot_number, manufacture_date, expiry_date,
              quantity_received, quantity_available, unit_cost, notes, created_by)
           VALUES (:iid, :bid, :sup, :lot, :mfg, :exp, :qty, :qty, :cost, :notes, :uid)` ,
          { iid: itemId, bid: req.user.branchId, sup: supplierId||null, lot: lotNumber, mfg: manufactureDate||null, exp: expiryDate||null, qty: quantityReceived, cost: unitCost ?? null, notes: notes||null, uid: req.user.userId }
        );
        await conn.query(
          `UPDATE inventory_stock SET quantity_available = quantity_available + :qty
           WHERE item_id = :iid AND branch_id = :bid`,
          { qty: quantityReceived, iid: itemId, bid: req.user.branchId }
        );
        await conn.query(
          `INSERT INTO inventory_movements (item_id, branch_id, movement_type, quantity, unit_cost, reference, batch_id, created_by)
           VALUES (:iid, :bid, 'purchase', :qty, :cost, :lot, :batchId, :uid)`,
          { iid: itemId, bid: req.user.branchId, qty: quantityReceived, cost: unitCost ?? null, lot: lotNumber, batchId: r.insertId, uid: req.user.userId }
        );
        return r.insertId;
      });
      return R.created(res, { id: batchId });
    } catch (e) {
      logBillingError('POST /inventory/batches', e, { branchId: req.user?.branchId, body: req.body });
      next(e);
    }
  }
);

router.get('/alerts', async (req, res, next) => {
  try {
    const { resolved = 'false' } = req.query;
    const rows = await db.query(
      `SELECT sa.id, sa.alert_type, sa.current_stock, sa.threshold, sa.expiry_date,
              sa.notified, sa.created_at, ii.id AS item_id, ii.name AS item_name, ii.sku
       FROM stock_alerts sa
       JOIN inventory_items ii ON sa.item_id = ii.id AND ${notDeleted('ii')}
       WHERE sa.branch_id = :bid AND sa.resolved = :res AND ${notDeleted('sa')}
       ORDER BY sa.created_at DESC`,
      { bid: req.user.branchId, res: resolved === 'true' ? 1 : 0 }
    );
    return R.ok(res, rows);
  } catch (e) {
    logBillingError('GET /inventory/alerts', e, { branchId: req.user?.branchId, query: req.query });
    next(e);
  }
});

router.patch('/alerts/:id/resolve', async (req, res, next) => {
  try {
    // BUG-FIX: verificar affectedRows para detectar alertas no encontradas o de otra branch
    const [resolveResult] = await db.query(
      `UPDATE stock_alerts
       SET resolved=1, resolved_at=NOW()
       WHERE id=:id AND branch_id=:bid AND resolved = 0 AND ${notDeleted('stock_alerts')}`,
      { id: req.params.id, bid: req.user.branchId }
    );
    if (!resolveResult.affectedRows) return R.notFound(res, 'Alerta no encontrada');
    return R.noContent(res);
  } catch (e) {
    logBillingError('PATCH /inventory/alerts/:id/resolve', e, { alertId: req.params.id, branchId: req.user?.branchId });
    next(e);
  }
});

router.post('/alerts/check', async (req, res, next) => {
  try {
    const { generated } = await checkAndGenerateAlerts(req.user.branchId);
    return R.ok(res, { generated });
  } catch (e) {
    logBillingError('POST /inventory/alerts/check', e, { branchId: req.user?.branchId });
    next(e);
  }
});

async function checkAndGenerateAlerts(branchId) {
  let generated = 0;
  const lowStock = await db.query(
    `SELECT ii.id, ii.name, ist.quantity_available, ist.minimum_stock, ist.reorder_point
     FROM inventory_stock ist
     JOIN inventory_items ii ON ist.item_id = ii.id
     WHERE ist.branch_id = :bid
       AND ii.is_active = 1
       AND ${notDeleted('ii')}
       AND ist.quantity_available <= ist.reorder_point
       AND NOT EXISTS (
         SELECT 1 FROM stock_alerts sa
         WHERE sa.item_id = ii.id AND sa.branch_id = :bid
           AND sa.alert_type IN ('low_stock','out_of_stock') AND sa.resolved = 0
           AND ${notDeleted('sa')}
       )`,
    { bid: branchId }
  );
  for (const item of lowStock) {
    const type = item.quantity_available <= 0 ? 'out_of_stock' : 'low_stock';
    await db.query(
      `INSERT INTO stock_alerts (branch_id, item_id, alert_type, current_stock, threshold)
       VALUES (:bid, :iid, :type, :stock, :threshold)`,
      { bid: branchId, iid: item.id, type, stock: item.quantity_available, threshold: item.reorder_point }
    );
    generated++;
  }
  const expiring = await db.query(
    `SELECT ib.id, ib.item_id, ib.expiry_date, ib.quantity_available, ii.name,
            CASE WHEN ib.expiry_date < NOW() THEN 'expired' ELSE 'expiring_soon' END AS alert_type
     FROM inventory_batches ib
     JOIN inventory_items ii ON ib.item_id = ii.id
     WHERE ib.branch_id = :bid
       AND ib.quantity_available > 0
       AND ${notDeleted('ib')}
       AND ${notDeleted('ii')}
       AND ib.expiry_date IS NOT NULL
       AND ib.expiry_date <= DATE_ADD(NOW(), INTERVAL 30 DAY)
       AND NOT EXISTS (
         SELECT 1 FROM stock_alerts sa
         WHERE sa.item_id = ib.item_id AND sa.branch_id = :bid
           AND sa.alert_type = CASE WHEN ib.expiry_date < NOW() THEN 'expired' ELSE 'expiring_soon' END
           AND sa.expiry_date = ib.expiry_date AND sa.resolved = 0
           AND ${notDeleted('sa')}
       )`,
    { bid: branchId }
  );
  for (const batch of expiring) {
    const type = batch.alert_type;
    if (type === 'expired') {
      await db.query(
        `UPDATE stock_alerts
         SET resolved = 1, resolved_at = NOW()
         WHERE branch_id = :bid AND item_id = :iid AND alert_type = 'expiring_soon'
           AND expiry_date = :exp AND resolved = 0 AND ${notDeleted('stock_alerts')}`,
        { bid: branchId, iid: batch.item_id, exp: batch.expiry_date }
      );
    }
    await db.query(
      `INSERT INTO stock_alerts (branch_id, item_id, alert_type, current_stock, expiry_date)
       VALUES (:bid, :iid, :type, :stock, :exp)`,
      { bid: branchId, iid: batch.item_id, type, stock: batch.quantity_available, exp: batch.expiry_date }
    );
    generated++;
  }
  return { generated };
}

module.exports = { router, checkAndGenerateAlerts };
