'use strict';

const { Router } = require('express');
const { db, R } = require('./_common');

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const rows = await db.query(
      `SELECT * FROM v_tele_vet_stats WHERE branch_id = :bid ORDER BY total_sessions DESC`,
      { bid: req.user.branchId }
    );
    return R.ok(res, rows);
  } catch (e) { next(e); }
});

module.exports = router;
