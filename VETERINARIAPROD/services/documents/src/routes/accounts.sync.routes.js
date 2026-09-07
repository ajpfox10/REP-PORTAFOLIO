'use strict';

const path = require('path');
const { Router } = require('express');
const { param } = require('express-validator');
const { db, R, loadAccount, logDocumentsError } = require('./accounts.common');
const { syncAccountDocuments } = require('../lib/sync');
const { validate, hasPdfMagic } = require('../documents.common');
const { getProviderCapability, isProviderSyncSupported } = require('../lib/capabilities');

const MAX_SYNC_PDF_SIZE = 25 * 1024 * 1024; // 25 MB — igual que upload manual

// BUG-DOC-03/04: sanitizar nombres de archivo de origen externo
function sanitizeFilename(name) {
  return path.basename(String(name || 'document.pdf'))
    .replace(/[^\w\s.\-()]/g, '_')
    .slice(0, 255) || 'document.pdf';
}

const router = Router();

router.post('/:id/sync',
  param('id').isInt({ min: 1 }),
  validate,
  async (req, res, next) => {
    try {
      const account = await loadAccount(req.params.id, req.user.orgId);
      if (!account) return R.notFound(res, 'Mail account not found');
      if (!account.is_active) return R.conflict(res, 'Mail account is inactive');

      if (account.provider === 'manual') {
        return R.accepted(res, {
          accountId: account.id,
          provider: account.provider,
          status: 'manual_provider_ready',
          imported: 0,
          message: 'La cuenta manual no sincroniza remoto; usar importación manual o upload directo.',
        });
      }

      if (!isProviderSyncSupported(account.provider)) {
        const capability = getProviderCapability(account.provider);
        return R.error(
          res,
          501,
          `Provider '${account.provider}' is not available for remote sync yet`,
          {
            provider: account.provider,
            implemented: capability?.implemented === true,
            remoteSyncSupported: false,
            notes: capability?.notes || 'Provider pending implementation.',
          },
          'DOCUMENTS_PROVIDER_NOT_IMPLEMENTED'
        );
      }

      const { records, settings } = await syncAccountDocuments(account);
      let imported = 0;

      await db.transaction(async (conn) => {
        for (const record of records) {
          for (const attachment of record.attachments) {
            const existing = await conn.queryOne(
              `SELECT id
                 FROM mail_document_inbox
                WHERE org_id = :orgId
                  AND account_id = :accountId
                  AND external_message_id = :externalMessageId
                  AND filename = :filename
                LIMIT 1`,
              {
                orgId: req.user.orgId,
                accountId: account.id,
                externalMessageId: record.externalMessageId,
                filename: attachment.filename,
              }
            );
            if (existing) continue;

            // BUG-DOC-01/05: validar magic bytes y tamaño antes de subir
            if (!attachment.buffer || attachment.buffer.length === 0) continue;
            if (attachment.buffer.length > MAX_SYNC_PDF_SIZE) {
              logDocumentsError('sync: attachment demasiado grande, ignorado', null, {
                filename: attachment.filename, size: attachment.buffer.length,
              });
              continue;
            }
            if (!hasPdfMagic(attachment.buffer)) {
              logDocumentsError('sync: attachment no es PDF válido, ignorado', null, {
                filename: attachment.filename,
              });
              continue;
            }

            const safeFilename = sanitizeFilename(attachment.filename); // BUG-DOC-04
            const { uploadFile, BUCKETS } = require('../../../../shared/minio');
            const storagePath = await uploadFile(
              attachment.buffer,
              safeFilename,
              BUCKETS.documents,
              `documents/${req.user.orgId}/${account.id}`
            );

            await conn.query(
              `INSERT INTO mail_document_inbox
                 (org_id, branch_id, account_id, patient_id, external_message_id,
                  from_email, subject, received_at, filename, mime_type, file_size,
                  checksum, storage_path, document_category, association_status,
                  ingestion_status, metadata_json)
               VALUES
                 (:orgId, :branchId, :accountId, NULL, :externalMessageId,
                  :fromEmail, :subject, :receivedAt, :filename, :mimeType, :fileSize,
                  :checksum, :storagePath, 'external_lab', 'unassociated',
                  'downloaded', :metadataJson)`,
              {
                orgId: req.user.orgId,
                branchId: req.user.branchId || null,
                accountId: account.id,
                externalMessageId: record.externalMessageId,
                fromEmail: record.fromEmail,
                subject: record.subject || null,
                receivedAt: record.receivedAt,
                filename: safeFilename,
                mimeType: attachment.mimeType || 'application/pdf',
                fileSize: attachment.fileSize || attachment.buffer.length,
                checksum: attachment.checksum,
                storagePath,
                metadataJson: JSON.stringify(attachment.metadata || {}),
              }
            );
            imported += 1;
          }
        }

        await conn.query(
          `UPDATE mail_accounts
              SET last_error = NULL,
                  last_synced_at = NOW(),
                  settings_json = :settingsJson,
                  updated_at = NOW()
            WHERE id = :id AND org_id = :orgId`,
          {
            id: account.id,
            orgId: req.user.orgId,
            settingsJson: JSON.stringify(settings || account.settings || {}),
          }
        );
      });

      return R.accepted(res, {
        accountId: account.id,
        provider: account.provider,
        status: 'synced',
        imported,
        message: `Sincronización completada: ${imported} adjunto(s) nuevo(s).`,
      });
    } catch (err) {
      await db.query(
        `UPDATE mail_accounts
            SET last_error = :message, updated_at = NOW()
          WHERE id = :id AND org_id = :orgId`,
        {
          id: req.params.id,
          orgId: req.user.orgId,
          message: String(err.message || 'Sync failed').slice(0, 512),
        }
      ).catch(() => {});
      logDocumentsError('POST /mail-accounts/:id/sync', err, { orgId: req.user?.orgId, id: req.params.id });
      next(err);
    }
  }
);

module.exports = { router };
