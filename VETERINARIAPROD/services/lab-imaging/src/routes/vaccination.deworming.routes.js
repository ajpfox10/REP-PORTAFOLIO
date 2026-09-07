'use strict';

const { Router } = require('express');
const { body } = require('express-validator');
const {
  R, validate, getRows, getInsertResult, resolveBranchFromPatient, logVaccinationError,
} = require('./vaccination.common');

const router = Router();

const getDeworming = [async (req, res, next) => {
  try {
    const { patientId } = req.query;
    const safePage  = Math.max(1, parseInt(req.query.page  || 1, 10));
    const safeLimit = Math.min(Math.max(1, parseInt(req.query.limit || 30, 10)), 100);
    const offset = (safePage - 1) * safeLimit;

    let branchId = req.user?.branchId || null;

    if (!branchId && patientId) {
      const resolved = await resolveBranchFromPatient(req, patientId);
      if (resolved.error) return R.badRequest(res, resolved.error);
      branchId = resolved.branchId;
    }

    if (!branchId) {
      return R.badRequest(res, 'No se pudo determinar la sucursal');
    }

    const conds = ['dr.branch_id = :bid'];
    const p = {
      bid: branchId,
      limit: safeLimit,
      offset,
    };

    if (patientId) {
      conds.push('dr.patient_id = :pid');
      p.pid = patientId;
    }

    const rows = await getRows(
      `SELECT dr.id, dr.deworming_date, dr.next_due_date, dr.weight_at_treatment,
              dr.dose_administered, dr.notes,
              ap.name AS product_name, ap.parasite_type, ap.active_ingredient,
              p.name AS patient_name, sp.common_name AS species,
              CONCAT(u.first_name,' ',u.last_name) AS administered_by
       FROM deworming_records dr
       JOIN antiparasitic_products ap ON dr.product_id = ap.id
       JOIN patients p                ON dr.patient_id = p.id
       JOIN species sp                ON p.species_id = sp.id
       JOIN users u                   ON dr.administered_by = u.id
       WHERE ${conds.join(' AND ')}
       ORDER BY dr.deworming_date DESC
       LIMIT :limit OFFSET :offset`,
      p
    );

    return R.ok(res, rows);
  } catch (e) {
    logVaccinationError('GET /vaccinations/deworming', e, { branchId: req.user?.branchId, query: req.query });
    next(e);
  }
}];

const getDewormingAlerts = [async (req, res, next) => {
  try {
    const branchId = req.user?.branchId || null;

    if (!branchId) {
      return R.badRequest(res, 'No se pudo determinar la sucursal');
    }

    const rows = await getRows(
      `SELECT * FROM v_deworming_alerts WHERE branch_id = :bid ORDER BY next_due_date`,
      { bid: branchId }
    );

    return R.ok(res, rows);
  } catch (e) {
    logVaccinationError('GET /vaccinations/deworming/alerts', e, { branchId: req.user?.branchId });
    next(e);
  }
}];

const MAX_DEWORMING_NEXT_DUE_YEARS = 5;

const postDeworming = [
  body('patientId').isInt(),
  body('productId').isInt(),
  body('dewormingDate').isISO8601().custom((val) => {
    const d = new Date(val);
    const now = new Date();
    now.setHours(23, 59, 59, 999);
    if (d > now) throw new Error('La fecha de desparasitación no puede ser futura');
    return true;
  }),
  body('nextDueDate').optional().isISO8601().custom((val) => {
    const d = new Date(val);
    const maxFuture = new Date();
    maxFuture.setFullYear(maxFuture.getFullYear() + MAX_DEWORMING_NEXT_DUE_YEARS);
    if (d > maxFuture) throw new Error(`La próxima fecha no puede ser más de ${MAX_DEWORMING_NEXT_DUE_YEARS} años en el futuro`);
    return true;
  }),
  body('notes').optional().isString().trim().isLength({ max: 1000 }),
  validate,
  async (req, res, next) => {
    try {
      const {
        patientId,
        productId,
        dewormingDate,
        weightAtTreatment,
        doseAdministered,
        route,
        nextDueDate,
        notes,
      } = req.body;

      const resolved = await resolveBranchFromPatient(req, patientId);
      if (resolved.error) return R.badRequest(res, resolved.error);

      const { branchId } = resolved;

      const products = await getRows(
        `SELECT id FROM antiparasitic_products WHERE id = :productId LIMIT 1`,
        { productId }
      );

      if (!products[0]) {
        return R.badRequest(res, 'Producto antiparasitario no encontrado');
      }

      const r = await getInsertResult(
        `INSERT INTO deworming_records
           (branch_id, patient_id, product_id,
            deworming_date, weight_at_treatment, dose_administered,
            route, next_due_date, notes, administered_by)
         VALUES (:bid,:pid,:prod,:date,:wt,:dose,:route,:next,:notes,:uid)`,
        {
          bid: branchId,
          pid: patientId,
          prod: productId,
          date: dewormingDate,
          wt: weightAtTreatment || null,
          dose: doseAdministered || null,
          route: route || null,
          next: nextDueDate || null,
          notes: notes || null,
          uid: req.user.userId,
        }
      );

      return R.created(res, { id: r.insertId });
    } catch (e) {
      logVaccinationError('POST /vaccinations/deworming', e, { branchId: req.user?.branchId, body: req.body });
      next(e);
    }
  },
];

const getDewormingProducts = [async (_req, res, next) => {
  try {
    const rows = await getRows(
      `SELECT *
       FROM antiparasitic_products
       WHERE is_active = TRUE
       ORDER BY parasite_type, name`
    );

    return R.ok(res, rows);
  } catch (e) {
    logVaccinationError('GET /vaccinations/deworming/products', e, {});
    next(e);
  }
}];

router.get('/deworming', ...getDeworming);
router.get('/deworming/alerts', ...getDewormingAlerts);
router.post('/deworming', ...postDeworming);
router.get('/deworming/products', ...getDewormingProducts);

module.exports = {
  router,
  getDeworming,
  getDewormingAlerts,
  postDeworming,
  getDewormingProducts,
};
