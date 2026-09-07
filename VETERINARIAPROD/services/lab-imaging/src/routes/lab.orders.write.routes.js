'use strict';

const { Router } = require('express');
const { body } = require('express-validator');
const { db, R, logLabError, resolveMedicalRecordId } = require('./lab.orders.common');
const { validate } = require('./lab.common');

const router = Router();

router.post('/orders',
  body('patientId').isInt(),
  body('tests').isArray({ min: 1 }),
  body('priority').optional().isIn(['routine', 'urgent', 'stat']),
  body('clinicalNotes').optional().isString().trim().isLength({ max: 2000 }),
  validate,
  async (req, res, next) => {
    try {
      const { patientId, medicalRecordId, tests, priority = 'routine', clinicalNotes } = req.body;
      const patient = await db.queryOne(
        `SELECT p.id
           FROM patients p
          WHERE p.id = :patientId
            AND p.organization_id = :orgId
            AND EXISTS (
              SELECT 1
                FROM patient_owners po
                JOIN clients c ON c.id = po.client_id
               WHERE po.patient_id = p.id
                 AND c.branch_id = :branchId
                 AND po.deleted_at IS NULL
            )`,
        { patientId, orgId: req.user.orgId, branchId: req.user.branchId }
      );
      if (!patient) return R.notFound(res, 'Paciente no encontrado');
      const resolvedMedicalRecordId = await resolveMedicalRecordId(db, {
        patientId,
        branchId: req.user.branchId,
        medicalRecordId: medicalRecordId || null,
      });
      const normalizedTests = tests
        .map((entry) => {
          if (typeof entry === 'number') return entry;
          if (entry && typeof entry === 'object') return entry.testId || entry.id || null;
          return null;
        })
        .filter(Boolean);

      if (!normalizedTests.length) return R.badRequest(res, 'At least one valid lab test is required');

      let orderNumber, orderId;
      await db.transaction(async (conn) => {
        const [{ nextNum }] = await conn.query(
          `SELECT COALESCE(MAX(CAST(SUBSTRING(order_number,4) AS UNSIGNED)),0)+1 AS nextNum
             FROM lab_orders
            WHERE branch_id = :bid FOR UPDATE`,
          { bid: req.user.branchId }
        );
        orderNumber = `LAB${String(nextNum).padStart(6, '0')}`;

        const [r] = await conn.query(
          `INSERT INTO lab_orders
             (branch_id, patient_id, medical_record_id, order_number, priority, clinical_notes,
              ordered_by, status)
           VALUES (:bid, :pid, :mid, :num, :prio, :notes, :uid, 'pending')`,
          {
            bid: req.user.branchId,
            pid: patientId,
            mid: resolvedMedicalRecordId,
            num: orderNumber,
            prio: priority,
            notes: clinicalNotes || null,
            uid: req.user.userId,
          }
        );
        orderId = r.insertId;

        const itemRows = normalizedTests.map((testId) => [orderId, testId, 'pending']);
        const itemPlaceholders = itemRows.map(() => '(?,?,?)').join(', ');
        await conn.query(
          `INSERT INTO lab_order_items (lab_order_id, lab_test_id, status) VALUES ${itemPlaceholders}`,
          itemRows.flat()
        );
      });

      return R.created(res, { id: orderId, orderNumber, medicalRecordId: resolvedMedicalRecordId });
    } catch (e) {
      logLabError('POST /lab/orders', e, { branchId: req.user?.branchId, body: req.body });
      next(e);
    }
  }
);

router.post('/orders/:id/results',
  body('results').isArray({ min: 1 }),
  body('results.*.valueText').optional().isString().trim().isLength({ max: 1000 }),
  body('results.*.interpretation').optional().isString().trim().isLength({ max: 1000 }),
  body('results.*.unit').optional().isString().trim().isLength({ max: 50 }),
  validate,
  async (req, res, next) => {
    try {
      const { results } = req.body;

      const patient = await db.queryOne(
        `SELECT p.species_id, p.sex
           FROM lab_orders lo
           JOIN patients p ON lo.patient_id = p.id
          WHERE lo.id = :oid
            AND lo.branch_id = :branchId
            AND p.organization_id = :orgId`,
        { oid: req.params.id, branchId: req.user.branchId, orgId: req.user.orgId }
      );
      if (!patient) return R.notFound(res, 'Orden no encontrada');
      const itemIds = results.map((r) => Number(r.itemId)).filter(Boolean);
      if (itemIds.length !== results.length) return R.badRequest(res, 'Todos los resultados deben incluir itemId valido');
      const ownedItems = await db.query(
        `SELECT loi.id FROM lab_order_items loi
           JOIN lab_orders lo ON lo.id = loi.lab_order_id
          WHERE loi.lab_order_id = ?
            AND lo.branch_id = ?
            AND loi.id IN (${itemIds.map(() => '?').join(',')})`,
        [req.params.id, req.user.branchId, ...itemIds]
      );
      if (ownedItems.length !== itemIds.length) return R.forbidden(res, 'Items de orden fuera de alcance', 'LAB_ORDER_ITEM_SCOPE');

      const refs = await Promise.all(
        results.map((r) => db.queryOne(
          `SELECT lrr.min_value, lrr.max_value, lrr.unit,
                  CONCAT(lrr.min_value,' - ',lrr.max_value,' ',lrr.unit) AS range_text
             FROM lab_order_items loi
             JOIN lab_reference_ranges lrr
               ON lrr.lab_test_id = loi.lab_test_id
              AND lrr.species_id = :speciesId
              AND (lrr.sex = :sex OR lrr.sex = 'any')
            WHERE loi.id = :itemId
            ORDER BY lrr.sex DESC
            LIMIT 1`,
          { speciesId: patient?.species_id, sex: patient?.sex || 'any', itemId: r.itemId }
        ))
      );

      const resultRows = results.map((r, i) => {
        const ref = refs[i];
        const criticalLow  = parseFloat(process.env.LAB_CRITICAL_LOW_FACTOR  || '0.7');
        const criticalHigh = parseFloat(process.env.LAB_CRITICAL_HIGH_FACTOR || '1.3');
        const valNum   = r.valueNumeric != null ? parseFloat(r.valueNumeric) : NaN;
        const minVal   = ref ? parseFloat(ref.min_value) : NaN;
        const maxVal   = ref ? parseFloat(ref.max_value) : NaN;
        const isCritical = Number.isFinite(valNum) && Number.isFinite(minVal) && Number.isFinite(maxVal)
          ? (valNum < minVal * criticalLow || valNum > maxVal * criticalHigh)
          : false;

        return [
          r.itemId,
          r.valueNumeric != null ? r.valueNumeric : null,
          r.valueText || null,
          r.unit || ref?.unit || null,
          ref?.range_text || null,
          isCritical ? 1 : 0,
          r.interpretation || null,
          req.user.userId,
        ];
      });

      const resultPlaceholders = resultRows.map(() => '(?,?,?,?,?,?,?,?,NOW())').join(', ');
      await db.query(
        `INSERT INTO lab_results
           (lab_order_item_id, value_numeric, value_text, unit,
            reference_range_used, is_critical, interpretation, reported_by, reported_at)
         VALUES ${resultPlaceholders}`,
        resultRows.flat()
      );

      await db.query(
        `UPDATE lab_order_items SET status = 'completed' WHERE id IN (${itemIds.map(() => '?').join(',')})`,
        itemIds
      );

      await db.query(
        `UPDATE lab_orders lo
            SET status = (
                  CASE WHEN (SELECT COUNT(*) FROM lab_order_items WHERE lab_order_id = lo.id AND status != 'completed') = 0
                       THEN 'completed' ELSE 'partial' END
                ),
                reported_at = CASE WHEN status = 'completed' THEN NOW() ELSE reported_at END
          WHERE id = :oid`,
        { oid: req.params.id }
      );

      return R.created(res, { message: 'Results recorded' });
    } catch (e) {
      logLabError('POST /lab/orders/:id/results', e, { orderId: req.params.id, branchId: req.user?.branchId, body: req.body });
      next(e);
    }
  }
);

module.exports = { router };
