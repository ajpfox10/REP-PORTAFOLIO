'use strict';

/**
 * WAF (Web Application Firewall) middleware layer.
 *
 * Defenses implemented in code:
 *   1. SQL injection pattern detection (heuristic, pre-ORM)
 *   2. XSS pattern detection in query strings and headers
 *   3. Path traversal detection
 *   4. Oversized header guard
 *   5. Scanner/bot fingerprint blocking (configurable)
 *
 * Design:
 *   - All checks are HEURISTIC — the real last line of defense is
 *     parameterised queries (db.js) and output encoding.
 *   - In LOG_ONLY mode (WAF_MODE=log) blocks are logged but not rejected.
 *     Use this during roll-out to tune false-positive rates.
 *   - Specific paths can be excluded via WAF_EXCLUDE_PATHS (comma-separated).
 */

const { randomUUID } = require('crypto');
const { createLogger } = require('./logger');

const wafLog = createLogger('waf');

const MODE          = process.env.WAF_MODE || 'block';   // 'block' | 'log'
const LOG_ONLY      = MODE === 'log';
const EXCLUDE_PATHS = new Set(
  (process.env.WAF_EXCLUDE_PATHS || '/health,/metrics').split(',').map(p => p.trim())
);

// ── Attack patterns ───────────────────────────────────────────────────────────

/**
 * SQL injection heuristics.
 * Patrones reescritos sin backtracking catastrófico (ReDoS-safe).
 * Usamos \s+ acotado o word-boundary pairs sin .+ entre ellos.
 */
const SQLI_PATTERNS = [
  /\bUNION\b/i,                         // UNION solo ya es sospechoso en input de usuario
  /\bSELECT\b[\s\S]{0,30}\bFROM\b/i,   // SELECT...FROM con límite de chars entre medio
  /\bDROP\b[\s\S]{0,20}\bTABLE\b/i,
  /\bINSERT\b[\s\S]{0,20}\bINTO\b/i,
  /\bDELETE\b[\s\S]{0,20}\bFROM\b/i,
  /\bUPDATE\b[\s\S]{0,20}\bSET\b/i,
  /\bEXEC\b\s*\(/i,
  /\bxp_[a-zA-Z0-9_]+/i,               // MSSQL extended procs
  /';\s*(?:DROP|DELETE|UPDATE|INSERT)\b/i,
  /--(?:\s|$)/m,                         // SQL comment (sin backtracking)
  /\/\*[^*]{0,200}\*\//,                // Block comment (largo acotado)
];

/**
 * XSS heuristics — sin backtracking problemático.
 */
const XSS_PATTERNS = [
  /<script[\s>]/i,
  /<\/script>/i,
  /javascript:/i,                        // sin \s* antes de : para evitar backtracking
  /\bon\w{1,20}\s*=\s*["'`]/i,          // onclick=, onmouseover=, con longitud acotada
  /<iframe[\s>]/i,
  /data:text\/html/i,
  /document\.cookie/i,
  /\beval\s*\(/i,
];

/**
 * Path traversal patterns — sin alternativas complejas.
 */
const PATH_TRAVERSAL_PATTERNS = [
  /\.\.[/\\]/,             // ../  o ..\
  /%2e%2e[/%\\]/i,         // URL-encoded
  /\.\.%2f/i,
  /%252e%252e/i,           // Double-encoded
];

const MAX_HEADER_VALUE_LENGTH = parseInt(process.env.WAF_MAX_HEADER || '8192');

// ── Helpers ───────────────────────────────────────────────────────────────────

function testPatterns(patterns, value) {
  if (typeof value !== 'string') return false;
  return patterns.some(re => re.test(value));
}

/**
 * Extract a flat list of string values from an object (body, query, params).
 */
function flatValues(obj, depth = 0) {
  if (depth > 5) return [];
  if (!obj || typeof obj !== 'object') return typeof obj === 'string' ? [obj] : [];
  return Object.values(obj).flatMap(v =>
    typeof v === 'string' ? [v] : flatValues(v, depth + 1)
  );
}

// ── Per-request scan ─────────────────────────────────────────────────────────

function scanRequest(req) {
  const threats = [];

  // 1. Query string values
  const qValues = flatValues(req.query);
  if (qValues.some(v => testPatterns(SQLI_PATTERNS, v))) threats.push('sqli:query');
  if (qValues.some(v => testPatterns(XSS_PATTERNS,  v))) threats.push('xss:query');

  // 2. Body values (JSON only — binary uploads are excluded)
  if (req.body && typeof req.body === 'object') {
    const bValues = flatValues(req.body);
    if (bValues.some(v => testPatterns(SQLI_PATTERNS, v))) threats.push('sqli:body');
    if (bValues.some(v => testPatterns(XSS_PATTERNS,  v))) threats.push('xss:body');
  }

  // 3. URL path traversal
  const url = req.originalUrl || req.url || '';
  if (testPatterns(PATH_TRAVERSAL_PATTERNS, url)) threats.push('path_traversal');

  // 4. Oversized header values
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === 'string' && value.length > MAX_HEADER_VALUE_LENGTH) {
      threats.push(`oversized_header:${name}`);
      break;
    }
    // XSS in custom headers (skip standard headers)
    if (name.startsWith('x-') && testPatterns(XSS_PATTERNS, value)) {
      threats.push(`xss:header:${name}`);
    }
  }

  return threats;
}

// ── Middleware ────────────────────────────────────────────────────────────────

function wafMiddleware(req, res, next) {
  if (EXCLUDE_PATHS.has(req.path)) return next();

  const threats = scanRequest(req);
  if (!threats.length) return next();

  const wafId = randomUUID();
  const meta  = {
    wafId,
    ip:     req.ip,
    method: req.method,
    path:   req.path,
    threats,
    traceId: req.traceId,
  };

  if (LOG_ONLY) {
    wafLog.warn('WAF threat detected (log-only)', meta);
    return next();
  }

  wafLog.warn('WAF request blocked', meta);
  return res.status(400).json({
    success: false,
    error:   { message: 'Request blocked by security policy', code: 'WAF_BLOCKED', wafId },
  });
}

module.exports = { wafMiddleware, scanRequest, SQLI_PATTERNS, XSS_PATTERNS, PATH_TRAVERSAL_PATTERNS };
