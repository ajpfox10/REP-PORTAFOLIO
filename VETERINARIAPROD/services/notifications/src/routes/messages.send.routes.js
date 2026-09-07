'use strict';

const express = require('express');
const {
  R,
  log,
  messaging,
  queueNotificationRetry,
  logMessage,
} = require('../notifications.common');

const router = express.Router();

// E.164 phone — acepta +549... ó 549... (hasta 15 dígitos)
const PHONE_RE = /^\+?[1-9]\d{6,14}$/;

// Mensaje: máximo 1600 caracteres (límite SMS concatenado Twilio)
const MAX_MESSAGE_LENGTH = 1600;

function sanitizeHeaderValue(value) {
  // Elimina CR, LF y NUL para prevenir header injection en SMS/email
  return String(value || '').replace(/[\r\n\0]/g, '');
}

router.post('/', async (req, res, next) => {
  try {
    const { channel = 'whatsapp', to, message } = req.body;
    if (!to || !message) return R.badRequest(res, 'to y message son requeridos');
    if (!['sms', 'whatsapp', 'both'].includes(channel)) return R.badRequest(res, 'channel debe ser sms, whatsapp o both');

    const cleanTo = sanitizeHeaderValue(to);
    if (!PHONE_RE.test(cleanTo)) return R.badRequest(res, 'to debe ser un número de teléfono E.164 válido');

    const cleanMessage = sanitizeHeaderValue(message);
    if (cleanMessage.length > MAX_MESSAGE_LENGTH) return R.badRequest(res, `message no puede superar ${MAX_MESSAGE_LENGTH} caracteres`);

    let result;
    try {
      if (channel === 'sms') result = await messaging.sendSms(cleanTo, cleanMessage);
      if (channel === 'whatsapp') result = await messaging.sendWhatsApp(cleanTo, cleanMessage);
      if (channel === 'both') {
        const [sms, wa] = await Promise.allSettled([
          messaging.sendSms(cleanTo, cleanMessage),
          messaging.sendWhatsApp(cleanTo, cleanMessage),
        ]);
        result = { sms: sms.value || sms.reason?.message, whatsapp: wa.value || wa.reason?.message };
        if (sms.status === 'rejected') await queueNotificationRetry({ channel: 'sms', payload: { to: cleanTo, message: cleanMessage }, req });
        if (wa.status === 'rejected') await queueNotificationRetry({ channel: 'whatsapp', payload: { to: cleanTo, message: cleanMessage }, req });
      }
    } catch (err) {
      await queueNotificationRetry({ channel, payload: { to: cleanTo, message: cleanMessage }, req });
      return res.status(202).json({ success: true, queued: true, message: 'Notification queued for retry', error: err.message });
    }

    await logMessage({ channel, to: cleanTo, message: cleanMessage, result, userId: req.user.userId, branchId: req.user.branchId });
    return R.ok(res, result);
  } catch (err) {
    log.warn('message send failed', { err: err.message });
    next(err);
  }
});

module.exports = router;
