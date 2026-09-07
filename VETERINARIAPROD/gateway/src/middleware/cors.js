'use strict';

const cors = require('cors');

const allowedOrigins = (process.env.ALLOWED_ORIGINS || process.env.CORS_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// OT-104: In production, ALLOWED_ORIGINS must be explicitly set, must use HTTPS,
// and must not contain localhost or private/internal IP addresses.
if (IS_PRODUCTION) {
  if (allowedOrigins.length === 0) {
    throw new Error('ALLOWED_ORIGINS must be set in production (e.g. https://app.example.com)');
  }
  if (allowedOrigins.includes('*')) {
    throw new Error('ALLOWED_ORIGINS cannot be "*" in production — set explicit origins');
  }

  // Regex for localhost, loopback, link-local, and RFC-1918 private ranges
  const UNSAFE_ORIGIN_RE = /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|::1|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+)(:\d+)?(\/.*)?$/i;

  for (const origin of allowedOrigins) {
    if (UNSAFE_ORIGIN_RE.test(origin)) {
      throw new Error(`ALLOWED_ORIGINS contains unsafe internal origin '${origin}' — not permitted in production`);
    }
    if (/^http:/i.test(origin)) {
      throw new Error(`ALLOWED_ORIGINS contains non-HTTPS origin '${origin}' — credentials:true requires HTTPS`);
    }
  }
}

const corsOptions = {
  origin(origin, callback) {
    // Allow server-to-server requests (no Origin header)
    // Rechazar explícitamente origin="null" (sandboxed iframes, file://) — es
    // la cadena "null", no el valor JS null/undefined.
    if (origin === 'null') return callback(new Error('CORS: null origin not allowed'));
    if (!origin) return callback(null, true);

    // Development only: allow all origins if explicitly set to '*' or list is empty
    if (!IS_PRODUCTION && (allowedOrigins.includes('*') || allowedOrigins.length === 0)) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`CORS: origin '${origin}' not allowed`));
  },
  methods:            ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders:     ['Content-Type', 'Authorization', 'X-API-Key', 'X-Request-Id', 'X-CSRF-Token'],
  exposedHeaders:     ['X-Total-Count', 'X-Page', 'X-Limit', 'X-Request-Id'],
  credentials:        true,
  maxAge:             86400,   // preflight cache 24h
  optionsSuccessStatus: 204,
};

module.exports = cors(corsOptions);
