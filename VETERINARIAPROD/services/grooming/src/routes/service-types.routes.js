'use strict';

const { Router } = require('express');
const { body } = require('express-validator');
const { db, R, validate, logGroomingError } = require('../grooming.common');

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const rows = await db.query(
      `SELECT * FROM grooming_service_types
       WHERE is_active = TRUE
         AND (org_id IS NULL OR org_id = :orgId)
       ORDER BY name`,
      { orgId: req.user.orgId }
    );
    return R.ok(res, rows);
  } catch (e) {
    logGroomingError('GET /grooming/service-types', e);
    next(e);
  }
});

router.post('/',
  body('name').notEmpty().isString().trim().isLength({ max: 100 }),
  body('description').optional().isString().trim().isLength({ max: 500 }),
  body('basePriceSmall').optional().isFloat({ min: 0 }),
  body('basePriceMedium').optional().isFloat({ min: 0 }),
  body('basePriceLarge').optional().isFloat({ min: 0 }),
  body('durationMinSmall').optional().isInt({ min: 1, max: 480 }),
  body('durationMinMedium').optional().isInt({ min: 1, max: 480 }),
  body('durationMinLarge').optional().isInt({ min: 1, max: 480 }),
  validate,
  async (req, res, next) => {
    try {
      const { name, description, basePriceSmall, basePriceMedium, basePriceLarge, durationMinSmall, durationMinMedium, durationMinLarge } = req.body;
      const [r] = await db.query(
        `INSERT INTO grooming_service_types
           (org_id, name, description, base_price_small, base_price_medium, base_price_large, duration_min_small, duration_min_medium, duration_min_large)
         VALUES (:orgId,:name,:desc,:ps,:pm,:pl,:ds,:dm,:dl)`,
        {
          orgId: req.user.orgId,
          name, desc: description || null, ps: basePriceSmall || null, pm: basePriceMedium || null, pl: basePriceLarge || null,
          ds: durationMinSmall || null, dm: durationMinMedium || null, dl: durationMinLarge || null,
        }
      );
      return R.created(res, { id: r.insertId });
    } catch (e) { next(e); }
  }
);

module.exports = router;
