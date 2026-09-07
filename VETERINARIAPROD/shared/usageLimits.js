'use strict';

/**
 * Usage limits — per-org monthly quotas gated by plan tier.
 *
 * How it works:
 *   - Each org has a plan tier ('free' | 'basic' | 'pro' | 'enterprise').
 *   - Monthly usage is tracked in Redis: `usage:{orgId}:{feature}:{YYYY-MM}`
 *   - On each protected request, the middleware:
 *       1. Reads the org's current month counter.
 *       2. Compares against PLAN_LIMITS[tier][feature].
 *       3. Increments on success.
 *   - The Redis key expires at the end of the month automatically.
 *   - Unlimited is represented as Infinity (stored as -1 in Redis config).
 *
 * Plan tier is stored in Redis: `org:plan:{orgId}` → tier string.
 * Set via admin API (see setPlanTier).
 *
 * Usage:
 *   const { requireUsageLimit } = require('../../../shared/usageLimits');
 *   router.post('/diagnose', requireFeature('ai_diagnosis'), requireUsageLimit('ai_diagnosis'), handler);
 */

const { getRedisSingleton } = require('./redis');
const { createLogger } = require('./logger');
const {
  getDependencyMode,
  recordDependencyDegradation,
  logDependencyIssue,
  dependencyFailureResponse,
} = require('./dependencyPolicy');

const log = createLogger('usage-limits');

// ── Plan definitions ──────────────────────────────────────────────────────────
const PLAN_LIMITS = {
  free: {
    ai_diagnosis:       5,
    ai_image_analysis:  2,
    ai_chatbot:         20,
    ai_risk_assessment: 3,
    telemedicine:       10,
    pdf_reports:        50,
    sms_notifications:  0,
    whatsapp_notify:    0,
    api_calls_daily:    100,
    storage_mb:         500,       // 500 MB
  },
  basic: {
    ai_diagnosis:       50,
    ai_image_analysis:  20,
    ai_chatbot:         200,
    ai_risk_assessment: 30,
    telemedicine:       100,
    pdf_reports:        500,
    sms_notifications:  100,
    whatsapp_notify:    50,
    api_calls_daily:    1000,
    storage_mb:         5120,      // 5 GB
  },
  pro: {
    ai_diagnosis:       500,
    ai_image_analysis:  200,
    ai_chatbot:         Infinity,
    ai_risk_assessment: 300,
    telemedicine:       Infinity,
    pdf_reports:        Infinity,
    sms_notifications:  1000,
    whatsapp_notify:    500,
    api_calls_daily:    10000,
    storage_mb:         51200,     // 50 GB
  },
  enterprise: {
    ai_diagnosis:       Infinity,
    ai_image_analysis:  Infinity,
    ai_chatbot:         Infinity,
    ai_risk_assessment: Infinity,
    telemedicine:       Infinity,
    pdf_reports:        Infinity,
    sms_notifications:  Infinity,
    whatsapp_notify:    Infinity,
    api_calls_daily:    Infinity,
    storage_mb:         Infinity,
  },
};

/** Threshold (0–1) above which a warning alert is emitted. */
const ALERT_THRESHOLD = parseFloat(process.env.USAGE_ALERT_THRESHOLD || '0.8');

const DEFAULT_PLAN = process.env.DEFAULT_PLAN_TIER || 'free';

// OT-097: Absolute monthly cap applied even to Infinity tiers (pro/enterprise).
// Prevents runaway spend from misconfiguration or compromised org tokens.
// Override via env vars (set to a large number to effectively disable).
const MAX_ABSOLUTE_LIMITS = {
  ai_diagnosis:       parseInt(process.env.MAX_AI_DIAGNOSIS_MONTHLY        || '2000', 10),
  ai_image_analysis:  parseInt(process.env.MAX_AI_IMAGE_ANALYSIS_MONTHLY   || '1000', 10),
  ai_chatbot:         parseInt(process.env.MAX_AI_CHATBOT_MONTHLY          || '5000', 10),
  ai_risk_assessment: parseInt(process.env.MAX_AI_RISK_ASSESSMENT_MONTHLY  || '1500', 10),
};

// OT-093: Per-user daily caps — prevents a single user from consuming the entire org quota.
// Keys: usage:user:{userId}:{feature}:{YYYY-MM-DD} — expires at end of day.
const USER_DAILY_LIMITS = {
  ai_diagnosis:       parseInt(process.env.USER_DAILY_AI_DIAGNOSIS        || '20',  10),
  ai_image_analysis:  parseInt(process.env.USER_DAILY_AI_IMAGE_ANALYSIS   || '10',  10),
  ai_chatbot:         parseInt(process.env.USER_DAILY_AI_CHATBOT          || '100', 10),
  ai_risk_assessment: parseInt(process.env.USER_DAILY_AI_RISK_ASSESSMENT  || '10',  10),
};

function getUsageLimitMode(feature = '') {
  const expensiveFeatures = new Set([
    'ai_diagnosis',
    'ai_image_analysis',
    'ai_chatbot',
    'ai_risk_assessment',
    'sms_notifications',
    'whatsapp_notify',
    'storage_mb',
  ]);
  const defaultMode = expensiveFeatures.has(feature) ? 'strict' : 'degraded';
  return getDependencyMode(feature ? `usage_limit_${feature}` : 'usage_limit', defaultMode);
}

// ── Redis client ──────────────────────────────────────────────────────────────
async function getRedis() {
  return getRedisSingleton('usage-limits', 'usage-limits');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns YYYY-MM string for the current UTC month. */
function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

/** Seconds until end of current UTC month (for Redis TTL). */
function secsUntilMonthEnd() {
  const now   = new Date();
  const next  = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return Math.max(1, Math.floor((next - now) / 1000));
}

/**
 * Get the plan tier for an org.
 * Falls back to DEFAULT_PLAN when Redis unavailable or key not set.
 * @param {string|number} orgId
 * @returns {Promise<string>}
 */
async function getPlanTier(orgId, { mode = 'degraded' } = {}) {
  try {
    const redis = await getRedis();
    const tier  = await redis.get(`org:plan:${orgId}`);
    return tier || DEFAULT_PLAN;
  } catch (err) {
    recordDependencyDegradation('usage_limits', mode, mode === 'strict' ? 'blocked' : 'degraded', { service: 'shared' });
    logDependencyIssue(log, 'usage_limits', mode, 'Plan tier read failed', err, { orgId });
    if (mode === 'strict') throw err;
    return DEFAULT_PLAN;
  }
}

/**
 * Set the plan tier for an org (admin use).
 * @param {string|number} orgId
 * @param {'free'|'basic'|'pro'|'enterprise'} tier
 */
async function setPlanTier(orgId, tier) {
  if (!PLAN_LIMITS[tier]) throw new Error(`Unknown plan tier: ${tier}`);
  const redis = await getRedis();
  await redis.set(`org:plan:${orgId}`, tier);
}

/**
 * Get the monthly limit for an org's plan and feature.
 * @param {string|number} orgId
 * @param {string}        feature
 * @returns {Promise<number>}  Infinity = unlimited
 */
async function getLimit(orgId, feature, { mode = getUsageLimitMode(feature) } = {}) {
  const tier   = await getPlanTier(orgId, { mode });
  const limits = PLAN_LIMITS[tier] || PLAN_LIMITS[DEFAULT_PLAN];
  let limit    = limits[feature];
  if (limit === undefined) return Infinity; // feature not in limits → always allowed

  // OT-097: Apply absolute max cap even for Infinity tiers (pro/enterprise).
  if (limit === Infinity && MAX_ABSOLUTE_LIMITS[feature] !== undefined) {
    limit = MAX_ABSOLUTE_LIMITS[feature];
  }
  return limit;
}

/**
 * Get current monthly usage for an org + feature.
 * @param {string|number} orgId
 * @param {string}        feature
 * @returns {Promise<number>}
 */
async function getUsage(orgId, feature, { mode = getUsageLimitMode(feature) } = {}) {
  try {
    const redis = await getRedis();
    const key   = `usage:${orgId}:${feature}:${currentMonth()}`;
    const val   = await redis.get(key);
    return val ? parseInt(val) : 0;
  } catch (err) {
    recordDependencyDegradation('usage_limits', mode, mode === 'strict' ? 'blocked' : 'degraded', { service: 'shared' });
    logDependencyIssue(log, 'usage_limits', mode, 'Usage counter read failed', err, { orgId, feature });
    if (mode === 'strict') throw err;
    return 0;
  }
}

/**
 * Increment usage counter for an org + feature.
 * Automatically expires at end of month.
 * @param {string|number} orgId
 * @param {string}        feature
 * @param {number}        [amount=1]
 */
async function recordUsage(orgId, feature, amount = 1, { mode = getUsageLimitMode(feature) } = {}) {
  try {
    const redis = await getRedis();
    const key   = `usage:${orgId}:${feature}:${currentMonth()}`;
    const pipe  = redis.multi();
    pipe.incrBy(key, amount);
    pipe.expire(key, secsUntilMonthEnd());
    await pipe.exec();
  } catch (err) {
    recordDependencyDegradation('usage_limits', mode, 'degraded', { service: 'shared' });
    logDependencyIssue(log, 'usage_limits', mode, 'Usage counter write failed', err, { orgId, feature, amount });
    if (mode === 'strict') throw err;
  }
}

/**
 * Check whether an org is within limits for a feature.
 * @param {string|number} orgId
 * @param {string}        feature
 * @returns {Promise<{ allowed: boolean, current: number, limit: number, pct: number }>}
 */
async function checkLimit(orgId, feature, { mode = getUsageLimitMode(feature) } = {}) {
  const [limit, current] = await Promise.all([
    getLimit(orgId, feature, { mode }),
    getUsage(orgId, feature, { mode }),
  ]);
  const pct = limit === Infinity ? 0 : current / limit;
  return { allowed: current < limit, current, limit, pct };
}

// ── Storage tracking ──────────────────────────────────────────────────────────

/**
 * Accumulate storage usage for an org (permanent counter — not monthly).
 * Key: `storage:{orgId}` — value in MB (float-safe via INCRBYFLOAT).
 * @param {string|number} orgId
 * @param {number}        deltaMb  — positive to add, negative to subtract (deletions)
 */
async function recordStorage(orgId, deltaMb) {
  try {
    const redis = await getRedis();
    const key   = `storage:${orgId}`;
    await redis.incrByFloat(key, deltaMb);
  } catch (err) {
    log.warn('Storage counter write failed', {
      orgId,
      deltaMb,
      message: err?.message,
      code: err?.code,
    });
  }
}

/**
 * Get current storage usage in MB for an org.
 * @param {string|number} orgId
 * @returns {Promise<number>}
 */
async function getStorageUsage(orgId) {
  try {
    const redis = await getRedis();
    const val   = await redis.get(`storage:${orgId}`);
    return val ? parseFloat(val) : 0;
  } catch (err) {
    log.warn('Storage usage read failed', {
      orgId,
      error: err.message,
    });
    return 0;
  }
}

/**
 * Check if an org is within storage limits.
 * @param {string|number} orgId
 * @returns {Promise<{ allowed: boolean, currentMb: number, limitMb: number, pct: number }>}
 */
async function checkStorageLimit(orgId) {
  const [limitMb, currentMb] = await Promise.all([
    getLimit(orgId, 'storage_mb'),
    getStorageUsage(orgId),
  ]);
  const pct = limitMb === Infinity ? 0 : currentMb / limitMb;
  return { allowed: currentMb < limitMb, currentMb, limitMb, pct };
}

// ── Alert helpers ─────────────────────────────────────────────────────────────

let _alertLogger;
function getAlertLogger() {
  if (!_alertLogger) {
    try { _alertLogger = require('./logger').createLogger('usage-limits'); } catch { _alertLogger = console; }
  }
  return _alertLogger;
}

/**
 * OT-096: Fire-and-forget webhook notification when usage threshold is crossed.
 * Sends to USAGE_ALERT_WEBHOOK_URL if configured (no-op otherwise).
 */
// SEC: validar que USAGE_ALERT_WEBHOOK_URL sea una URL HTTPS pública para evitar SSRF.
function _validateWebhookUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    // Rechazar hostnames internos / loopback
    if (
      host === 'localhost' ||
      host.startsWith('127.') ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      host.startsWith('172.') ||
      host === '::1' ||
      host.endsWith('.internal') ||
      host.endsWith('.local')
    ) return false;
    return true;
  } catch {
    return false;
  }
}

async function _sendUsageAlertWebhook({ orgId, feature, current, limit, pct, level }) {
  const webhookUrl = process.env.USAGE_ALERT_WEBHOOK_URL;
  if (!webhookUrl) return;
  // SEC: rechazar URLs internas para prevenir SSRF
  if (!_validateWebhookUrl(webhookUrl)) {
    getAlertLogger().warn('USAGE_ALERT_WEBHOOK_URL rechazada — debe ser https:// público', { webhookUrl: webhookUrl.slice(0, 40) });
    return;
  }
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orgId,
        feature,
        current,
        limit:     limit === Infinity ? 'unlimited' : limit,
        pct:       Math.round(pct * 100),
        level,
        timestamp: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    getAlertLogger().warn('Usage alert webhook failed', { orgId, feature, error: err.message });
  }
}

/**
 * Emit a structured warning when usage crosses ALERT_THRESHOLD (default 80%).
 * OT-096: Also fires a webhook to USAGE_ALERT_WEBHOOK_URL if configured.
 * Called internally; also exported for manual use.
 * @param {string|number} orgId
 * @param {string}        feature
 * @param {number}        current
 * @param {number}        limit
 */
function emitUsageAlert(orgId, feature, current, limit) {
  const pct = limit === Infinity ? 0 : current / limit;
  if (pct < ALERT_THRESHOLD) return;

  const level = pct >= 1 ? 'EXCEEDED' : 'WARNING';
  getAlertLogger().warn(`Usage ${level}: org=${orgId} feature=${feature}`, {
    orgId,
    feature,
    current,
    limit:     limit === Infinity ? 'unlimited' : limit,
    pct:       Math.round(pct * 100),
    threshold: Math.round(ALERT_THRESHOLD * 100),
    level,
  });

  // OT-096: fire webhook asynchronously — never blocks the request
  _sendUsageAlertWebhook({ orgId, feature, current, limit, pct, level }).catch(() => {});
}

/**
 * Express middleware factory — enforces a monthly usage limit for a feature.
 *
 * On limit exceeded → 429 with headers:
 *   X-RateLimit-Limit:     monthly cap
 *   X-RateLimit-Remaining: 0
 *   X-RateLimit-Reset:     epoch seconds until month end
 *
 * On Redis error → fail-open (allow through).
 *
 * @param {string}  feature         — feature name matching PLAN_LIMITS keys
 * @param {boolean} [autoRecord=true] — increment counter on pass-through
 */
async function _atomicCheckAndIncrement(orgId, feature, limit, mode) {
  if (limit === Infinity) return { allowed: true, current: 0 };
  try {
    const redis = await getRedis();
    const key   = `usage:${orgId}:${feature}:${currentMonth()}`;
    const pipe  = redis.multi();
    pipe.incrBy(key, 1);
    pipe.expire(key, secsUntilMonthEnd());
    const [newVal] = await pipe.exec();
    if (newVal > limit) {
      await redis.incrBy(key, -1);
      return { allowed: false, current: newVal - 1 };
    }
    return { allowed: true, current: newVal };
  } catch (err) {
    logDependencyIssue(log, 'usage_limits', mode, 'Atomic usage check failed', err, { orgId, feature });
    if (mode === 'strict') return { allowed: false, current: 0 };
    return { allowed: true, current: 0 };
  }
}

function requireUsageLimit(feature, autoRecord = true) {
  return async (req, res, next) => {
    const mode = getUsageLimitMode(feature);
    try {
      const orgId = req.user?.orgId;
      if (!orgId) return next(); // unauthenticated requests are not quota-tracked

      const limit = await getLimit(orgId, feature, { mode });
      const { allowed, current } = await _atomicCheckAndIncrement(orgId, feature, limit, mode);

      const resetEpoch = Math.floor(Date.now() / 1000) + secsUntilMonthEnd();
      const cap        = limit === Infinity ? 'unlimited' : limit;

      res.setHeader('X-RateLimit-Feature',   feature);
      res.setHeader('X-RateLimit-Limit',     cap);
      res.setHeader('X-RateLimit-Remaining', limit === Infinity ? 'unlimited' : Math.max(0, limit - current));
      res.setHeader('X-RateLimit-Reset',     resetEpoch);

      if (!allowed) {
        emitUsageAlert(orgId, feature, current, limit);
        return res.status(429).json({
          success: false,
          error: {
            message: `Monthly quota for '${feature}' exceeded (${current}/${cap}). Upgrade your plan.`,
            code:    'QUOTA_EXCEEDED',
            feature,
            current,
            limit:   cap,
          },
        });
      }

      // Warn when approaching the limit
      emitUsageAlert(orgId, feature, current, limit);

      if (autoRecord) {
        // Roll back the increment if the handler returns an error
        res.on('finish', () => {
          if (res.statusCode >= 400 && limit !== Infinity) {
            recordUsage(orgId, feature, -1, { mode }).catch(() => {});
          }
        });
      }

      next();
    } catch (err) {
      recordDependencyDegradation('usage_limits', mode, mode === 'strict' ? 'blocked' : 'degraded', { service: 'shared' });
      logDependencyIssue(log, 'usage_limits', mode, 'Usage limit check failed', err, {
        feature,
        orgId: req.user?.orgId,
      });
      if (mode === 'strict') {
        return dependencyFailureResponse(res, {
          statusCode: 503,
          message: `Usage limit backend unavailable for '${feature}'`,
          code: 'USAGE_LIMIT_UNAVAILABLE',
          details: { feature },
        });
      }
      next();
    }
  };
}

/** Returns YYYY-MM-DD string for the current UTC day. */
function currentDay() {
  return new Date().toISOString().slice(0, 10);
}

/** Seconds until end of current UTC day. */
function secsUntilDayEnd() {
  const now  = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return Math.max(1, Math.floor((next - now) / 1000));
}

/**
 * OT-093: Express middleware — per-user daily rate limit for AI features.
 * Prevents a single user from consuming the entire org's monthly quota in seconds.
 *
 * Tracked in Redis: usage:user:{userId}:{feature}:{YYYY-MM-DD}
 * Cap defined in USER_DAILY_LIMITS (configurable via env).
 *
 * On Redis unavailable → fail-open (allow through).
 *
 * @param {string} feature — feature name matching USER_DAILY_LIMITS keys
 */
function requireUserUsageLimit(feature) {
  return async (req, res, next) => {
    const userId = req.user?.userId || req.user?.id;
    if (!userId) return next(); // unauthenticated — not tracked

    const dailyCap = USER_DAILY_LIMITS[feature];
    if (dailyCap === undefined) return next(); // feature has no per-user cap defined

    try {
      const redis = await getRedis();
      const key   = `usage:user:${userId}:${feature}:${currentDay()}`;

      // SEC: usar INCR atómico para evitar race condition TOCTOU.
      // El patrón anterior (GET → compare → increment en finish) permitía que N requests
      // concurrentes leyeran el mismo valor y pasaran el check simultáneamente.
      const pipe = redis.multi();
      pipe.incrBy(key, 1);
      pipe.expire(key, secsUntilDayEnd());
      const [newCount] = await pipe.exec();

      if (newCount > dailyCap) {
        // Revertir el incremento — el usuario ya excedió el límite
        await redis.incrBy(key, -1).catch(() => {});
        return res.status(429).json({
          success: false,
          error: {
            message: `Daily user quota for '${feature}' exceeded (${newCount - 1}/${dailyCap}). Try again tomorrow.`,
            code:    'USER_QUOTA_EXCEEDED',
            feature,
            current: newCount - 1,
            limit:   dailyCap,
          },
        });
      }

      // Revertir si el handler falla (status >= 400)
      res.on('finish', () => {
        if (res.statusCode >= 400) {
          redis.incrBy(key, -1).catch(() => {});
        }
      });

      next();
    } catch {
      // Redis unavailable — fail-open (better to allow than block legitimate requests)
      next();
    }
  };
}

module.exports = {
  PLAN_LIMITS,
  MAX_ABSOLUTE_LIMITS,
  USER_DAILY_LIMITS,
  ALERT_THRESHOLD,
  getPlanTier,
  setPlanTier,
  getLimit,
  getUsage,
  recordUsage,
  checkLimit,
  requireUsageLimit,
  requireUserUsageLimit,
  recordStorage,
  getStorageUsage,
  checkStorageLimit,
  emitUsageAlert,
  getUsageLimitMode,
};
