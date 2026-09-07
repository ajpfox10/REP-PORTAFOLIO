'use strict';

const { Router } = require('express');
const {
  db,
  R,
  cacheMiddleware,
  httpCacheHeaders,
} = require('./patients.common');

const router = Router();

async function getSpeciesAll(_req, res, next) {
  try {
    let rows;
    try {
      rows = await db.query(
        `SELECT s.*, sc.name AS category FROM species s
         JOIN species_categories sc ON s.category_id = sc.id
         WHERE s.is_active = TRUE ORDER BY sc.name, s.common_name`
      );
    } catch (err) {
      const msg = String(err?.message || '');
      const isSchemaDrift = /Unknown column|doesn't exist|ER_BAD_FIELD_ERROR|ER_NO_SUCH_TABLE/i.test(msg);
      if (!isSchemaDrift) throw err;

      rows = await db.query(
        `SELECT s.*, COALESCE(sc.display_name, sc.name) AS category
         FROM species s
         JOIN species_categories sc ON s.category_id = sc.id
         WHERE COALESCE(s.active, 1) = TRUE
         ORDER BY category, s.common_name`
      );
    }
    return R.ok(res, rows);
  } catch (e) { next(e); }
}

async function getBreedsAll(req, res, next) {
  try {
    const { speciesId } = req.query;
    const where = speciesId ? 'WHERE species_id = :sid' : '';
    const rows = await db.query(
      `SELECT * FROM breeds ${where} ORDER BY name`,
      speciesId ? { sid: speciesId } : {}
    );
    return R.ok(res, rows);
  } catch (e) { next(e); }
}

const getSpeciesAllMiddleware = [
  httpCacheHeaders({ maxAge: 600, scope: 'public' }),
  cacheMiddleware(600, () => 'ref:species:all'),
  getSpeciesAll,
];

const getBreedsAllMiddleware = [
  httpCacheHeaders({ maxAge: 600, scope: 'public' }),
  cacheMiddleware(600, (req) => `ref:breeds:${req.query.speciesId || 'all'}`),
  getBreedsAll,
];

router.get('/species/all', ...getSpeciesAllMiddleware);
router.get('/breeds/all', ...getBreedsAllMiddleware);
router.get('/breeds', ...getBreedsAllMiddleware);

module.exports = {
  router,
  getSpeciesAllMiddleware,
  getBreedsAllMiddleware,
};
