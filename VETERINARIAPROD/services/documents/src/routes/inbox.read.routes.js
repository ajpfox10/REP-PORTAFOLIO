'use strict';

const { Router } = require('express');
const { param, query } = require('express-validator');
const { db, R, validate, parsePagination, parseJson, extractObjectRef, getPresignedUrl, ensurePatientInOrg, logDocumentsError, BUCKETS } = require('../documents.common');

const router = Router();

router.get('/',
  query('accountId').optional().isInt({ min: 1 }),
  query('patientId').optional().isInt({ min: 1 }),
  query('associationStatus').optional().isIn(['unassociated', 'associated', 'needs_review']),
  query('provider').optional().isString(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  validate,
  async (req, res, next) => {
    try {
      const { page, limit, offset } = parsePagination(req.query);
      const conds = ['d.org_id = :orgId'];
      const params = { orgId: req.user.orgId, limit, offset };

      if (req.query.accountId) { conds.push('d.account_id = :accountId'); params.accountId = req.query.accountId; }
      if (req.query.patientId) { conds.push('d.patient_id = :patientId'); params.patientId = req.query.patientId; }
      if (req.query.associationStatus) { conds.push('d.association_status = :associationStatus'); params.associationStatus = req.query.associationStatus; }
      if (req.query.provider) { conds.push('a.provider = :provider'); params.provider = req.query.provider; }

      const where = conds.join(' AND ');
      const rows = await db.query(
        `SELECT d.id, d.account_id, d.patient_id, d.branch_id, d.external_message_id,
                d.from_email, d.subject, d.received_at, d.filename, d.mime_type,
                d.file_size, d.checksum, d.storage_path, d.document_category,
                d.association_status, d.ingestion_status, d.error_message,
                d.created_at, d.updated_at, d.metadata_json,
                a.provider, a.email_address,
                p.name AS patient_name
           FROM mail_document_inbox d
      LEFT JOIN mail_accounts a ON a.id = d.account_id
      LEFT JOIN patients p      ON p.id = d.patient_id
          WHERE ${where}
          ORDER BY d.received_at DESC, d.id DESC
          LIMIT :limit OFFSET :offset`,
        params
      );

      const totalRow = await db.queryOne(
        `SELECT COUNT(*) AS total
           FROM mail_document_inbox d
      LEFT JOIN mail_accounts a ON a.id = d.account_id
          WHERE ${where}`,
        { ...params, limit: undefined, offset: undefined }
      );

      return R.paginated(
        res,
        rows.map((row) => ({ ...row, metadata: parseJson(row.metadata_json, {}) })),
        totalRow?.total || 0,
        page,
        limit
      );
    } catch (err) {
      logDocumentsError('GET /inbox', err, { orgId: req.user?.orgId, query: req.query });
      next(err);
    }
  }
);

router.get('/patients/:patientId',
  param('patientId').isInt({ min: 1 }),
  validate,
  async (req, res, next) => {
    try {
      const patient = await ensurePatientInOrg(req.params.patientId, req.user.orgId);
      if (!patient) return R.notFound(res, 'Patient not found');

      const rows = await db.query(
        `SELECT id, account_id, patient_id, branch_id, external_message_id,
                from_email, subject, received_at, filename, mime_type, file_size,
                checksum, storage_path, document_category, association_status,
                ingestion_status, error_message, created_at, updated_at, metadata_json
           FROM mail_document_inbox
          WHERE org_id = :orgId AND patient_id = :patientId
          ORDER BY received_at DESC, id DESC`,
        { orgId: req.user.orgId, patientId: req.params.patientId }
      );

      return R.ok(res, rows.map((row) => ({ ...row, metadata: parseJson(row.metadata_json, {}) })), {
        patient: { id: patient.id, name: patient.name },
      });
    } catch (err) {
      logDocumentsError('GET /inbox/patients/:patientId', err, { orgId: req.user?.orgId, patientId: req.params.patientId });
      next(err);
    }
  }
);

router.get('/:id/download-url',
  param('id').isInt({ min: 1 }),
  validate,
  async (req, res, next) => {
    try {
      const row = await db.queryOne(
        'SELECT storage_path FROM mail_document_inbox WHERE id = :id AND org_id = :orgId',
        { id: req.params.id, orgId: req.user.orgId }
      );
      if (!row) return R.notFound(res, 'Inbox document not found');
      const ref = extractObjectRef(row.storage_path);
      if (!ref) return R.badRequest(res, 'Document has no downloadable storage reference');
      const expectedPrefix = `documents/${req.user.orgId}/`;
      if (ref.bucket !== BUCKETS.documents || !ref.objectName.startsWith(expectedPrefix)) {
        return R.forbidden(res, 'Storage reference fuera del alcance de la organizacion', 'DOCUMENT_STORAGE_SCOPE');
      }
      const url = await getPresignedUrl(ref.bucket, ref.objectName, 3600);
      return R.ok(res, { url, expiresIn: 3600 });
    } catch (err) {
      logDocumentsError('GET /inbox/:id/download-url', err, { orgId: req.user?.orgId, id: req.params.id });
      next(err);
    }
  }
);

router.get('/:id',
  param('id').isInt({ min: 1 }),
  validate,
  async (req, res, next) => {
    try {
      const row = await db.queryOne(
        `SELECT d.*, a.provider, a.email_address, p.name AS patient_name
           FROM mail_document_inbox d
      LEFT JOIN mail_accounts a ON a.id = d.account_id
      LEFT JOIN patients p      ON p.id = d.patient_id
          WHERE d.id = :id AND d.org_id = :orgId`,
        { id: req.params.id, orgId: req.user.orgId }
      );
      if (!row) return R.notFound(res, 'Inbox document not found');
      return R.ok(res, { ...row, metadata: parseJson(row.metadata_json, {}) });
    } catch (err) {
      logDocumentsError('GET /inbox/:id', err, { orgId: req.user?.orgId, id: req.params.id });
      next(err);
    }
  }
);

module.exports = { router };
