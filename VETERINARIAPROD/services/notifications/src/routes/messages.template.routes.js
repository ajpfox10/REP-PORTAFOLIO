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

// Allowlist de templates permitidos — evita template injection y enumeration
const ALLOWED_TEMPLATES = new Set([
  'appointmentReminder',
  'vaccinationReminder',
  'dewormingReminder',
  'generalNotification',
]);

// E.164 phone
const PHONE_RE = /^\+?[1-9]\d{6,14}$/;

function sanitizeHeaderValue(value) {
  return String(value || '').replace(/[\r\n\0]/g, '');
}

// Sanitiza los valores de vars: solo strings/numbers, sin HTML triple-stache
function sanitizeVars(vars) {
  if (!vars || typeof vars !== 'object' || Array.isArray(vars)) return {};
  const clean = {};
  for (const [key, value] of Object.entries(vars)) {
    if (typeof key !== 'string' || key.length > 64) continue;
    if (typeof value === 'string') {
      // Elimina marcas triple-stache {{{ }}} que bypasean el escaping de Handlebars
      clean[key] = value.replace(/\{\{\{[\s\S]*?\}\}\}/g, '').slice(0, 512);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      clean[key] = value;
    }
    // Descarta objetos anidados y arrays
  }
  return clean;
}

router.post('/', async (req, res, next) => {
  try {
    const { channel = 'whatsapp', to, template, vars = {} } = req.body;
    if (!to || !template) return R.badRequest(res, 'to y template son requeridos');

    const cleanTo = sanitizeHeaderValue(to);
    if (!PHONE_RE.test(cleanTo)) return R.badRequest(res, 'to debe ser un número de teléfono E.164 válido');

    if (!ALLOWED_TEMPLATES.has(template)) return R.badRequest(res, 'template no reconocido');

    const cleanVars = sanitizeVars(vars);

    let result;
    try {
      result = await messaging.sendTemplate(channel, cleanTo, template, cleanVars);
    } catch (err) {
      await queueNotificationRetry({ channel: 'template', payload: { channel, to: cleanTo, template, vars: cleanVars }, req });
      return res.status(202).json({ success: true, queued: true, message: 'Template queued for retry', error: err.message });
    }
    await logMessage({ channel, to: cleanTo, message: result.body, result: result.results, userId: req.user.userId, branchId: req.user.branchId, template });
    return R.ok(res, result);
  } catch (err) {
    log.warn('template send failed', { err: err.message });
    next(err);
  }
});

module.exports = router;
