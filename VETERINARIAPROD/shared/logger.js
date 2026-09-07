'use strict';

/**
 * Shared structured logger — Winston.
 * Used by all microservices via serviceBase.buildApp().
 *
 * Console: colorised in dev, JSON in prod.
 * File transports: opt-in via LOG_TO_FILE=true (gateway enables them separately).
 */

const winston = require('winston');

const isProd  = process.env.NODE_ENV === 'production';
const level   = process.env.LOG_LEVEL || (isProd ? 'info' : 'debug');

// SEC: campos que nunca deben aparecer en los logs.
// Redactar para prevenir filtración de credenciales/tokens/PII en logs.
const REDACTED = '[REDACTED]';
const SENSITIVE_KEYS = new Set([
  'password', 'passwd', 'pass',
  'secret', 'secret_key', 'secretkey',
  'token', 'access_token', 'refresh_token', 'id_token',
  'authorization', 'auth',
  'api_key', 'apikey', 'api_secret',
  'private_key', 'privatekey',
  'credit_card', 'card_number', 'cvv', 'cvc',
  'two_factor_secret', 'totp_secret',
  // PII / datos fiscales argentinos
  'ssn', 'tax_id', 'dni', 'cuit', 'cuil',
  // Credenciales de cert/clave AFIP
  'cert', 'afip_cert', 'afip_key',
]);

function redactSensitive(obj, depth = 0) {
  if (depth > 6 || obj == null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(v => redactSensitive(v, depth + 1));
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase().replace(/[_-]/g, '_'))) {
      result[k] = REDACTED;
    } else if (typeof v === 'object' && v !== null) {
      result[k] = redactSensitive(v, depth + 1);
    } else {
      result[k] = v;
    }
  }
  return result;
}

// Formato Winston que redacta campos sensibles antes de serializar
const redactFormat = winston.format((info) => {
  const { level: lvl, message, timestamp, stack, service, ...rest } = info;
  const redacted = redactSensitive(rest);
  return Object.assign(info, redacted);
})();

const jsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  redactFormat,
  winston.format.json(),
);

const prettyFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  redactFormat,
  winston.format.printf(({ timestamp, level: lvl, message, stack, ...rest }) => {
    const extra = Object.keys(rest).length ? ' ' + JSON.stringify(rest) : '';
    return `${timestamp} [${lvl}] ${stack || message}${extra}`;
  }),
);

function createLogger(service) {
  return winston.createLogger({
    level,
    defaultMeta: { service },
    transports: [
      new winston.transports.Console({
        format: isProd ? jsonFormat : prettyFormat,
        silent: process.env.NODE_ENV === 'test',
      }),
    ],
  });
}

module.exports = { createLogger };
