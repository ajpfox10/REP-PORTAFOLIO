'use strict';

const { Router } = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { db, R, sanitizeSettings, mergeSettings, encryptSecretFields, decryptSecretFields, loadAccount, logDocumentsError } = require('./accounts.common');
const { validate } = require('../documents.common');

const router = Router();

router.get('/',
  query('provider').optional().isString(),
  query('active').optional().isIn(['true', 'false']),
  validate,
  async (req, res, next) => {
    try {
      const conds = ['org_id = :orgId'];
      const params = { orgId: req.user.orgId };
      if (req.query.provider) { conds.push('provider = :provider'); params.provider = req.query.provider; }
      if (req.query.active != null) { conds.push('is_active = :active'); params.active = req.query.active === 'true' ? 1 : 0; }

      const rows = await db.query(
        `SELECT id, provider, email_address, display_name, folder_name, is_active,
                last_synced_at, last_error, created_at, updated_at, settings_json
           FROM mail_accounts
          WHERE ${conds.join(' AND ')}
          ORDER BY created_at DESC`,
        params
      );

      return R.ok(res, rows.map((row) => ({
        ...row,
        is_active: Boolean(row.is_active),
        settings: sanitizeSettings(row.provider, decryptSecretFields(require('../documents.common').parseJson(row.settings_json, {}))),
      })));
    } catch (err) {
      logDocumentsError('GET /mail-accounts', err, { orgId: req.user?.orgId, query: req.query });
      next(err);
    }
  }
);

router.post('/',
  body('provider').isIn(['gmail', 'imap', 'outlook', 'manual']),
  body('emailAddress').isEmail(),
  body('displayName').optional().isString().trim().isLength({ max: 200 }),
  // folderName se usa como nombre de mailbox IMAP — solo caracteres seguros, sin CRLF ni path traversal
  body('folderName').optional().isString().trim().isLength({ max: 200 })
    .matches(/^[^<>"\r\n\0]+$/).withMessage('folderName contiene caracteres no permitidos'),
  body('settings').optional().isObject(),
  body('isActive').optional().isBoolean(),
  validate,
  async (req, res, next) => {
    try {
      const [result] = await db.query(
        `INSERT INTO mail_accounts
           (org_id, provider, email_address, display_name, folder_name, is_active, settings_json)
         VALUES
           (:orgId, :provider, :emailAddress, :displayName, :folderName, :isActive, :settingsJson)`,
        {
          orgId: req.user.orgId,
          provider: req.body.provider,
          emailAddress: req.body.emailAddress,
          displayName: req.body.displayName || null,
          folderName: req.body.folderName || 'INBOX',
          isActive: req.body.isActive === false ? 0 : 1,
          settingsJson: JSON.stringify(encryptSecretFields(req.body.settings || {})),
        }
      );

      return R.created(res, { id: result.insertId });
    } catch (err) {
      logDocumentsError('POST /mail-accounts', err, { orgId: req.user?.orgId, body: req.body });
      next(err);
    }
  }
);

router.patch('/:id',
  param('id').isInt({ min: 1 }),
  body('displayName').optional().isString().trim().isLength({ max: 200 }),
  // folderName se usa como nombre de mailbox IMAP — solo caracteres seguros, sin CRLF ni path traversal
  body('folderName').optional().isString().trim().isLength({ max: 200 })
    .matches(/^[^<>"\r\n\0]+$/).withMessage('folderName contiene caracteres no permitidos'),
  body('settings').optional().isObject(),
  body('isActive').optional().isBoolean(),
  validate,
  async (req, res, next) => {
    try {
      const account = await db.queryOne(
        'SELECT id, settings_json FROM mail_accounts WHERE id = :id AND org_id = :orgId',
        { id: req.params.id, orgId: req.user.orgId }
      );
      if (!account) return R.notFound(res, 'Mail account not found');

      const fields = [];
      const params = { id: req.params.id, orgId: req.user.orgId };
      if (Object.prototype.hasOwnProperty.call(req.body, 'displayName')) { fields.push('display_name = :displayName'); params.displayName = req.body.displayName || null; }
      if (Object.prototype.hasOwnProperty.call(req.body, 'folderName')) { fields.push('folder_name = :folderName'); params.folderName = req.body.folderName || 'INBOX'; }
      if (Object.prototype.hasOwnProperty.call(req.body, 'settings')) {
        fields.push('settings_json = :settingsJson');
        params.settingsJson = JSON.stringify(encryptSecretFields(mergeSettings(decryptSecretFields(require('../documents.common').parseJson(account.settings_json, {})), req.body.settings || {})));
      }
      if (Object.prototype.hasOwnProperty.call(req.body, 'isActive')) { fields.push('is_active = :isActive'); params.isActive = req.body.isActive ? 1 : 0; }
      if (!fields.length) return R.badRequest(res, 'No fields to update');

      await db.query(
        `UPDATE mail_accounts
            SET ${fields.join(', ')}, updated_at = NOW()
          WHERE id = :id AND org_id = :orgId`,
        params
      );

      return R.noContent(res);
    } catch (err) {
      logDocumentsError('PATCH /mail-accounts/:id', err, { orgId: req.user?.orgId, id: req.params.id, body: req.body });
      next(err);
    }
  }
);

module.exports = { router };
