'use strict';

const db = require('../../../shared/db');
const R = require('../../../shared/response');
const messaging = require('../../../shared/messaging');
const fcm = require('../../../shared/fcm');
const notify = require('../../../shared/redis-notify');
const { createRedisClient, connectRedis } = require('../../../shared/redis');
const {
  getNotificationSchema,
  notificationExpr,
  notificationReadAtExpr,
  notificationUnreadPredicate,
  notificationMarkReadSet,
  notificationOrderExpr,
  buildNotificationInsert,
} = require('../../../shared/notificationLogSchema');
const { createLogger } = require('../../../shared/logger');
const { enqueueJob, processPendingJobs, resetStaleProcessingJobs, getQueueStats } = require('../../../shared/notificationRetry');
const eventBus = require('../../../shared/eventBus');

const log = createLogger('notifications');

let redisPub;
let redisSub;

async function getRedis() {
  if (!redisPub) {
    redisPub = createRedisClient('notifications-pub');
    redisSub = createRedisClient('notifications-sub');
    await Promise.all([
      connectRedis(redisPub, 'notifications-pub'),
      connectRedis(redisSub, 'notifications-sub'),
    ]);
    if (redisPub.isReady && redisSub.isReady) {
      log.info('Redis connected');
    } else {
      log.warn('Redis unavailable, continuing in degraded mode');
    }
  }
  return { pub: redisPub, sub: redisSub };
}

function requireUserContext(req, res) {
  if (!req.user?.userId) {
    R.unauthorized(res, 'User context required');
    return false;
  }
  return true;
}

function parsePageLimit(query, defaultLimit = 30) {
  const page = Math.max(parseInt(`${query.page || '1'}`, 10) || 1, 1);
  const limit = Math.min(parseInt(`${query.limit || `${defaultLimit}`}`, 10) || defaultLimit, 100);
  return { page, limit, offset: (page - 1) * limit };
}

function reminderDueExpr(alias = 'r') {
  return `COALESCE(${alias}.scheduled_send_at, ${alias}.created_at)`;
}

async function logMessage({ channel, to, message, result, userId, branchId, template, relatedId, relatedType }) {
  try {
    const sid = Array.isArray(result) ? result[0]?.sid : result?.sid;
    const status = Array.isArray(result) ? (result.some((r) => r.sid) ? 'sent' : 'failed') : (result?.sid ? 'sent' : 'failed');
    const error = Array.isArray(result) ? result.find((r) => r.error)?.error : result?.error;

    await db.query(
      `INSERT INTO message_logs
         (branch_id, user_id, channel, to_number, template_name, message_preview,
          status, twilio_sid, error_message, related_entity_type, related_entity_id, sent_at)
       VALUES (:bid, :uid, :ch, :to, :tmpl, :preview, :status, :sid, :err, :relType, :relId, NOW())`,
      {
        bid: branchId,
        uid: userId || null,
        ch: channel,
        to,
        tmpl: template || null,
        preview: message?.slice(0, 255),
        status,
        sid: sid || null,
        err: error || null,
        relType: relatedType || null,
        relId: relatedId || null,
      }
    );
  } catch (err) {
    log.warn('message log failed', { err: err.message, channel, to, branchId });
  }
}

async function queueNotificationRetry({ channel, payload, req }) {
  await enqueueJob({
    channel,
    payload,
    createdBy: req.user?.userId || null,
    orgId: req.user?.orgId || null,
    branchId: req.user?.branchId || null,
  });
}

module.exports = {
  R,
  db,
  fcm,
  log,
  messaging,
  notify,
  eventBus,
  getRedis,
  requireUserContext,
  parsePageLimit,
  reminderDueExpr,
  logMessage,
  queueNotificationRetry,
  getNotificationSchema,
  notificationExpr,
  notificationReadAtExpr,
  notificationUnreadPredicate,
  notificationMarkReadSet,
  notificationOrderExpr,
  buildNotificationInsert,
  processPendingJobs,
  resetStaleProcessingJobs,
  getQueueStats,
};
