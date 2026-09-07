'use strict';

/**
 * gateway/src/middleware/rateLimiter.js
 * Rate limiters con Redis store.
 *
 * Limiters disponibles:
 *   apiLimiter           — 100 req/min por usuario (o IP si anónimo)
 *   authLimiter          — 10 req/min por IP (fuerza bruta en login)
 *   passwordResetLimiter — 5 req/15min por IP
 *   exportLimiter        — 10 req/15min por usuario (operaciones costosas)
 *   tenantLimiter        — 2000 req/min por tenant (org_id) — evita que un
 *                          tenant consuma toda la infraestructura
 */

const rateLimit       = require('express-rate-limit');
const { RedisStore }  = require('rate-limit-redis');
const { getRedisSingleton } = require('../../../shared/redis');
const { createLogger } = require('../../../shared/logger');
const log = createLogger('gateway-rate-limit');

// ── Redis client para rate limiting ───────────────────────────────────────────
async function getRlRedis() {
  return getRedisSingleton('gateway-rate-limit', 'gateway-rate-limit');
}

let _redisScriptSupported = null;

async function buildStore(prefix) {
  try {
    const client = await getRlRedis();
    if (!client.isReady) return undefined;

    // Test SCRIPT support (Lua scripting) — not available on some Redis configs
    if (_redisScriptSupported === null) {
      try {
        await client.sendCommand(['SCRIPT', 'EXISTS', '0000000000000000000000000000000000000000']);
        _redisScriptSupported = true;
      } catch (error) {
        log.warn('Rate limiter Redis scripting unavailable - using memory fallback', { error: error?.message });
        _redisScriptSupported = false;
      }
    }
    if (!_redisScriptSupported) return undefined;  // fallback to MemoryStore

    return new RedisStore({ sendCommand: (...args) => client.sendCommand(args), prefix });
  } catch (error) {
    log.warn('Rate limiter Redis store unavailable - using memory fallback', { prefix, error: error?.message });
  }
  return undefined;   // fallback a MemoryStore
}

const windowMs      = parseInt(process.env.RATE_LIMIT_WINDOW_MS    || '60000');
const maxApi        = parseInt(process.env.RATE_LIMIT_MAX           || '100');
const maxAuth       = parseInt(process.env.RATE_LIMIT_AUTH_MAX      || '10');
const maxTenant     = parseInt(process.env.RATE_LIMIT_TENANT_MAX    || '2000');

function tooManyHandler(message) {
  return (req, res) => {
    res.status(429).json({
      success: false,
      error: { message, code: 'RATE_LIMIT_EXCEEDED' },
    });
  };
}

// ── Key generators ────────────────────────────────────────────────────────────

/** Usuario autenticado → por userId; anónimo → por IP */
function userOrIpKey(req) {
  return req.user?.userId ? `user:${req.user.userId}` : `ip:${req.clientIp || req.ip}`;
}

/** Por tenant (org_id); si no hay usuario → por IP */
function tenantOrIpKey(req) {
  return req.user?.orgId ? `org:${req.user.orgId}` : `ip:${req.clientIp || req.ip}`;
}

// ── Builder factories ─────────────────────────────────────────────────────────

async function buildApiLimiter() {
  const store = await buildStore('rl:api:');
  return rateLimit({
    windowMs,
    max:             maxApi,
    standardHeaders: true,
    legacyHeaders:   false,
    store,
    keyGenerator:    userOrIpKey,
    handler:         tooManyHandler('Too many requests. Please slow down.'),
  });
}

async function buildAuthLimiter() {
  const store = await buildStore('rl:auth:');
  return rateLimit({
    windowMs,
    max:                    maxAuth,
    standardHeaders:        true,
    legacyHeaders:          false,
    store,
    keyGenerator:           (req) => `ip:${req.clientIp || req.ip}`,
    skipSuccessfulRequests: false,
    handler:                tooManyHandler('Too many authentication attempts. Try again later.'),
  });
}

async function buildPasswordResetLimiter() {
  const store = await buildStore('rl:pwreset:');
  return rateLimit({
    windowMs:        15 * 60 * 1000,
    max:             5,
    standardHeaders: true,
    legacyHeaders:   false,
    store,
    keyGenerator:    (req) => `ip:${req.clientIp || req.ip}`,
    handler:         tooManyHandler('Too many password reset attempts. Try again in 15 minutes.'),
  });
}

async function buildTwoFaLimiter() {
  const store = await buildStore('rl:2fa:');
  return rateLimit({
    windowMs:        15 * 60 * 1000,
    max:             5,
    standardHeaders: true,
    legacyHeaders:   false,
    store,
    keyGenerator:    (req) => `2fa:${req.clientIp || req.ip}`,
    handler:         tooManyHandler('Too many 2FA attempts. Account locked for 15 minutes.'),
  });
}

async function buildExportLimiter() {
  const store = await buildStore('rl:export:');
  return rateLimit({
    windowMs:        15 * 60 * 1000,
    max:             10,
    standardHeaders: true,
    legacyHeaders:   false,
    store,
    keyGenerator:    userOrIpKey,
    handler:         tooManyHandler('Export limit reached. Try again in 15 minutes.'),
  });
}

/**
 * Limiter por tenant (org_id).
 * Protege la infraestructura de un tenant que haga demasiadas requests.
 * Se aplica DESPUÉS de authMiddleware para tener req.user.orgId disponible.
 */
async function buildTenantLimiter() {
  const store = await buildStore('rl:tenant:');
  return rateLimit({
    windowMs,
    max:             maxTenant,
    standardHeaders: true,
    legacyHeaders:   false,
    store,
    keyGenerator:    tenantOrIpKey,
    handler:         tooManyHandler('Tenant rate limit exceeded. Please contact support if this is unexpected.'),
  });
}

// ── Lazy wrappers (inicialización diferida en primer request) ─────────────────

function lazyLimiter(builderFn, fallbackMax) {
  let instance = null;
  let building = false;
  const queue  = [];

  return async function(req, res, next) {
    if (instance) {
      try { return instance(req, res, next); }
      catch (error) {
        log.warn('Rate limiter instance failed - continuing', { error: error?.message, path: req.originalUrl });
        return next();
      }  // Redis SCRIPT error fallback
    }
    if (!building) {
      building = true;
      // Use the caller-provided fallbackMax (or the builder's own limit) so that
      // auth/password-reset limiters don't silently fall back to the much higher
      // apiLimiter default when Redis is unavailable.
      const memMax = fallbackMax != null ? fallbackMax : maxApi;
      instance = await builderFn().catch((error) => {
        log.warn('Rate limiter initialization failed - using memory fallback', { error: error?.message, max: memMax });
        return rateLimit({ windowMs, max: memMax });
      });
      queue.forEach(fn => fn());
      queue.length = 0;
    } else {
      await new Promise(resolve => queue.push(resolve));
    }
    try { return instance(req, res, next); }
    catch (error) {
      log.warn('Rate limiter execution failed - continuing', { error: error?.message, path: req.originalUrl });
      return next();
    }
  };
}

// ── Auth exponential backoff (OT-105) ─────────────────────────────────────────
/**
 * Progressive lockout for auth/login based on total attempt count from an IP
 * within a 1-hour window.  Since the gateway proxies requests and cannot inspect
 * downstream response status, ALL login requests count (conservative approach).
 *
 * Tiers (cumulative requests in 1h rolling window → lockout duration):
 *   ≥ 20  →  30-min lockout
 *   ≥ 10  →  5-min lockout
 *   ≥  5  →  2-min lockout
 *
 * On Redis unavailable → fail-open (normal rate limiter still applies).
 */
const AUTH_BACKOFF_TIERS = [
  { threshold: 20, lockoutSec: 1800 },
  { threshold: 10, lockoutSec: 300  },
  { threshold:  5, lockoutSec: 120  },
];
const AUTH_ATTEMPTS_TTL_SEC = 3600; // counter expires after 1h of no activity

async function buildAuthBackoffLimiter() {
  let redis = null;
  try {
    redis = await getRlRedis();
    if (!redis.isReady) redis = null;
  } catch { redis = null; }

  return async function authBackoffMiddleware(req, res, next) {
    if (!redis?.isReady) return next(); // fail-open if Redis unavailable

    const ip         = req.clientIp || req.ip || 'unknown';
    const countKey   = `rl:auth:attempts:${ip}`;
    const lockoutKey = `rl:auth:lockout:${ip}`;

    try {
      // 1. Check active lockout
      const lockoutTtl = await redis.ttl(lockoutKey);
      if (lockoutTtl > 0) {
        res.setHeader('Retry-After', String(lockoutTtl));
        return res.status(429).json({
          success: false,
          error: {
            message: `Too many login attempts from this IP. Try again in ${Math.ceil(lockoutTtl / 60)} minute(s).`,
            code:    'AUTH_BACKOFF',
          },
        });
      }

      // 2. Increment attempt counter
      const pipe  = redis.multi();
      pipe.incr(countKey);
      pipe.expire(countKey, AUTH_ATTEMPTS_TTL_SEC);
      const [[, count]] = await pipe.exec();

      // 3. Apply tier if threshold crossed
      for (const tier of AUTH_BACKOFF_TIERS) {
        if (count >= tier.threshold) {
          await redis.set(lockoutKey, '1', { EX: tier.lockoutSec });
          res.setHeader('Retry-After', String(tier.lockoutSec));
          return res.status(429).json({
            success: false,
            error: {
              message: `Too many login attempts. Try again in ${Math.ceil(tier.lockoutSec / 60)} minute(s).`,
              code:    'AUTH_BACKOFF',
            },
          });
        }
      }
    } catch (err) {
      log.warn('Auth backoff check failed - fail-open', { error: err?.message, ip });
    }

    next();
  };
}

// Pass explicit fallback max values so the in-memory fallback respects each
// limiter's own limit when Redis is unavailable (not the generic maxApi default).
const apiLimiter           = lazyLimiter(buildApiLimiter,           maxApi);
const authLimiter          = lazyLimiter(buildAuthLimiter,          maxAuth);
const passwordResetLimiter = lazyLimiter(buildPasswordResetLimiter, 5);
const twoFaLimiter         = lazyLimiter(buildTwoFaLimiter,         5);
const exportLimiter        = lazyLimiter(buildExportLimiter,        10);
const tenantLimiter        = lazyLimiter(buildTenantLimiter,        maxTenant);
const authBackoffLimiter   = lazyLimiter(buildAuthBackoffLimiter,   maxAuth);

module.exports = {
  apiLimiter,
  authLimiter,
  authBackoffLimiter,
  passwordResetLimiter,
  twoFaLimiter,
  exportLimiter,
  tenantLimiter,
};
