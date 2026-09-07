'use strict';

const { Router } = require('express');
const { db, R, logImagingError } = require('./imaging.common');

const router = Router();

// OT-067: GET / → redirect to /orders for frontend compatibility
router.get('/', (req, res) => {
  const qs = Object.keys(req.query).length ? `?${new URLSearchParams(req.query).toString()}` : '';
  res.redirect(307, `${req.baseUrl}/orders${qs}`);
});

router.get('/orders', async (req, res, next) => {
  try {
    const { patientId, status } = req.query;
    const limit  = Math.min(Math.max(parseInt(req.query.limit || '20', 10) || 20, 1), 100); // BUG-9
    const page   = Math.max(parseInt(req.query.page || '1', 10) || 1, 1);
    const offset = (page - 1) * limit;
    const conds = ['io.branch_id = :bid'];
    const p = { bid: req.user.branchId, limit, offset };

    if (patientId) { conds.push('io.patient_id = :pid'); p.pid = patientId; }
    if (status) { conds.push('io.status = :status'); p.status = status; }

    const where = `WHERE ${conds.join(' AND ')}`;
    const rows = await db.query(
      `SELECT io.id, io.medical_record_id, io.order_number, io.status, io.ordered_at, io.priority,
              io.clinical_indication, io.body_region,
              p.name AS patient_name, sp.common_name AS species,
              it.name AS imaging_type,
              CONCAT(u.first_name,' ',u.last_name) AS ordered_by,
              COUNT(img.id) AS images_count,
              ir.id AS report_id
       FROM imaging_orders io
       JOIN patients p       ON io.patient_id      = p.id
       JOIN species  sp      ON p.species_id        = sp.id
       JOIN users    u       ON io.ordered_by       = u.id
       LEFT JOIN imaging_types it      ON io.imaging_type_id = it.id
       LEFT JOIN imaging_studies ims   ON ims.imaging_order_id = io.id
       LEFT JOIN imaging_images  img   ON img.imaging_study_id = ims.id
       LEFT JOIN imaging_reports ir    ON ir.imaging_order_id  = io.id
       ${where}
       GROUP BY io.id
       ORDER BY io.ordered_at DESC
       LIMIT :limit OFFSET :offset`,
      p
    );
    return R.ok(res, rows);
  } catch (e) {
    logImagingError('GET /imaging/orders', e, { branchId: req.user?.branchId, query: req.query });
    next(e);
  }
});

router.get('/orders/pending-report', async (req, res, next) => {
  try {
    const rows = await db.query(
      `SELECT * FROM v_pending_imaging_reports WHERE branch_id = :bid ORDER BY ordered_at`,
      { bid: req.user.branchId }
    );
    return R.ok(res, rows);
  } catch (e) {
    logImagingError('GET /imaging/orders/pending-report', e, { branchId: req.user?.branchId });
    next(e);
  }
});

router.get('/orders/:id', async (req, res, next) => {
  try {
    const order = await db.queryOne(
      `SELECT io.*, it.name AS imaging_type_name,
              p.name AS patient_name, p.sex, p.birthdate, p.weight_kg,
              sp.common_name AS species
       FROM imaging_orders io
       LEFT JOIN imaging_types it ON io.imaging_type_id = it.id
       JOIN patients p ON io.patient_id = p.id
       JOIN species sp ON p.species_id  = sp.id
       WHERE io.id = :id AND io.branch_id = :bid`,
      { id: req.params.id, bid: req.user.branchId }
    );
    if (!order) return R.notFound(res);

    const [studies, report] = await Promise.all([
      db.query(
        `SELECT ims.id, ims.study_datetime, ims.dicom_study_uid, ims.pacs_url,
                ims.technique, ims.contrast_used, ims.contrast_agent,
                GROUP_CONCAT(img.image_url SEPARATOR '|') AS image_urls,
                COUNT(img.id) AS image_count
         FROM imaging_studies ims
         LEFT JOIN imaging_images img ON img.imaging_study_id = ims.id
         WHERE ims.imaging_order_id = :oid
         GROUP BY ims.id ORDER BY ims.study_datetime`,
        { oid: req.params.id }
      ),
      db.queryOne(
        `SELECT ir.*, CONCAT(u.first_name,' ',u.last_name) AS radiologist_name
         FROM imaging_reports ir
         JOIN users u ON ir.reported_by = u.id
         WHERE ir.imaging_order_id = :oid`,
        { oid: req.params.id }
      ),
    ]);

    return R.ok(res, { ...order, studies, report });
  } catch (e) {
    logImagingError('GET /imaging/orders/:id', e, { orderId: req.params.id, branchId: req.user?.branchId });
    next(e);
  }
});

router.get('/types', async (_req, res, next) => {
  try {
    const rows = await db.query(`SELECT * FROM imaging_types WHERE is_active=TRUE ORDER BY name`);
    return R.ok(res, rows);
  } catch (e) {
    logImagingError('GET /imaging/types', e, {});
    next(e);
  }
});

module.exports = { router };
