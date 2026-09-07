'use strict';

const { Router } = require('express');
const { db, R, logLabError } = require('./lab.common');

const router = Router();

router.get('/tests', async (req, res, next) => {
  try {
    const { categoryId, search } = req.query;
    const conds = ['lt.is_active = TRUE'];
    const p = {};
    if (categoryId) { conds.push('lt.category_id = :catId'); p.catId = categoryId; }
    if (search) { conds.push('(lt.name LIKE :s OR lt.code LIKE :s)'); p.s = `%${search}%`; }

    const rows = await db.query(
      `SELECT lt.id, lt.name, lt.code, lt.turnaround_hours, lt.price,
              ltc.name AS category
         FROM lab_tests lt
         JOIN lab_test_categories ltc ON lt.category_id = ltc.id
        WHERE ${conds.join(' AND ')}
        ORDER BY ltc.name, lt.name`,
      p
    );
    return R.ok(res, rows);
  } catch (e) {
    logLabError('GET /lab/tests', e, { query: req.query });
    next(e);
  }
});

router.get('/panels', async (req, res, next) => {
  try {
    const rows = await db.query(
      `SELECT ltp.id, ltp.name, ltp.description, ltp.price,
              GROUP_CONCAT(lt.name ORDER BY lt.name SEPARATOR ', ') AS tests_included
         FROM lab_test_panels ltp
         JOIN lab_panel_tests lpt ON lpt.panel_id = ltp.id
         JOIN lab_tests lt ON lpt.lab_test_id = lt.id
        WHERE ltp.is_active = TRUE
        GROUP BY ltp.id
        ORDER BY ltp.name`
    );
    return R.ok(res, rows);
  } catch (e) {
    logLabError('GET /lab/panels', e, {});
    next(e);
  }
});

module.exports = { router };
