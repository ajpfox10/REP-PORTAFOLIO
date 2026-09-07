'use strict';

const { Router } = require('express');
const { param } = require('express-validator');
const { db, R, requirePerm, getObjectBuffer, extractObjectRef, parseJson, logDocumentsError, createLabOrderFromDocument, validate } = require('../documents.common');
const { extractLabPayloadFromPdf } = require('../lib/labIngestion');
const { getDocumentCategoryCapability, isAutomaticIngestionSupported } = require('../lib/capabilities');

const router = Router();

router.post('/:id/ingest',
  requirePerm('medical_records:update'),
  param('id').isInt({ min: 1 }),
  validate,
  async (req, res, next) => {
    try {
      // Validación rápida sin lock — evita el viaje a MinIO si el documento no existe
      const docCheck = await db.queryOne(
        `SELECT id, patient_id, document_category, storage_path
           FROM mail_document_inbox
          WHERE id = :id AND org_id = :orgId`,
        { id: req.params.id, orgId: req.user.orgId }
      );
      if (!docCheck) return R.notFound(res, 'Inbox document not found');
      if (!docCheck.patient_id) return R.conflict(res, 'Associate the document to a patient before ingestion');

      if (!isAutomaticIngestionSupported(docCheck.document_category)) {
        const capability = getDocumentCategoryCapability(docCheck.document_category);
        return R.error(
          res,
          501,
          `Automatic ingestion is not implemented for category '${docCheck.document_category}' yet`,
          {
            category: docCheck.document_category,
            automaticIngestionImplemented: false,
            notes: capability?.notes || 'Use manual association and downstream workflows.',
          },
          'DOCUMENTS_INGESTION_NOT_IMPLEMENTED'
        );
      }

      const ref = extractObjectRef(docCheck.storage_path);
      if (!ref) return R.badRequest(res, 'Document has no readable storage reference');

      const pdfBuffer = await getObjectBuffer(ref.bucket, ref.objectName);
      const extraction = await extractLabPayloadFromPdf(pdfBuffer);
      let result;
      let document;

      await db.transaction(async (conn) => {
        // FOR UPDATE serializa requests concurrentes sobre el mismo documento
        document = await conn.queryOne(
          `SELECT * FROM mail_document_inbox WHERE id = :id AND org_id = :orgId FOR UPDATE`,
          { id: req.params.id, orgId: req.user.orgId }
        );

        const metadata = parseJson(document.metadata_json, {});
        if (metadata.ingestion?.labOrderId) {
          const err = new Error('Already ingested');
          err.code = 'ALREADY_INGESTED';
          throw err;
        }

        result = await createLabOrderFromDocument({ conn, document, extraction, user: req.user });

        const mergedMetadata = {
          ...metadata,
          ingestion: {
            kind: document.document_category,
            processedAt: new Date().toISOString(),
            labOrderId: result.orderId,
            orderNumber: result.orderNumber,
            createdItems: result.createdItems,
            extractedSummary: result.extractedSummary,
            extractedTextPreview: result.extractedText.slice(0, 4000),
          },
        };

        await conn.query(
          `UPDATE mail_document_inbox
              SET ingestion_status = 'processed',
                  error_message = NULL,
                  metadata_json = :metadataJson,
                  updated_at = NOW()
            WHERE id = :id AND org_id = :orgId`,
          { id: document.id, orgId: req.user.orgId, metadataJson: JSON.stringify(mergedMetadata) }
        );
      });

      return R.ok(res, {
        documentId: document.id,
        category: document.document_category,
        orderId: result.orderId,
        orderNumber: result.orderNumber,
        createdItems: result.createdItems,
      });
    } catch (err) {
      if (err.code === 'ALREADY_INGESTED') {
        return R.conflict(res, 'This document was already ingested into lab tables');
      }
      await db.query(
        `UPDATE mail_document_inbox
            SET ingestion_status = 'error',
                error_message = :message,
                updated_at = NOW()
          WHERE id = :id AND org_id = :orgId`,
        {
          id: req.params.id,
          orgId: req.user.orgId,
          message: String(err.message || 'Ingestion failed').slice(0, 512),
        }
      ).catch(() => {});
      logDocumentsError('POST /inbox/:id/ingest', err, { orgId: req.user?.orgId, id: req.params.id });
      next(err);
    }
  }
);

module.exports = { router };
