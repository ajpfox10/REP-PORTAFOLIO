'use strict';
/**
 * CAPTCHA middleware — valida tokens hCaptcha en endpoints sensibles.
 * Flag-gated: si HCAPTCHA_SECRET no está en env, hace bypass silencioso.
 * Feature flag: 'captcha_login' en featureFlags.js
 */
const HCAPTCHA_URL = 'https://hcaptcha.com/siteverify';
const { createLogger } = require('./logger');
const captchaLog = createLogger('captcha');

function parseBooleanFlag(value) {
  if (value === undefined || value === null || value === '') return null;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function isCaptchaEnabled() {
  const explicit = parseBooleanFlag(process.env.CAPTCHA_ENABLED);
  if (explicit !== null) return explicit;
  return Boolean(process.env.HCAPTCHA_SECRET);
}

function getCaptchaPublicConfig() {
  const siteKey = process.env.HCAPTCHA_SITE_KEY || process.env.VITE_HCAPTCHA_SITE_KEY || '';
  return {
    enabled: isCaptchaEnabled(),
    siteKey: isCaptchaEnabled() ? siteKey : '',
  };
}

async function verifyCaptcha(token, remoteip) {
  const secret = process.env.HCAPTCHA_SECRET;
  if (!secret) return true; // bypass en dev/test

  try {
    const params = new URLSearchParams({ secret, response: token, remoteip: remoteip || '' });
    const resp = await fetch(`${HCAPTCHA_URL}`, {
      method: 'POST',
      body: params,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      // SEC: timeout para evitar que una respuesta lenta de hCaptcha bloquee indefinidamente
      signal: AbortSignal.timeout(5000),
    });
    const data = await resp.json();
    return data.success === true;
  } catch (err) {
    // SEC: fail-open para no bloquear logins legítimos durante downtime de hCaptcha.
    // Se loguea como warning para que sea detectable en caso de abuso o bloqueo sistemático.
    captchaLog.warn('hCaptcha verification request failed — allowing through (fail-open)', {
      error: err?.message,
      remoteip: remoteip ? remoteip.slice(0, 15) : null,
    });
    return true;
  }
}

/**
 * Express middleware que valida el campo `captchaToken` del body.
 * Bypass automático si:
 *   - HCAPTCHA_SECRET no está configurado
 *   - NODE_ENV === 'test'
 *   - El feature flag 'captcha_login' está desactivado
 */
function captchaMiddleware(req, res, next) {
  if (process.env.NODE_ENV === 'test') return next();
  if (!isCaptchaEnabled()) return next();
  if (!process.env.HCAPTCHA_SECRET) {
    if (process.env.NODE_ENV === 'production') {
      return res.status(503).json({ error: 'CAPTCHA service not configured' });
    }
    // En desarrollo/staging, permitir pasar sin CAPTCHA
    return next();
  }

  const token = req.body?.captchaToken;
  if (!token) {
    return res.status(400).json({
      success: false,
      error: { message: 'CAPTCHA token required', code: 'VAL_001' },
    });
  }

  const remoteip = req.ip || req.headers['x-forwarded-for'];
  verifyCaptcha(token, remoteip).then(valid => {
    if (!valid) {
      return res.status(400).json({
        success: false,
        error: { message: 'CAPTCHA verification failed', code: 'AUTH_016' },
      });
    }
    next();
  }).catch(next);
}

module.exports = { captchaMiddleware, verifyCaptcha, isCaptchaEnabled, getCaptchaPublicConfig };
