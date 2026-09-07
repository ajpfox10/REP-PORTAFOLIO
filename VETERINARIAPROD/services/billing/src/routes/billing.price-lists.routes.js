'use strict';

const { Router } = require('express');
const { db, R, httpCacheHeaders, logBillingError } = require('./billing.common');

const router = Router();

router.get('/', httpCacheHeaders({ maxAge: 300, scope: 'private' }), async (req, res, next) => {
  try {
    const rows = await db.query(
      `SELECT pl.*, cur.code AS currency
       FROM price_lists pl
       JOIN currencies cur ON pl.currency_id = cur.id
       WHERE pl.branch_id = :bid AND pl.is_active = TRUE`,
      { bid: req.user.branchId }
    );
    return R.ok(res, rows);
  } catch (e) {
    logBillingError('GET /price-lists', e, { branchId: req.user?.branchId });
    next(e);
  }
});

router.get('/:id/items', httpCacheHeaders({ maxAge: 300, scope: 'private' }), async (req, res, next) => {
  try {
    // IDOR fix: verify price_list belongs to the authenticated user's branch before returning items
    const priceList = await db.queryOne(
      `SELECT id FROM price_lists WHERE id = :pid AND branch_id = :bid AND is_active = TRUE`,
      { pid: req.params.id, bid: req.user.branchId }
    );
    if (!priceList) return R.notFound(res, 'Lista de precios no encontrada');

    const rows = await db.query(
      `SELECT pli.*, sc.name AS service_name, cat.name AS category
       FROM price_list_items pli
       JOIN services_catalog sc ON pli.service_id = sc.id
       LEFT JOIN service_categories cat ON sc.category_id = cat.id
       WHERE pli.price_list_id = :pid AND pli.is_active = TRUE
       ORDER BY cat.name, sc.name`,
      { pid: req.params.id }
    );
    return R.ok(res, rows);
  } catch (e) {
    logBillingError('GET /price-lists/:id/items', e, { priceListId: req.params.id, branchId: req.user?.branchId });
    next(e);
  }
});

module.exports = { router };
