'use strict';

const { createRedisClient, connectRedis } = require('../../shared/redis');
const { logger } = require('./middleware/logger');

let redisSubscriber;
let redisPublisher;

async function getRedisClients() {
  if (!redisSubscriber) {
    redisSubscriber = createRedisClient('gateway-ws-sub');
    redisPublisher  = createRedisClient('gateway-ws-pub');
    await connectRedis(redisSubscriber, 'gateway-ws-sub');
    await connectRedis(redisPublisher,  'gateway-ws-pub');
  }
  return { sub: redisSubscriber, pub: redisPublisher };
}

const WS_MAX_PAYLOAD_BYTES = parseInt(process.env.WS_MAX_PAYLOAD_BYTES || String(64 * 1024), 10);

async function subscribeNotifications(onMessage) {
  const { sub } = await getRedisClients();
  let subscribed = false;

  function handleMessage(message) {
    try {
      const size = Buffer.byteLength(message, 'utf8');
      if (size > WS_MAX_PAYLOAD_BYTES) {
        logger.warn('WS: Redis message exceeds size limit — dropping', { size, limit: WS_MAX_PAYLOAD_BYTES });
        return;
      }
      const payload = JSON.parse(message);
      onMessage(payload);
    } catch (error) {
      logger.warn('WS: bad Redis message', { error: error?.message });
    }
  }

  sub.on('error', (err) => {
    logger.error('WS: Redis subscriber error', { error: err.message });
    subscribed = false;
  });

  // Re-subscribe after reconnect — node-redis v4 does not automatically
  // re-apply pub/sub subscriptions after a connection drop.
  sub.on('ready', () => {
    if (!subscribed) {
      sub.subscribe('notifications', handleMessage)
        .then(() => {
          subscribed = true;
          logger.info('WS: Redis subscription restored');
        })
        .catch((err) => {
          logger.error('WS: re-subscribe failed on reconnect — will retry on next ready event', { error: err.message });
          subscribed = false;
        });
    }
  });

  await sub.subscribe('notifications', handleMessage);
  subscribed = true;
  logger.info('WS: subscribed to Redis notifications channel');
}

async function publishNotification(payload) {
  // Enforce that every published notification has at least one scope dimension.
  // This mirrors the check in broadcast() but prevents unscopeable payloads
  // from ever reaching the Redis channel.
  if (!payload || typeof payload !== 'object') {
    throw new Error('WS publishNotification: payload must be a non-null object');
  }
  if (!payload.type) {
    throw new Error('WS publishNotification: payload.type is required');
  }
  const hasScopedTargets =
    (Array.isArray(payload.targetUserIds) && payload.targetUserIds.length > 0) ||
    (Array.isArray(payload.targetRoles)   && payload.targetRoles.length   > 0) ||
    payload.orgId     !== undefined ||
    payload.branchId  !== undefined;

  if (!hasScopedTargets) {
    throw new Error('WS publishNotification: payload must include at least one scope (orgId, branchId, targetUserIds or targetRoles)');
  }

  const { pub } = await getRedisClients();
  await pub.publish('notifications', JSON.stringify(payload));
}

module.exports = {
  getRedisClients,
  subscribeNotifications,
  publishNotification,
};
