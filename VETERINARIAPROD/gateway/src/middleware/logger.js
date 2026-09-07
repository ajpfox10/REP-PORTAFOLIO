'use strict';

/**
 * Logger — Winston + daily-rotate-file + Morgan stream.
 * Mirrors apipersonal logging stack.
 *
 * Outputs:
 *   console       — always (colorised in dev, JSON in prod)
 *   logs/app-%DATE%.log      — all levels, rotated daily, keep 14 days, max 20MB
 *   logs/error-%DATE%.log    — error level only
 */

const winston     = require('winston');
const DailyRotate = require('winston-daily-rotate-file');
const morgan      = require('morgan');
const path        = require('path');

const LOG_DIR  = process.env.LOG_DIR || path.join(process.cwd(), 'logs');
const isProd   = process.env.NODE_ENV === 'production';
const level    = process.env.LOG_LEVEL || (isProd ? 'info' : 'debug');

// ── Formats ───────────────────────────────────────────────────────────────────
const jsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

const prettyFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack, ...rest }) => {
    const extra = Object.keys(rest).length ? ' ' + JSON.stringify(rest) : '';
    return `${timestamp} [${level}] ${stack || message}${extra}`;
  }),
);

// ── Transports ────────────────────────────────────────────────────────────────
const transports = [
  new winston.transports.Console({
    format: isProd ? jsonFormat : prettyFormat,
  }),
];

// File transports — only when LOG_DIR is writable (skip in unit tests)
if (process.env.LOG_TO_FILE !== 'false') {
  const rotateOpts = {
    dirname:       LOG_DIR,
    datePattern:   'YYYY-MM-DD',
    zippedArchive: true,
    maxSize:       '20m',
    maxFiles:      '14d',
    format:        jsonFormat,
  };

  transports.push(
    new DailyRotate({ ...rotateOpts, filename: 'app-%DATE%.log', level }),
    new DailyRotate({ ...rotateOpts, filename: 'error-%DATE%.log', level: 'error' }),
  );
}

// ── Logger instance ───────────────────────────────────────────────────────────
const logger = winston.createLogger({ level, transports });

// ── Morgan HTTP stream → winston ──────────────────────────────────────────────
// Strip sensitive query-string parameters (token, api_key, secret) from logged URLs
// to avoid credential leakage in log files (e.g. WS upgrade with ?token= in dev).
const SENSITIVE_QS_RE = /([?&])(token|api_key|secret|password|access_token|refresh_token)=[^&]*/gi;
function sanitizeUrlForLog(url) {
  return (url || '').replace(SENSITIVE_QS_RE, '$1$2=[REDACTED]');
}

morgan.token('safe-url', (req) => sanitizeUrlForLog(req.originalUrl || req.url));

const morganFormat = isProd
  ? ':remote-addr :method :safe-url :status :res[content-length] :response-time ms :req[x-request-id]'
  : ':method :safe-url :status :response-time ms';

const morganMiddleware = morgan(
  morganFormat,
  { stream: { write: (msg) => logger.http(msg.trim()) } },
);

module.exports = { logger, morganMiddleware };
