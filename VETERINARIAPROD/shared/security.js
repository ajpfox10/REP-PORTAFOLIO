'use strict';

/**
 * Security middleware collection — mirrors apipersonal hardening stack.
 * Exposes: helmet, hpp, compression, sanitize, ipGuard, requestId, idempotency,
 *          dnsRebindingGuard, openRedirectGuard, contentTypeGuard, cacheHeaders,
 *          safeDeserialize, sriHelper
 */

const helmet      = require('helmet');
// OT-088: hpp@0.2.3 sin updates desde 2016 pero funcional y sin CVEs conocidos.
// Protege contra HTTP Parameter Pollution (duplicación de query params).
// Alternativa evaluada: implementar inline con express-validator (addSanitizers).
// Mantenemos hpp por ahora: funcionalidad crítica, superficie de código mínima.
const hpp         = require('hpp');
const compression = require('compression');
const crypto      = require('crypto');
const { v4: uuidv4 } = require('uuid');
const db          = require('./db');
const R = require('./response');
const { createLogger } = require('./logger');

const log = createLogger('security');

// ── Helmet (HTTP security headers) ───────────────────────────────────────────
// Incluye Permissions-Policy para controlar acceso a cámara, micrófono y geoloc.
function csvEnv(name, fallback = []) {
  const value = process.env[name];
  if (!value) return fallback;
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function parseBooleanFlag(value) {
  if (value === undefined || value === null || value === '') return null;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function uniqueSources(sources) {
  return [...new Set(sources.filter(Boolean))];
}

function shouldAllowHCaptcha() {
  const explicit = parseBooleanFlag(process.env.CAPTCHA_ENABLED);
  return explicit === true ||
    Boolean(process.env.HCAPTCHA_SITE_KEY || process.env.VITE_HCAPTCHA_SITE_KEY);
}

function buildCspDirectives() {
  const connectSrc = ["'self'", ...csvEnv('CSP_CONNECT_SRC')];
  const scriptSrc = ["'self'", ...csvEnv('CSP_SCRIPT_SRC')];
  const styleSrc = ["'self'", ...csvEnv('CSP_STYLE_SRC')];
  const imgSrc = ["'self'", 'data:', 'https:', ...csvEnv('CSP_IMG_SRC')];
  const fontSrc = ["'self'", 'data:', 'https:', ...csvEnv('CSP_FONT_SRC')];
  const frameSrc = [...csvEnv('CSP_FRAME_SRC')];

  if (shouldAllowHCaptcha()) {
    const hcaptchaSources = ['https://hcaptcha.com', 'https://*.hcaptcha.com'];
    scriptSrc.push(...hcaptchaSources);
    styleSrc.push(...hcaptchaSources);
    connectSrc.push(...hcaptchaSources);
    frameSrc.push(...hcaptchaSources);
  }

  if (process.env.NODE_ENV !== 'production') {
    connectSrc.push('ws:', 'wss:', 'http://localhost:*', 'http://127.0.0.1:*');
    scriptSrc.push("'unsafe-eval'");
    styleSrc.push("'unsafe-inline'");
  }

  return {
    defaultSrc: ["'self'"],
    baseUri: ["'self'"],
    scriptSrc: uniqueSources(scriptSrc),
    styleSrc: uniqueSources(styleSrc),
    imgSrc: uniqueSources(imgSrc),
    connectSrc: uniqueSources(connectSrc),
    fontSrc: uniqueSources(fontSrc),
    objectSrc: ["'none'"],
    frameSrc: frameSrc.length ? uniqueSources(frameSrc) : ["'none'"],
    frameAncestors: ["'none'"],
    formAction: ["'self'"],
    manifestSrc: ["'self'"],
    workerSrc: ["'self'", 'blob:'],
    upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
    ...(process.env.CSP_REPORT_URI ? { reportUri: [process.env.CSP_REPORT_URI] } : {}),
  };
}

const helmetMiddleware = helmet({
  contentSecurityPolicy: {
    directives: buildCspDirectives(),
  },
  // frameguard explicitly set to DENY to match frameAncestors:'none' in CSP
  frameguard: { action: 'deny' },
  crossOriginEmbedderPolicy: false,  // allow Swagger UI assets
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  // Permissions-Policy: deshabilitar APIs sensibles que la app no necesita exponer
  permissionsPolicy: {
    features: {
      camera:          ["'none'"],
      microphone:      ["'none'"],
      geolocation:     ["'none'"],
      payment:         ["'none'"],
      usb:             ["'none'"],
      magnetometer:    ["'none'"],
      gyroscope:       ["'none'"],
      accelerometer:   ["'none'"],
      fullscreen:      ["'self'"],
    },
  },
});

// ── HPP — HTTP Parameter Pollution protection ─────────────────────────────────
const hppMiddleware = hpp({ whitelist: ['sort', 'filter', 'fields', 'expand'] });

// ── Compression ───────────────────────────────────────────────────────────────
const compressionMiddleware = compression({
  level: 6,
  threshold: 1024,    // only compress > 1KB
  filter(req, res) {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  },
});

// ── Sanitize — trim strings + block prototype pollution ──────────────────────
const MAX_SANITIZE_DEPTH = 10;

function sanitizeDeep(value, depth = 0) {
  if (depth > MAX_SANITIZE_DEPTH) return null;   // corta recursión antes del stack overflow
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(v => sanitizeDeep(v, depth + 1));
  if (typeof value === 'object') {
    const BLOCKED = new Set(['__proto__', 'constructor', 'prototype']);
    const out = Object.create(null);
    for (const [k, v] of Object.entries(value)) {
      if (BLOCKED.has(k)) continue;
      out[k] = sanitizeDeep(v, depth + 1);
    }
    return out;
  }
  return value;
}

function sanitize(req, _res, next) {
  if (req.body   && typeof req.body   === 'object') req.body   = sanitizeDeep(req.body);
  if (req.query  && typeof req.query  === 'object') req.query  = sanitizeDeep(req.query);
  if (req.params && typeof req.params === 'object') req.params = sanitizeDeep(req.params);
  next();
}

// ── Request ID ────────────────────────────────────────────────────────────────
function requestId(req, res, next) {
  const raw = req.headers['x-request-id'];
  const id = (raw && /^[\w\-]{1,64}$/.test(raw)) ? raw : uuidv4();
  req.requestId = id;
  res.locals.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}

// ── IP Guard ──────────────────────────────────────────────────────────────────
/**
 * IP whitelist/blacklist.
 * Env vars:
 *   IP_WHITELIST = "1.2.3.4,10.0.0.0/8"   (if set, only these pass)
 *   IP_BLACKLIST = "5.6.7.8,9.10.11.0/24"  (always blocked)
 */
function parseList(env) {
  return (env || '').split(',').map(s => s.trim()).filter(Boolean);
}

function ipToLong(ip) {
  return ip.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct), 0) >>> 0;
}

function ipInCidr(ip, cidr) {
  if (!cidr.includes('/')) return ip === cidr;
  const [base, bits] = cidr.split('/');
  const mask = ~((1 << (32 - parseInt(bits))) - 1) >>> 0;
  return (ipToLong(ip) & mask) === (ipToLong(base) & mask);
}

function ipGuard(req, res, next) {
  const whitelist = parseList(process.env.IP_WHITELIST);
  const blacklist = parseList(process.env.IP_BLACKLIST);
  const ip = req.ip || req.socket?.remoteAddress || '';
  const clean = ip.replace('::ffff:', '');

  if (blacklist.length && blacklist.some(cidr => ipInCidr(clean, cidr))) {
    return R.error(res, 403, 'Access denied', null, 'RBAC_001');
  }
  if (whitelist.length && !whitelist.some(cidr => ipInCidr(clean, cidr))) {
    return R.error(res, 403, 'Access denied', null, 'RBAC_001');
  }
  next();
}

// ── Idempotency ───────────────────────────────────────────────────────────────
/**
 * Prevents duplicate mutating requests using Idempotency-Key header.
 * Stores key → response in Redis for 24h.
 * Only applies to POST/PUT/PATCH/DELETE.
 */
async function getIdempotencyRedis() {
  const { getRedisSingleton } = require('./redis');
  return getRedisSingleton('idempotency', 'idempotency');
}

// Límite de tamaño para el body cacheado en Redis (256 KB)
const IDEMPOTENCY_MAX_BODY_BYTES = parseInt(process.env.IDEMPOTENCY_MAX_BODY_BYTES || String(256 * 1024));

async function idempotency(req, res, next) {
  const rawKey = req.headers['idempotency-key'];
  if (!rawKey) return next();
  if (!['POST','PUT','PATCH','DELETE'].includes(req.method)) return next();

  // Sanitizar la clave: solo caracteres seguros para Redis keys, máximo 128 chars.
  // Claves arbitrarias permiten colisiones entre tenants o Redis key injection.
  if (typeof rawKey !== 'string' || !/^[\w\-.:@]{1,128}$/.test(rawKey)) {
    return res.status(400).json({
      success: false,
      error: { message: 'Idempotency-Key inválida', code: 'IDEMPOTENCY_KEY_INVALID' },
    });
  }

  // Aislar por tenant: prefixar con orgId del token para evitar colisiones cross-tenant
  const orgId = req.user?.orgId || req.user?.organization_id || 'anon';
  const redisKey = `idempotency:${orgId}:${rawKey}`;
  try {
    const redis  = await getIdempotencyRedis();
    const cached = await redis.get(redisKey);

    if (cached) {
      const { status, body } = JSON.parse(cached);
      res.setHeader('X-Idempotent-Replayed', 'true');
      return res.status(status).json(body);
    }

    // Intercept response to cache it
    const origJson = res.json.bind(res);
    res.json = function(body) {
      // Solo cachear respuestas exitosas (2xx). Cachear 4xx/5xx haría que un error
      // transitorio quede "pegado" 24h y el reintento con la misma key no reintente.
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const serialised = JSON.stringify({ status: res.statusCode, body });
        // No cachear respuestas que excedan el límite — previene memory exhaustion en Redis
        if (Buffer.byteLength(serialised) <= IDEMPOTENCY_MAX_BODY_BYTES) {
          redis.setEx(redisKey, 86400, serialised)
            .catch((err) => log.warn('Idempotency cache write failed', { error: err.message, key: redisKey }));
        } else {
          log.warn('Idempotency body too large — not cached', { key: redisKey, bytes: Buffer.byteLength(serialised) });
        }
      }
      return origJson(body);
    };
  } catch (err) {
    log.warn('Idempotency middleware unavailable', { error: err.message, key: redisKey });
  }

  next();
}

// ── DNS Rebinding Guard ───────────────────────────────────────────────────────
/**
 * Valida el header Host contra la lista de dominios permitidos.
 * Previene que un atacante use DNS rebinding para hacer que el navegador
 * hable con servicios internos.
 *
 * Env: ALLOWED_HOSTS — lista CSV de hosts permitidos (ej: "app.vetmanager.io,api.vetmanager.io")
 * En desarrollo, se permiten localhost y 127.0.0.1 si no hay lista configurada.
 */
// Deriva la lista de hosts permitidos de varias env vars (ALLOWED_HOSTS y, como
// fallback robusto, las URLs públicas que la app ya configura). Esto evita que un
// ALLOWED_HOSTS ausente bloquee TODO el tráfico cuando APP_URL/FRONTEND_URL sí están,
// sin abrir el guard (sigue validando contra hosts legítimos).
function deriveAllowedHosts() {
  const out = [];
  const sources = [
    process.env.ALLOWED_HOSTS,
    process.env.APP_URL,
    process.env.FRONTEND_URL,
    process.env.PUBLIC_URL,
  ];
  for (const v of sources) {
    if (!v) continue;
    for (const part of String(v).split(',')) {
      const s = part.trim();
      if (!s) continue;
      try {
        if (/^https?:\/\//i.test(s)) out.push(new URL(s).hostname.toLowerCase());
        else out.push(s.toLowerCase().split('/')[0].split(':')[0]);
      } catch { /* entrada inválida → ignorar */ }
    }
  }
  return out;
}

function dnsRebindingGuard(req, res, next) {
  const isProd = process.env.NODE_ENV === 'production';
  const allowedHosts = new Set(deriveAllowedHosts());

  // En desarrollo, sin lista configurada → permitir
  if (!allowedHosts.size && !isProd) return next();

  const host = (req.headers['host'] || '').toLowerCase().split(':')[0];   // strip port

  // Permitir localhost en dev aunque haya lista
  if (!isProd && (host === 'localhost' || host === '127.0.0.1')) {
    return next();
  }

  // Prod sin NINGÚN host configurado: no se puede validar. Fail-closed (no degradar
  // seguridad) pero con log explícito para diagnosticar la mala configuración.
  if (!allowedHosts.size) {
    log.error('dnsRebindingGuard: sin ALLOWED_HOSTS/APP_URL/FRONTEND_URL en producción — se rechazan todas las requests. Configurar ALLOWED_HOSTS.');
    return res.status(400).json({
      success: false,
      error: { message: 'Host header no permitido', code: 'HOST_HEADER_INVALID' },
    });
  }

  if (!allowedHosts.has(host)) {
    return res.status(400).json({
      success: false,
      error: { message: 'Host header no permitido', code: 'HOST_HEADER_INVALID' },
    });
  }
  next();
}

// ── Open Redirect Guard ───────────────────────────────────────────────────────
/**
 * Middleware para rutas que usan parámetros de redirección (ej: ?redirect=/path).
 * Valida que la URL sea del propio dominio o una ruta relativa válida.
 *
 * Uso: router.get('/login', openRedirectGuard(['query.redirect', 'query.returnTo']), handler)
 *
 * @param {string[]} fields — rutas dot-notation a los parámetros de redirect
 */
function openRedirectGuard(fields = ['query.redirect', 'query.returnTo', 'body.redirect']) {
  return function(req, res, next) {
    const allowedOrigins = new Set(
      (process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim().toLowerCase()).filter(Boolean)
    );

    for (const fieldPath of fields) {
      const [source, key] = fieldPath.split('.');
      const value = req[source]?.[key];
      if (!value) continue;

      // Rutas relativas que empiecen con / son seguras (sin host)
      if (/^\/[^/\\]/.test(value)) continue;
      if (value.startsWith('/') && !value.startsWith('//')) continue;

      // URLs absolutas: verificar que el origen esté en la lista
      try {
        const parsed = new URL(value);
        const origin = parsed.origin.toLowerCase();
        if (!allowedOrigins.has(parsed.host.toLowerCase()) && !allowedOrigins.has(origin)) {
          return res.status(400).json({
            success: false,
            error: { message: 'URL de redirección no permitida', code: 'OPEN_REDIRECT_BLOCKED' },
          });
        }
      } catch {
        // URL malformada → bloquear
        return res.status(400).json({
          success: false,
          error: { message: 'URL de redirección inválida', code: 'OPEN_REDIRECT_INVALID' },
        });
      }
    }
    next();
  };
}

// ── Content-Type Guard ────────────────────────────────────────────────────────
/**
 * Rechaza requests mutantes (POST/PUT/PATCH) que no envíen Content-Type válido.
 * Previene ataques de content-type smuggling y payloads malformados.
 * Excluye multipart/form-data (file uploads) y application/x-www-form-urlencoded.
 */
function contentTypeGuard(req, res, next) {
  const mutating = new Set(['POST', 'PUT', 'PATCH']);
  if (!mutating.has(req.method)) return next();

  // Rutas excluidas (webhooks, healthchecks)
  const excluded = new Set(['/health', '/metrics', '/webhooks']);
  if (excluded.has(req.path) || req.path.startsWith('/webhooks')) return next();

  const ct = req.headers['content-type'] || '';

  const VALID_TYPES = [
    'application/json',
    'application/x-www-form-urlencoded',
    'multipart/form-data',
    'application/octet-stream',
  ];

  const isValid = VALID_TYPES.some(t => ct.toLowerCase().includes(t));

  // Si hay body pero el Content-Type es inválido → rechazar
  if (!isValid && (req.headers['content-length'] || req.headers['transfer-encoding'])) {
    return res.status(415).json({
      success: false,
      error: { message: 'Tipo de contenido no soportado', code: 'UNSUPPORTED_MEDIA_TYPE' },
    });
  }
  next();
}

// ── Cache Headers ─────────────────────────────────────────────────────────────
/**
 * Agrega headers de cache seguros en respuestas de API para prevenir
 * cache poisoning y evitar que CDNs sirvan respuestas privadas a otros usuarios.
 *
 * - Rutas de API: no-store (nunca cachear datos sensibles)
 * - Rutas públicas/static: cache corto con Vary
 */
function cacheHeaders(req, res, next) {
  const isApi = req.path.startsWith('/api/');

  if (isApi) {
    // Las respuestas de API nunca deben cachearse — contienen datos de usuario
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Vary', 'Authorization, Accept-Encoding');
  } else {
    // Rutas públicas: caché corto, variar por encoding y origen
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Vary', 'Accept-Encoding, Origin');
  }
  next();
}

// ── Safe Deserialize ──────────────────────────────────────────────────────────
/**
 * Previene ejecución de código en deserialización.
 * Reemplaza JSON.parse de input externo con una versión que bloquea
 * prototype pollution y keys peligrosas antes de parsear.
 *
 * Uso: safeJsonParse(rawString) en lugar de JSON.parse(rawString)
 * @param {string} raw
 * @param {*} fallback — valor a retornar si el parse falla
 */
function safeJsonParse(raw, fallback = null) {
  if (typeof raw !== 'string') return fallback;

  // Bloquear strings que contengan prototype pollution en crudo
  const DANGEROUS = ['__proto__', 'constructor', 'prototype'];
  if (DANGEROUS.some(d => raw.includes(d))) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw, (key, value) => {
      // Reviver: bloquear keys peligrosas durante el parsing
      if (DANGEROUS.includes(key)) return undefined;
      return value;
    });

    // eval/Function están prohibidos — si el valor es string con eval → sanitizar
    if (typeof parsed === 'string' && /\beval\s*\(|\bFunction\s*\(/.test(parsed)) {
      return fallback;
    }

    return parsed;
  } catch {
    return fallback;
  }
}

// ── SRI Helper ────────────────────────────────────────────────────────────────
/**
 * Genera el hash de integridad (SRI) para un recurso estático cargado desde CDN.
 * El hash se incluye en el atributo `integrity` de <script> o <link>.
 *
 * Uso (en generación de HTML server-side):
 *   const { generateSriHash } = require('./security');
 *   const hash = await generateSriHash(fileBuffer, 'sha384');
 *   // <script src="https://cdn.../lib.js" integrity="sha384-{hash}" crossorigin="anonymous">
 *
 * @param {Buffer|string} content — contenido del recurso
 * @param {'sha256'|'sha384'|'sha512'} [algorithm='sha384']
 * @returns {string} — valor del atributo integrity, ej: "sha384-abc123..."
 */
function generateSriHash(content, algorithm = 'sha384') {
  const VALID_ALGS = new Set(['sha256', 'sha384', 'sha512']);
  if (!VALID_ALGS.has(algorithm)) throw new Error(`SRI: algoritmo no soportado: ${algorithm}`);

  const buf  = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const hash = crypto.createHash(algorithm).update(buf).digest('base64');
  return `${algorithm}-${hash}`;
}

module.exports = {
  helmetMiddleware,
  hppMiddleware,
  compressionMiddleware,
  sanitize,
  requestId,
  ipGuard,
  idempotency,
  // Nuevos (seguridad adicional)
  dnsRebindingGuard,
  openRedirectGuard,
  contentTypeGuard,
  cacheHeaders,
  safeJsonParse,
  generateSriHash,
};
