'use strict';

/**
 * TOTP-based two-factor authentication — mirrors apipersonal 2FA module.
 * Uses otplib (RFC 6238) + QR code generation.
 *
 * Flow:
 *   1. setupTwoFactor(userId, email)  → { secret, otpauthUrl, qrDataUrl }
 *   2. User scans QR with authenticator app
 *   3. verifyTwoFactor(secret, token) → true|false
 *   4. On success: persist secret to users table (two_factor_secret, two_factor_enabled=1)
 */

const { authenticator } = require('otplib');
const QRCode            = require('qrcode');
const { createLogger }  = require('./logger');

const APP_NAME = process.env.APP_NAME || 'VetManager Pro';
const log = createLogger('two-factor');

// OTP window: accept 1 period before/after to handle clock drift
authenticator.options = { window: 1 };

/**
 * Generate a new TOTP secret + QR code for a user.
 *
 * @param {string} userId
 * @param {string} email
 * @returns {{ secret: string, otpauthUrl: string, qrDataUrl: string }}
 */
async function setupTwoFactor(userId, email) {
  const secret     = authenticator.generateSecret(32);
  const label      = encodeURIComponent(`${APP_NAME}:${email}`);
  const issuer     = encodeURIComponent(APP_NAME);
  const otpauthUrl = `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;

  const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { errorCorrectionLevel: 'H', width: 256 });

  return { secret, otpauthUrl, qrDataUrl };
}

/**
 * Verify a 6-digit TOTP token against a stored secret.
 *
 * Sanitiza el token antes de pasarlo a otplib: solo dígitos, exactamente 6 chars.
 * Esto previene que valores malformados causen comportamiento inesperado en otplib.
 *
 * @param {string} secret  — the user's stored TOTP secret
 * @param {string} token   — the 6-digit code from the authenticator app
 * @returns {boolean}
 */
function verifyTwoFactor(secret, token) {
  // Validar formato antes de invocar otplib
  const tokenStr = String(token || '').trim();
  if (!/^\d{6}$/.test(tokenStr)) {
    log.warn('2FA verification rejected: token format invalid');
    return false;
  }
  if (!secret || typeof secret !== 'string') {
    log.warn('2FA verification rejected: secret inválido');
    return false;
  }
  try {
    return authenticator.verify({ token: tokenStr, secret });
  } catch (err) {
    log.warn('2FA verification failed', { error: err.message });
    return false;
  }
}

/**
 * Generate a one-time recovery code (16 hex chars, grouped for readability).
 * Call once during 2FA setup; store hashed copies in DB.
 */
function generateRecoveryCode() {
  const bytes = require('crypto').randomBytes(8).toString('hex').toUpperCase();
  return `${bytes.slice(0,4)}-${bytes.slice(4,8)}-${bytes.slice(8,12)}-${bytes.slice(12,16)}`;
}

/**
 * Generate a set of recovery codes (default 8).
 * @param {number} [count=8]
 * @returns {string[]}
 */
function generateRecoveryCodes(count = 8) {
  return Array.from({ length: count }, generateRecoveryCode);
}

module.exports = {
  setupTwoFactor,
  verifyTwoFactor,
  generateRecoveryCodes,
};
