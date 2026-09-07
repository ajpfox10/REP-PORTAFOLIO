'use strict';

const { getRedisSingleton } = require('./redis');
const { createLogger } = require('./logger');

const PREFIX = 'svc:registry';
const TTL_SECONDS = Math.max(15, parseInt(process.env.SERVICE_REGISTRY_TTL_SECONDS || '45', 10));
const log = createLogger('service-registry');

let _serviceRegistryOperations;
function getServiceRegistryMetric() {
  if (_serviceRegistryOperations) return _serviceRegistryOperations;
  try {
    _serviceRegistryOperations = require('./metrics').serviceRegistryOperations;
  } catch (err) {
    log.warn('Service registry metric unavailable', { error: err.message });
  }
  return _serviceRegistryOperations;
}

function count(operation, result) {
  getServiceRegistryMetric()?.inc({ operation, result });
}

function key(name) {
  return `${PREFIX}:${name}`;
}

function instanceKey(name, instanceId) {
  return `${PREFIX}:${name}:${instanceId}`;
}

async function getRedis() {
  return getRedisSingleton('service-registry', 'service-registry');
}

async function registerService(name, payload) {
  const redis = await getRedis();
  if (!redis?.isReady) {
    count('register', 'unavailable');
    return false;
  }

  try {
    const instanceId = String(payload.instanceId || process.env.SERVICE_INSTANCE_ID || process.pid);
    const body = JSON.stringify({
      ...payload,
      instanceId,
      updatedAt: new Date().toISOString(),
    });
    await redis.setEx(instanceKey(name, instanceId), TTL_SECONDS, body);
    await redis.setEx(key(name), TTL_SECONDS, body);
    count('register', 'success');
    return true;
  } catch (err) {
    count('register', 'failure');
    log.warn('Service registry register failed', { name, message: err?.message, code: err?.code });
    return false;
  }
}

async function resolveServiceTarget(name, fallback = null) {
  const rows = await resolveServiceTargets(name).catch(() => []);
  if (rows.length > 0) {
    count('resolve', 'success');
    return rows[0].url || fallback;
  }

  count('resolve', 'fallback');
  return fallback;
}

async function resolveServiceTargets(name) {
  const redis = await getRedis().catch(() => null);
  if (!redis?.isReady) {
    count('resolve_many', 'unavailable');
    return [];
  }

  let keys = [];
  try {
    if (typeof redis.scanIterator === 'function') {
      for await (const matchedKey of redis.scanIterator({ MATCH: `${PREFIX}:${name}:*`, COUNT: 100 })) {
        keys.push(matchedKey);
      }
    } else {
      keys = await redis.keys(`${PREFIX}:${name}:*`);
    }
  } catch (err) {
    count('resolve_many', 'failure');
    log.warn('Service registry resolve scan failed', { name, message: err?.message, code: err?.code });
    return [];
  }

  if (!keys.length) {
    keys = [key(name)];
  }

  try {
    const rows = await redis.mGet(keys);
    count('resolve_many', rows.some(Boolean) ? 'success' : 'empty');
    return rows
      .map((row, index) => {
        if (!row) return null;
        try {
          return { name, key: keys[index], ...JSON.parse(row) };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .filter((row) => row.url)
      .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
  } catch (err) {
    count('resolve_many', 'failure');
    log.warn('Service registry resolve fetch failed', { name, message: err?.message, code: err?.code });
    return [];
  }
}

async function listServices() {
  const redis = await getRedis().catch(() => null);
  if (!redis?.isReady) {
    count('list', 'unavailable');
    return [];
  }

  const keys = [];
  try {
    if (typeof redis.scanIterator === 'function') {
      for await (const matchedKey of redis.scanIterator({ MATCH: `${PREFIX}:*`, COUNT: 100 })) {
        keys.push(matchedKey);
      }
    } else {
      keys.push(...await redis.keys(`${PREFIX}:*`));
    }
  } catch (err) {
    count('list', 'failure');
    log.warn('Service registry list scan failed', { message: err?.message, code: err?.code });
    return [];
  }

  if (!keys.length) {
    count('list', 'empty');
    return [];
  }

  let rows;
  try {
    rows = await redis.mGet(keys);
  } catch (err) {
    count('list', 'failure');
    log.warn('Service registry list fetch failed', { message: err?.message, code: err?.code });
    return [];
  }

  count('list', 'success');
  return rows
    .map((row, index) => {
      try {
        return { name: keys[index].slice(`${PREFIX}:`.length), ...JSON.parse(row) };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

module.exports = {
  registerService,
  resolveServiceTarget,
  resolveServiceTargets,
  listServices,
};
