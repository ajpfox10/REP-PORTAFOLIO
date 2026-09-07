'use strict';

const { db, R, parseJson, logDocumentsError } = require('../documents.common');
const { encrypt, decrypt } = require('../../../../shared/encryption');

// B-1: campos secretos de cuentas IMAP que deben cifrarse en BD
const IMAP_SECRET_FIELDS = ['password', 'clientSecret', 'refreshToken', 'accessToken'];

function encryptSecretFields(settings = {}) {
  const copy = { ...settings };
  for (const key of IMAP_SECRET_FIELDS) {
    if (copy[key] && typeof copy[key] === 'string' && copy[key] !== '********') {
      copy[key] = encrypt(copy[key]);
    }
  }
  return copy;
}

function decryptSecretFields(settings = {}) {
  const copy = { ...settings };
  for (const key of IMAP_SECRET_FIELDS) {
    if (copy[key] && typeof copy[key] === 'string') {
      try {
        const parts = copy[key].split(':');
        if (parts.length === 3) copy[key] = decrypt(copy[key]);
      } catch { /* valor en texto plano pre-cifrado, dejarlo como está */ }
    }
  }
  return copy;
}

function sanitizeSettings(provider, settings = {}) {
  const copy = { ...settings };
  const commonSecrets = ['password', 'clientSecret', 'refreshToken', 'accessToken'];
  for (const key of commonSecrets) {
    if (copy[key]) copy[key] = '********';
  }
  if (provider === 'imap' && copy.username) copy.username = String(copy.username);
  return copy;
}

function mergeSettings(existing = {}, incoming = {}) {
  const merged = { ...existing, ...incoming };
  const secretKeys = ['password', 'clientSecret', 'refreshToken', 'accessToken'];
  for (const key of secretKeys) {
    if (incoming[key] === '********' || incoming[key] == null || incoming[key] === '') {
      if (existing[key] != null) merged[key] = existing[key];
      else delete merged[key];
    }
  }
  return merged;
}

async function loadAccount(id, orgId) {
  const row = await db.queryOne(
    `SELECT id, org_id, provider, email_address, display_name, folder_name, is_active,
            last_synced_at, last_error, created_at, updated_at, settings_json
       FROM mail_accounts
      WHERE id = :id AND org_id = :orgId`,
    { id, orgId }
  );
  if (!row) return null;
  return {
    ...row,
    is_active: Boolean(row.is_active),
    settings: decryptSecretFields(parseJson(row.settings_json, {})),
  };
}

module.exports = {
  db,
  R,
  sanitizeSettings,
  mergeSettings,
  encryptSecretFields,
  decryptSecretFields,
  loadAccount,
  logDocumentsError,
};
