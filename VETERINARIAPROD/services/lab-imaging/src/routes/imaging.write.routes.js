'use strict';

const { Router } = require('express');
const { body } = require('express-validator');
const { db, R, validate, resolveMedicalRecordId, logImagingError } = require('./imaging.common');

const router = Router();

router.post('/orders',
  body('patientId').isInt(),
  body('imagingTypeId').isInt(),
  validate,
  async (req, res, next) => {
    try {
      const {
        patientId, medicalRecordId, imagingTypeId,
        bodyRegion, clinicalIndication, priority = 'routine',
        patientPreparation, sedationRequired,
      } = req.body;
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

      // BUG-2: envolver en transacción con FOR UPDATE para evitar números de orden duplicados
      const { id: insertId, orderNumber } = await db.transaction(async (conn) => {
        const [{ nextNum }] = await conn.query(
          `SELECT COALESCE(MAX(CAST(SUBSTRING(order_number,4) AS UNSIGNED)),0)+1 AS nextNum
           FROM imaging_orders WHERE branch_id = :bid FOR UPDATE`,
          { bid: req.user.branchId }
        );
        const num = `IMG${String(nextNum).padStart(6, '0')}`;
        const [r] = await conn.query(
          `INSERT INTO imaging_orders
             (branch_id, patient_id, medical_record_id, imaging_type_id,
              order_number, body_region, clinical_indication, priority,
              patient_preparation, sedation_required, ordered_by, status)
           VALUES (:bid,:pid,:mid,:type,:num,:region,:indication,:prio,:prep,:sed,:uid,'pending')`,
          {
            bid: req.user.branchId, pid: patientId, mid: resolvedMedicalRecordId,
            type: imagingTypeId, num, region: bodyRegion || null,
            indication: clinicalIndication || null, prio: priority,
            prep: patientPreparation || null, sed: sedationRequired ? 1 : 0,
            uid: req.user.userId,
          }
        );
        return { id: r.insertId, orderNumber: num };
      });
      return R.created(res, { id: insertId, orderNumber });
    } catch (e) {
      if (e.httpStatus === 403) return R.forbidden(res, e.message);
      logImagingError('POST /imaging/orders', e, { branchId: req.user?.branchId, body: req.body });
      next(e);
    }
  }
);

router.post('/orders/:id/studies',
  body('studyDatetime').isISO8601(),
  body('imageUrls').isArray({ min: 1 }),
  validate,
  async (req, res, next) => {
    try {
      const { studyDatetime, dicomStudyUid, pacsUrl, technique, contrastUsed, contrastAgent, imageUrls } = req.body;
      const order = await db.queryOne(
        `SELECT id FROM imaging_orders WHERE id = :id AND branch_id = :bid`,
        { id: req.params.id, bid: req.user.branchId }
      );
      if (!order) return R.notFound(res, 'Orden de imagen no encontrada');

      const [r] = await db.query(
        `INSERT INTO imaging_studies
           (imaging_order_id, study_datetime, dicom_study_uid, pacs_url,
            technique, contrast_used, contrast_agent, performed_by)
         VALUES (:oid,:dt,:dicom,:pacs,:tech,:contrast,:agent,:uid)`,
        {
          oid: req.params.id, dt: studyDatetime,
          dicom: dicomStudyUid || null, pacs: pacsUrl || null,
          tech: technique || null, contrast: contrastUsed ? 1 : 0,
          agent: contrastAgent || null, uid: req.user.userId,
        }
      );
      const studyId = r.insertId;

      for (const url of imageUrls) {
        await db.query(
          `INSERT INTO imaging_images (imaging_study_id, image_url) VALUES (?,?)`,
          [studyId, url]
        );
      }

      await db.query(`UPDATE imaging_orders SET status='acquired' WHERE id=? AND branch_id=?`, [req.params.id, req.user.branchId]);
      return R.created(res, { studyId });
    } catch (e) {
      logImagingError('POST /imaging/orders/:id/studies', e, { orderId: req.params.id, body: req.body });
      next(e);
    }
  }
);

router.post('/orders/:id/report',
  body('findings').notEmpty(),
  body('conclusion').notEmpty(),
  validate,
  async (req, res, next) => {
    try {
      const { findings, conclusion, recommendations, isNormal } = req.body;
      const order = await db.queryOne(
        `SELECT id FROM imaging_orders WHERE id = :id AND branch_id = :bid`,
        { id: req.params.id, bid: req.user.branchId }
      );
      if (!order) return R.notFound(res, 'Orden de imagen no encontrada');

      const [r] = await db.query(
        `INSERT INTO imaging_reports
           (imaging_order_id, findings, conclusion, recommendations, is_normal, reported_by)
         VALUES (:oid,:find,:conc,:rec,:norm,:uid)`,
        {
          oid: req.params.id, find: findings, conc: conclusion,
          rec: recommendations || null, norm: isNormal ? 1 : 0, uid: req.user.userId,
        }
      );
      await db.query(`UPDATE imaging_orders SET status='reported' WHERE id=? AND branch_id=?`, [req.params.id, req.user.branchId]);
      return R.created(res, { id: r.insertId });
    } catch (e) {
      logImagingError('POST /imaging/orders/:id/report', e, { orderId: req.params.id, body: req.body });
      next(e);
    }
  }
);

module.exports = { router };
