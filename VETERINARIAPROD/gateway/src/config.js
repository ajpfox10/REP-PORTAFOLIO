'use strict';

const { getSecret } = require('../../shared/secrets');

function readBoolean(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw == null || raw === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
}

function readInt(name, defaultValue) {
  const raw = parseInt(process.env[name] || `${defaultValue}`, 10);
  return Number.isFinite(raw) ? raw : defaultValue;
}

function readCsv(name, fallback = []) {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

const currentApiVersion = process.env.API_VERSION || 'v1';
const supportedApiVersions = [...new Set(readCsv('API_VERSIONS', ['v1', 'v2', currentApiVersion]))];
const defaultApiVersion = process.env.API_DEFAULT_VERSION || currentApiVersion;

const _metricsTokenRaw = getSecret('METRICS_TOKEN', { defaultValue: '' }) || '';
if (
  (process.env.NODE_ENV === 'production') &&
  (_metricsTokenRaw === 'CHANGE_ME' || _metricsTokenRaw === '')
) {
  throw new Error('METRICS_TOKEN must be set to a secure value in production (current value is missing or default "CHANGE_ME")');
}

const config = {
  env: process.env.NODE_ENV || 'development',
  port: readInt('PORT', 4050),
  apiVersion: currentApiVersion,
  defaultApiVersion,
  supportedApiVersions,
  jsonBodyLimit: process.env.JSON_BODY_LIMIT || '512kb',
  metricsToken: _metricsTokenRaw,
  swaggerEnabled: process.env.NODE_ENV !== 'production' || readBoolean('SWAGGER_ENABLED', false),
  openApiValidate: process.env.OPENAPI_VALIDATE !== 'false',
  webhookWorkerEnabled: process.env.WEBHOOK_WORKER !== 'false',
  auditMode: process.env.AUDIT_MODE || 'all',
  wsHeartbeatIntervalMs: readInt('WS_HEARTBEAT_INTERVAL', 30000),
  dlp: {
    exportThreshold: readInt('DLP_EXPORT_THRESHOLD', 1000),
    exportWindowSecs: readInt('DLP_EXPORT_WINDOW_SECS', 300),
  },
};

module.exports = { config, readBoolean, readInt, readCsv };
