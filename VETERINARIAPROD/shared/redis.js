'use strict';

const { createClient } = require('redis');
const { createLogger } = require('./logger');
const { getAnySecret, getSecret } = require('./secrets');

const singletons = new Map();
const connectedLabels = new Set();
const disabledLabels = new Set();
const log = createLogger('redis');

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function hasUsableRedisUrl() {
  const url = (getSecret('REDIS_URL', { defaultValue: '' }) || '').trim();
  return url && !url.includes('${{');
}

function parseRedisFamily(url) {
  try {
    const parsed = new URL(url);
    const family = parsed.searchParams.get('family');
    if (family === '0' || family === '4' || family === '6') return parseInt(family, 10);
    if (parsed.hostname === 'redis.railway.internal') return 0;
  } catch (err) {
    log.warn('Redis URL family parse failed', { error: err.message });
  }
  return undefined;
}

function defaultReconnectStrategy(retries) {
  if (retries >= 10) return new Error('Redis max reconnect attempts reached');
  return Math.min(retries * 200, 3000);
}

/**
 * Redact the password from a Redis URL for safe logging/inspection.
 * e.g. "redis://:s3cr3t@host:6379/0" → "redis://:***@host:6379/0"
 */
function redactRedisUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '<unparseable-redis-url>';
  }
}

function buildRedisOptions(overrides = {}) {
  const connectTimeout = parseInt(process.env.REDIS_CONNECT_TIMEOUT_MS || '3000', 10);
  const reconnectStrategy = overrides.reconnectStrategy ?? defaultReconnectStrategy;

  if (hasUsableRedisUrl()) {
    const url = getSecret('REDIS_URL', { defaultValue: '' }).trim();
    const family = parseRedisFamily(url);
    return {
      url,
      // redactedUrl is used only for safe logging — never passed to the redis client
      _redactedUrl: redactRedisUrl(url),
      socket: {
        connectTimeout,
        ...(family !== undefined ? { family } : {}),
        reconnectStrategy,
      },
      ...overrides,
    };
  }

  return {
    socket: {
      host: process.env.REDIS_HOST || process.env.REDISHOST || 'redis',
      port: parseInt(process.env.REDIS_PORT || process.env.REDISPORT || '6379', 10),
      connectTimeout,
      reconnectStrategy,
      tls: isTruthy(process.env.REDIS_TLS),
    },
    username: process.env.REDIS_USER || process.env.REDIS_USERNAME || undefined,
    password: getAnySecret(['REDIS_PASSWORD', 'REDISPASSWORD'], { defaultValue: undefined }) || undefined,
    ...overrides,
  };
}

function logRedisError(label, err) {
  // Avoid logging the full error address/url that may contain credentials
  const safeMessage = String(err?.message || '').replace(/redis:\/\/[^\s]*/gi, '<redacted-url>');
  log.warn('Redis client error', { label, message: safeMessage, code: err?.code });
}

function logRedisConnected(label) {
  if (connectedLabels.has(label)) return;
  connectedLabels.add(label);
  log.info('Redis connected', { label });
}

function logRedisDisabled(label, err) {
  if (disabledLabels.has(label)) return;
  disabledLabels.add(label);
  log.warn('Redis disabled/fallback', { label, message: err?.message, code: err?.code });
}

function createRedisClient(label, overrides = {}) {
  const client = createClient(buildRedisOptions(overrides));
  client.on('error', (err) => logRedisError(label, err));
  return client;
}

async function connectRedis(client, label, { optional = true } = {}) {
  if (client.isReady) return client;

  try {
    if (!client.isOpen) {
      await client.connect();
    }
    if (client.isReady) logRedisConnected(label);
  } catch (err) {
    logRedisError(label, err);
    logRedisDisabled(label, err);
    if (!optional) throw err;
  }

  return client;
}

async function getRedisSingleton(name, label = name, overrides = {}, opts = {}) {
  let client = singletons.get(name);
  // Recreate if the client was permanently closed (e.g. max reconnects exhausted)
  if (client && !client.isOpen && !client.isReady) {
    singletons.delete(name);
    connectedLabels.delete(label);
    disabledLabels.delete(label);
    client = null;
  }
  if (!client) {
    client = createRedisClient(label, overrides);
    singletons.set(name, client);
  }
  return connectRedis(client, label, opts);
}

function resetRedisSingletons() {
  singletons.clear();
  connectedLabels.clear();
  disabledLabels.clear();
}

module.exports = {
  buildRedisOptions,
  createRedisClient,
  connectRedis,
  getRedisSingleton,
  resetRedisSingletons,
};
