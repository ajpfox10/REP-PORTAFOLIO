'use strict';

const { Router } = require('express');
const { db, R, logBranchesError } = require('./branches.common');

const router = Router();

router.get('/inventory/overview', async (req, res, next) => {
  try {
    const rows = await db.query(
      `SELECT ii.name AS item_name, ii.sku,
              b.id AS branch_id, b.name AS branch_name,
              ii.stock_quantity, ii.unit_cost, ii.minimum_stock,
              CASE WHEN ii.stock_quantity <= 0 THEN 'out_of_stock'
                   WHEN ii.stock_quantity <= ii.minimum_stock THEN 'low_stock'
                   ELSE 'ok' END AS stock_status
       FROM inventory_items ii
       JOIN branches b ON ii.branch_id = b.id AND b.organization_id = :orgId
       WHERE b.is_active = TRUE AND ii.is_active = TRUE
       ORDER BY ii.name, b.name`,
      { orgId: req.user.orgId }
    );

    const map = {};
    for (const row of rows) {
      if (!map[row.item_name]) map[row.item_name] = { item_name: row.item_name, sku: row.sku, branches: [] };
      map[row.item_name].branches.push({
        branch_id: row.branch_id,
        branch_name: row.branch_name,
        stock: row.stock_quantity,
        status: row.stock_status,
      });
    }
    return R.ok(res, Object.values(map));
  } catch (e) {
    logBranchesError('GET /branches/inventory/overview', e, { orgId: req.user?.orgId });
    next(e);
  }
});

module.exports = router;
