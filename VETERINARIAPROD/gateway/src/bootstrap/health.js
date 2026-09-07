'use strict';

const { SERVICE_FALLBACKS, resolveRuntimeServiceTarget } = require('../../../shared/serviceTargets');
const { logger } = require('../middleware/logger');

const INTERNAL_HEALTH_TIMEOUT_MS = Math.max(
  500,
  parseInt(process.env.INTERNAL_HEALTH_TIMEOUT_MS || '3000', 10),
);

async function getRedisHealth() {
  const checks = {};
  const latency = {};

  try {
    const { getClient } = require('../../../shared/cache');
    const t0 = Date.now();
    const client = await getClient();
    await client.ping();
    checks.redis = 'ok';
    latency.redis = Date.now() - t0;
  } catch (error) {
    checks.redis = 'degraded';
    logger.warn('Gateway redis health degraded', { error: error?.message });
  }

  return { checks, latency };
}

async function getInternalServicesHealth(pathname = '/health/ready') {
  const results = {};

  await Promise.all(Object.keys(SERVICE_FALLBACKS).map(async (name) => {
    const startedAt = Date.now();
    let target = SERVICE_FALLBACKS[name];

    try {
      target = await resolveRuntimeServiceTarget(name) || target;
      const response = await fetch(`${target}${pathname}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(INTERNAL_HEALTH_TIMEOUT_MS),
      });
      const body = await response.json().catch(() => ({}));
      results[name] = {
        ready: response.ok,
        status: body.status || response.status,
        latency: Date.now() - startedAt,
      };
    } catch (error) {
      results[name] = {
        ready: false,
        status: 'unreachable',
        latency: Date.now() - startedAt,
        error: error?.message,
      };
    }
  }));

  return {
    ready: Object.values(results).every((result) => result.ready),
    results,
  };
}

function registerHealthRoutes(app, version) {
  app.get('/health', async (_req, res) => {
    const { checks, latency } = await getRedisHealth();

    res.status(200).json({
      status: 'ok',
      service: 'gateway',
      version,
      uptime: Math.floor(process.uptime()),
      ts: new Date().toISOString(),
      checks,
      latency,
    });
  });

  app.get('/health/live', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'gateway',
      ts: new Date().toISOString(),
    });
  });

  app.get('/health/ready', async (_req, res) => {
    const { checks, latency } = await getRedisHealth();
    const services = await getInternalServicesHealth();
    const ready = checks.redis === 'ok' && services.ready;

    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'not_ready',
      service: 'gateway',
      version,
      ts: new Date().toISOString(),
      checks,
      latency,
      services: services.results,
    });
  });

  app.get('/health/deep', async (_req, res) => {
    const services = await getInternalServicesHealth('/health');

    res.status(services.ready ? 200 : 207).json({
      status: services.ready ? 'ok' : 'degraded',
      service: 'gateway',
      version,
      ts: new Date().toISOString(),
      services: services.results,
    });
  });
}

module.exports = { registerHealthRoutes };
