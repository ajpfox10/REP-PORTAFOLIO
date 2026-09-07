'use strict';

const { log, getRedis, processPendingJobs, resetStaleProcessingJobs, eventBus } = require('../notifications.common');

async function startRuntime({ retryIntervalMs, onEventBusMessage }) {
  await getRedis().catch((err) => log.warn('Redis not available at startup', { err: err.message }));

  const stopEventBus = await eventBus.subscribe(
    `notifications-service-${process.env.HOSTNAME || process.pid}`,
    async (event) => {
      if (onEventBusMessage) {
        await onEventBusMessage(event);
        return;
      }
      log.info('event-bus message', { topic: event.topic, ts: event.ts });
    },
    ['notifications.push'],
    { groupName: 'notifications-service' }
  ).catch((err) => {
    log.warn('event bus subscription failed', { err: err.message });
    return null;
  });

  const outboxRelay = eventBus.startOutboxRelay?.({
    intervalMs: parseInt(process.env.EVENT_BUS_OUTBOX_RELAY_INTERVAL_MS || '5000', 10),
  });

  const retryInterval = setInterval(() => {
    processPendingJobs().catch((err) => log.warn('retry worker error', { err: err.message }));
  }, retryIntervalMs);

  // Recover jobs stuck in 'processing' due to worker crash
  const staleResetInterval = setInterval(() => {
    resetStaleProcessingJobs().catch((err) => log.warn('stale reset error', { err: err.message }));
  }, parseInt(process.env.NOTIFICATION_STALE_RESET_INTERVAL_MS || String(5 * 60 * 1000), 10));

  return { stopEventBus, retryInterval, staleResetInterval, outboxRelay };
}

module.exports = { startRuntime };
