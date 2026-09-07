'use strict';

const { Router } = require('express');
const { db, R, portalAuth, fcm, publishPortalEvent, vBody, validate, log } = require('../portal.common');

const router = Router();

router.post('/register',
  portalAuth,
  vBody('token').notEmpty(),
  validate,
  async (req, res, next) => {
    try {
      const { token, platform = 'web', deviceName } = req.body;

      // BUG-007: evitar secuestro de token FCM — si el token ya pertenece a otro cliente del portal,
      // des-registrarlo primero para que no reciba notificaciones de terceros
      await db.query(
        `DELETE FROM portal_fcm_tokens WHERE token = :token AND client_id <> :uid`,
        { token, uid: req.owner.clientId }
      ).catch(() => {});

      await db.query(
        `INSERT INTO portal_fcm_tokens (client_id, org_id, token, platform, device_name, is_active, last_used_at)
         VALUES (:uid, :oid, :token, :platform, :device, 1, NOW())
         ON DUPLICATE KEY UPDATE is_active=1, last_used_at=NOW()`,
        { uid: req.owner.clientId, oid: req.owner.orgId || 0, token, platform, device: deviceName || null }
      );

      // BUG-014: sanitizar nombre del topic (FCM requiere [a-zA-Z0-9-_.~%]+)
      const safeTopic = `owner_${String(req.owner.clientId).replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
      await fcm.subscribeToTopic([token], safeTopic).catch((err) => {
        log.warn('fcm subscribe failed', { message: err.message });
      });
      publishPortalEvent('portal.owner.fcm_registered', {
        clientId: req.owner.clientId,
        orgId: req.owner.orgId || null,
        platform,
        deviceName: deviceName || null,
      }, req);
      return R.ok(res, { message: 'Token FCM registrado' });
    } catch (e) { next(e); }
  }
);

module.exports = router;
