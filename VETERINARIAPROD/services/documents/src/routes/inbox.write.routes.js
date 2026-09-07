'use strict';

const path = require('path');
const { Router } = require('express');
const multer = require('multer');
const { body, param, validationResult } = require('express-validator');
const { db, R, requirePerm, uploadFile, BUCKETS, sha256, validate, isPdf, hasPdfMagic, ensurePatientInOrg, parseJson, logDocumentsError } = require('../documents.common');

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 10 } });

// FIX 5 — whitelist de categorías de documento válidas
const VALID_DOCUMENT_CATEGORIES = ['external_lab', 'prescription', 'medical_authorization', 'insurance_claim', 'vet_clinic_records', 'general'];
const VALID_CATS_SET = new Set(VALID_DOCUMENT_CATEGORIES);

router.post('/manual',
  requirePerm('medical_records:update'),
  body('accountId').optional().isInt({ min: 1 }),
  body('fromEmail').isEmail(),
  body('subject').optional().isString(),
  body('receivedAt').optional().isISO8601(),
  body('attachments').isArray({ min: 1 }),
  body('attachments.*.filename').isString().trim().isLength({ min: 1, max: 255 }).customSanitizer(v => path.basename(v).replace(/[^\w\s\-_.]/g, '_').slice(0, 255)),
  body('attachments.*.mimeType').optional().isString(),
  body('attachments.*.fileSize').optional().isInt({ min: 0 }),
  body('attachments.*.checksum').optional().isString(),
  body('attachments.*.storagePath').optional().isString(),
  body('attachments.*.documentCategory').optional().isIn(VALID_DOCUMENT_CATEGORIES),
  body('attachments.*.patientId').optional().isInt({ min: 1 }),
  validate,
  async (req, res, next) => {
    try {
      const attachments = req.body.attachments || [];
      const createdIds = [];
      const receivedAt = req.body.receivedAt || new Date().toISOString();

      if (req.body.accountId) {
        const account = await db.queryOne(
          'SELECT id FROM mail_accounts WHERE id = :id AND org_id = :orgId',
          { id: req.body.accountId, orgId: req.user.orgId }
        );
        if (!account) return R.notFound(res, 'Mail account not found');
      }

      await db.transaction(async (conn) => {
        for (const attachment of attachments) {
          let associationStatus = 'unassociated';
          if (attachment.patientId) {
            const patient = await conn.queryOne(
              `SELECT p.id
                 FROM patients p
                WHERE p.id = :patientId AND p.organization_id = :orgId`,
              { patientId: attachment.patientId, orgId: req.user.orgId }
            );
            if (!patient) throw new Error(`Patient ${attachment.patientId} not found in org`);
            associationStatus = 'associated';
          }

          const [result] = await conn.query(
            `INSERT INTO mail_document_inbox
               (org_id, branch_id, account_id, patient_id, external_message_id,
                from_email, subject, received_at, filename, mime_type, file_size,
                checksum, storage_path, document_category, association_status,
                ingestion_status, metadata_json)
             VALUES
               (:orgId, :branchId, :accountId, :patientId, :externalMessageId,
                :fromEmail, :subject, :receivedAt, :filename, :mimeType, :fileSize,
                :checksum, :storagePath, :documentCategory, :associationStatus,
                'indexed', :metadataJson)`,
            {
              orgId: req.user.orgId,
              branchId: req.user.branchId || null,
              accountId: req.body.accountId || null,
              patientId: attachment.patientId || null,
              externalMessageId: req.body.externalMessageId || null,
              fromEmail: req.body.fromEmail,
              subject: req.body.subject || null,
              receivedAt,
              filename: attachment.filename,
              mimeType: attachment.mimeType || 'application/pdf',
              fileSize: attachment.fileSize || 0,
              checksum: attachment.checksum || null,
              storagePath: attachment.storagePath || null,
              documentCategory: attachment.documentCategory || 'external_lab',
              associationStatus,
              metadataJson: JSON.stringify(attachment.metadata || {}),
            }
          );
          createdIds.push(result.insertId);
        }
      });

      return R.created(res, { createdIds, count: createdIds.length });
    } catch (err) {
      // B-9: no loguear body completo — puede contener datos de adjuntos grandes
      logDocumentsError('POST /inbox/manual', err, { orgId: req.user?.orgId, attachmentCount: req.body.attachments?.length, fromEmail: req.body.fromEmail });
      next(err);
    }
  }
);

router.post('/upload',
  requirePerm('medical_records:update'),
  upload.array('files', 10),
  async (req, res, next) => {
    try {
      const files = req.files || [];
      if (!files.length) return R.badRequest(res, 'No files uploaded');

      const fromEmail = String(req.body.fromEmail || req.user.email || 'manual-upload@local').trim();
      const subject = String(req.body.subject || 'Carga manual').trim();
      const documentCategory = VALID_CATS_SET.has(req.body.documentCategory) ? req.body.documentCategory : 'external_lab';
      const accountId = req.body.accountId ? Number(req.body.accountId) : null;
      const patientId = req.body.patientId ? Number(req.body.patientId) : null;
      const receivedAt = req.body.receivedAt || new Date().toISOString();

      if (accountId) {
        const account = await db.queryOne(
          'SELECT id FROM mail_accounts WHERE id = :id AND org_id = :orgId',
          { id: accountId, orgId: req.user.orgId }
        );
        if (!account) return R.notFound(res, 'Mail account not found');
      }

      if (patientId) {
        const patient = await ensurePatientInOrg(patientId, req.user.orgId);
        if (!patient) return R.notFound(res, 'Patient not found');
      }

      const createdIds = [];

      await db.transaction(async (conn) => {
        for (const file of files) {
          if (!isPdf(file) || !hasPdfMagic(file.buffer)) {
            throw new Error(`Invalid PDF file: ${file.originalname}`);
          }

          const checksum = sha256(file.buffer);
          const existing = await conn.queryOne(
            `SELECT id
               FROM mail_document_inbox
              WHERE org_id = :orgId
                AND checksum = :checksum
                AND filename = :filename
              LIMIT 1`,
            { orgId: req.user.orgId, checksum, filename: file.originalname }
          );
          if (existing) continue;

          const storagePath = await uploadFile(file.buffer, file.originalname, BUCKETS.documents, `documents/${req.user.orgId}/${accountId || 'manual'}`);

          const [result] = await conn.query(
            `INSERT INTO mail_document_inbox
               (org_id, branch_id, account_id, patient_id, external_message_id,
                from_email, subject, received_at, filename, mime_type, file_size,
                checksum, storage_path, document_category, association_status,
                ingestion_status, metadata_json)
             VALUES
               (:orgId, :branchId, :accountId, :patientId, NULL,
                :fromEmail, :subject, :receivedAt, :filename, :mimeType, :fileSize,
                :checksum, :storagePath, :documentCategory, :associationStatus,
                'downloaded', :metadataJson)`,
            {
              orgId: req.user.orgId,
              branchId: req.user.branchId || null,
              accountId,
              patientId,
              fromEmail,
              subject: subject || null,
              receivedAt,
              filename: file.originalname,
              mimeType: file.mimetype || 'application/pdf',
              fileSize: file.size || file.buffer.length,
              checksum,
              storagePath,
              documentCategory,
              associationStatus: patientId ? 'associated' : 'unassociated',
              metadataJson: JSON.stringify({
                provider: 'upload',
                uploadedBy: req.user.userId || null,
                extension: path.extname(file.originalname).toLowerCase(),
              }),
            }
          );
          createdIds.push(result.insertId);
        }
      });

      return R.created(res, { createdIds, count: createdIds.length });
    } catch (err) {
      logDocumentsError('POST /inbox/upload', err, { orgId: req.user?.orgId, body: req.body });
      next(err);
    }
  }
);

router.patch('/:id/associate',
  requirePerm('medical_records:update'),
  param('id').isInt({ min: 1 }),
  body('patientId').isInt({ min: 1 }),
  body('documentCategory').optional().isIn(VALID_DOCUMENT_CATEGORIES),
  body('metadata').optional().isObject(),
  validate,
  async (req, res, next) => {
    try {
      const inboxRow = await db.queryOne('SELECT id FROM mail_document_inbox WHERE id = :id AND org_id = :orgId', { id: req.params.id, orgId: req.user.orgId });
      if (!inboxRow) return R.notFound(res, 'Inbox document not found');

      const patient = await ensurePatientInOrg(req.body.patientId, req.user.orgId);
      if (!patient) return R.notFound(res, 'Patient not found');

      const existing = await db.queryOne('SELECT metadata_json FROM mail_document_inbox WHERE id = :id AND org_id = :orgId', { id: req.params.id, orgId: req.user.orgId });
      const mergedMetadata = { ...parseJson(existing?.metadata_json, {}), ...(req.body.metadata || {}) };

      await db.query(
        `UPDATE mail_document_inbox
            SET patient_id = :patientId,
                document_category = COALESCE(:documentCategory, document_category),
                association_status = 'associated',
                metadata_json = :metadataJson,
                updated_at = NOW()
          WHERE id = :id AND org_id = :orgId`,
        {
          id: req.params.id,
          orgId: req.user.orgId,
          patientId: req.body.patientId,
          documentCategory: req.body.documentCategory || null,
          metadataJson: JSON.stringify(mergedMetadata),
        }
      );

      return R.ok(res, { id: Number(req.params.id), patientId: patient.id, patientName: patient.name, associationStatus: 'associated' });
    } catch (err) {
      logDocumentsError('PATCH /inbox/:id/associate', err, { orgId: req.user?.orgId, id: req.params.id, body: req.body });
      next(err);
    }
  }
);

module.exports = { router };
