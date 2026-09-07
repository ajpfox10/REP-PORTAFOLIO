'use strict';

const { getSecret } = require('./secrets');

const CRITICAL_VARS = [
  'INTERNAL_SECRET',
  'CSRF_SECRET',
  'JWT_PRIVATE_KEY',
  'JWT_KEYRING_JSON',
  'STRIPE_WEBHOOK_SECRET',
  'FIELD_ENCRYPTION_SECRET',
];

// Variables that MUST be present in production (at least one JWT key source).
// JWT_KEYRING_JSON OR JWT_PRIVATE_KEY is required — checked separately below.
const REQUIRED_IN_PROD = [
  'INTERNAL_SECRET',
  'CSRF_SECRET',
  'FIELD_ENCRYPTION_SECRET',
];

function validateCriticalEnv(log) {
  if (process.env.NODE_ENV === 'test') return;

  // 1. Detect placeholder values
  const placeholders = CRITICAL_VARS.filter((name) => {
    const val = getSecret(name, { defaultValue: '' });
    return val && (val === 'CHANGE_ME' || val.startsWith('CHANGE_ME_'));
  });

  if (placeholders.length > 0) {
    const msg = `Critical env vars still have placeholder values: ${placeholders.join(', ')}`;
    if (process.env.NODE_ENV === 'production') {
      log.error(`STARTUP BLOCKED — ${msg}`);
      process.exit(1);
    } else {
      log.warn(`WARNING — ${msg}`);
    }
  }

  // 2. In production, also check that required vars are not empty/absent
  if (process.env.NODE_ENV === 'production') {
    const missing = REQUIRED_IN_PROD.filter((name) => {
      const val = getSecret(name, { defaultValue: '' });
      return !val || val.trim() === '';
    });

    // JWT: require at least one of JWT_KEYRING_JSON or JWT_PRIVATE_KEY
    const hasJwtKey = Boolean(
      getSecret('JWT_KEYRING_JSON', { defaultValue: '' }).trim() ||
      getSecret('JWT_PRIVATE_KEY', { defaultValue: '', trim: false }).trim()
    );
    if (!hasJwtKey) missing.push('JWT_KEYRING_JSON or JWT_PRIVATE_KEY');

    if (missing.length > 0) {
      log.error(`STARTUP BLOCKED — Required env vars missing in production: ${missing.join(', ')}`);
      process.exit(1);
    }
  }
}

module.exports = { validateCriticalEnv };
