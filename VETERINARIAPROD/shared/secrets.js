'use strict';

const fs = require('fs');
const path = require('path');

let bundleCache = null;
let bundleLoaded = false;
// BUG-28: TTL para invalidar la caché del bundle en procesos de larga duración (10 minutos)
const BUNDLE_CACHE_TTL_MS = parseInt(process.env.SECRETS_CACHE_TTL_MS || String(10 * 60 * 1000), 10);
let bundleCachedAt = 0;

function normalizeValue(value, { trim = true } = {}) {
  if (value == null) return value;
  const text = String(value);
  return trim ? text.trim() : text;
}

function loadBundle() {
  // BUG-28: respetar TTL — invalidar caché pasado el tiempo configurado
  const now = Date.now();
  if (bundleLoaded && (now - bundleCachedAt) < BUNDLE_CACHE_TTL_MS) return bundleCache;

  bundleLoaded = true;
  bundleCache = {};
  bundleCachedAt = now;

  const inlineJson = process.env.SECRETS_JSON;
  const bundleFile = process.env.SECRETS_FILE;

  // BUG-27: advertir si se usa SECRETS_JSON en producción (secretos en variables de entorno son un riesgo)
  if (inlineJson && process.env.NODE_ENV === 'production') {
    // eslint-disable-next-line no-console
    console.warn('[secrets] WARNING: SECRETS_JSON is set in production. Prefer SECRETS_FILE pointing to a mounted secret volume.');
  }

  try {
    if (inlineJson) {
      bundleCache = JSON.parse(inlineJson);
      return bundleCache;
    }

    if (bundleFile) {
      bundleCache = JSON.parse(fs.readFileSync(path.resolve(bundleFile), 'utf8'));
      return bundleCache;
    }
  } catch (err) {
    const wrapped = new Error(`Secrets bundle could not be loaded: ${err.message}`);
    wrapped.cause = err;
    throw wrapped;
  }

  return bundleCache;
}

function readSecretFile(filePath, { trim = false } = {}) {
  if (!filePath) return null;
  return normalizeValue(fs.readFileSync(path.resolve(filePath), 'utf8'), { trim });
}

function getSecret(name, {
  defaultValue = null,
  trim = true,
  allowEmpty = false,
  fileEnvName = `${name}_FILE`,
} = {}) {
  const direct = process.env[name];
  if (direct != null) {
    const value = normalizeValue(direct, { trim });
    if (allowEmpty || value !== '') return value;
  }

  const fromFile = process.env[fileEnvName];
  if (fromFile) {
    const value = readSecretFile(fromFile, { trim });
    if (allowEmpty || value !== '') return value;
  }

  const bundle = loadBundle();
  if (bundle && typeof bundle === 'object' && Object.prototype.hasOwnProperty.call(bundle, name)) {
    const value = normalizeValue(bundle[name], { trim });
    if (allowEmpty || value !== '') return value;
  }

  return defaultValue;
}

function getAnySecret(names, options = {}) {
  for (const name of names) {
    const value = getSecret(name, options);
    if (value != null && (options.allowEmpty || value !== '')) return value;
  }
  return options.defaultValue ?? null;
}

function resetSecretCache() {
  bundleCache = null;
  bundleLoaded = false;
  bundleCachedAt = 0;
}

module.exports = {
  getSecret,
  getAnySecret,
  readSecretFile,
  resetSecretCache,
};
