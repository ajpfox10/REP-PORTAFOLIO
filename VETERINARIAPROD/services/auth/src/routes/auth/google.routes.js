'use strict';

const { Router } = require('express');
const { v4: uuidv4 } = require('uuid');
const calendar = require('../../../../../shared/calendar');
const R = require('../../../../../shared/response');
const { createLogger } = require('../../../../../shared/logger');
const { requireInternalSig, fromHeaders } = require('./_common');

const router = Router();
const log = createLogger('auth-google');

router.get('/google/connect', requireInternalSig, fromHeaders, async (req, res) => {
  const { getRedisSingleton } = require('../../../../../shared/redis');

  const userId = req.user.userId;
  if (!userId) return R.unauthorized(res, 'Unauthorized');

  const nonce = uuidv4();

  try {
    const redis = await getRedisSingleton('auth-oauth', 'auth-oauth');
    await redis.setEx(`oauth:nonce:${nonce}`, 600, String(userId));
  } catch (err) {
    log.warn('OAuth nonce persistence failed', { error: err.message, userId });
    return R.error(res, 503, 'Service temporarily unavailable', { message: err.message }, 'SVC_005');
  }

  return res.redirect(calendar.getAuthUrl(nonce));
});

router.get('/google/callback', async (req, res) => {
  const { code, state: nonce, error } = req.query;
  const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

  if (error) {
    return res.redirect(`${FRONTEND_URL}/settings/calendar?error=oauth_denied`);
  }
  if (!code || !nonce) {
    return R.error(res, 400, 'Parámetros inválidos', null, 'VAL_001');
  }

  let userId;
  try {
    const { getRedisSingleton } = require('../../../../../shared/redis');
    const redis = await getRedisSingleton('auth-oauth', 'auth-oauth');
    userId = await redis.get(`oauth:nonce:${nonce}`);
    if (userId) await redis.del(`oauth:nonce:${nonce}`);
  } catch (err) {
    log.warn('OAuth state lookup failed', { error: err.message });
    return res.redirect(`${FRONTEND_URL}/settings/calendar?error=internal_error`);
  }

  if (!userId) {
    return res.redirect(`${FRONTEND_URL}/settings/calendar?error=invalid_state`);
  }

  try {
    const tokens = await calendar.exchangeCode(userId, code);

    // Verificar que la cuenta Google pertenece al mismo email del usuario autenticado
    let googleEmail = null;
    if (tokens.id_token) {
      try {
        const payload = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString('utf8'));
        googleEmail = payload.email || null;
      } catch (decodeErr) {
        log.warn('OAuth id_token decode failed', { error: decodeErr.message, userId });
      }
    }

    if (googleEmail) {
      const db = require('../../../../../shared/db');
      const userRow = await db.queryOne('SELECT email FROM users WHERE id = :id', { id: userId }).catch(() => null);
      if (userRow && userRow.email && googleEmail.toLowerCase() !== userRow.email.toLowerCase()) {
        log.warn('OAuth Google email mismatch', { userId, googleEmail, userEmail: userRow.email });
        return res.redirect(`${FRONTEND_URL}/settings/calendar?error=email_mismatch`);
      }
    } else {
      log.warn('OAuth Google email could not be verified from id_token', { userId });
    }

    return res.redirect(`${FRONTEND_URL}/settings/calendar?connected=true`);
  } catch (err) {
    log.warn('OAuth exchange failed', { error: err.message, userId });
    return res.redirect(`${FRONTEND_URL}/settings/calendar?error=exchange_failed`);
  }
});

module.exports = router;
