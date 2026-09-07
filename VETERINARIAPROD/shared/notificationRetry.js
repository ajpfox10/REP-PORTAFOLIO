'use strict';

const db = require('./db');
const messaging = require('./messaging');
const fcm = require('./fcm');
const email = require('./email');

const MAX_ATTEMPTS = parseInt(process.env.NOTIFICATION_RETRY_MAX_ATTEMPTS || '5');
const PROCESSING_TTL_SEC = parseInt(process.env.NOTIFICATION_PROCESSING_TTL_SEC || String(10 * 60), 10);
const BACKOFF_MS = [60_000, 300_000, 1_800_000, 7_200_000, 28_800_000];
// BUG-34: timeout máximo por ejecución de un job (30 s por defecto)
const JOB_TIMEOUT_MS = parseInt(process.env.NOTIFICATION_JOB_TIMEOUT_MS || '30000', 10);

function nextAttemptDate(attempt) {
  return new Date(Date.now() + (BACKOFF_MS[attempt - 1] || BACKOFF_MS[BACKOFF_MS.length - 1]));
}

async function enqueueJob({ channel, payload, createdBy = null, orgId = null, branchId = null, maxAttempts = MAX_ATTEMPTS }) {
  await db.query(
    `INSERT INTO notification_retry_jobs
       (channel, payload_json, status, attempt_count, max_attempts, next_attempt_at, created_by, org_id, branch_id)
     VALUES
       (:channel, :payload, 'pending', 0, :maxAttempts, NOW(), :createdBy, :orgId, :branchId)`,
    {
      channel,
      payload: JSON.stringify(payload),
      maxAttempts,
      createdBy,
      orgId,
      branchId,
    }
  );
}

async function executeJob(channel, payload) {
  switch (channel) {
    case 'email':
      switch (payload.kind) {
        case 'password_reset':
          return email.sendPasswordReset(payload);
        case 'welcome':
          return email.sendWelcome(payload);
        case 'new_device_login':
          return email.sendNewDeviceLogin(payload);
        case '2fa_enabled':
          return email.send2faEnabled(payload);
        case 'report':
          return email.sendReportEmail(payload);
        default:
          return email.send(payload);
      }
    case 'sms':
      return messaging.sendSms(payload.to, payload.message);
    case 'whatsapp':
      return messaging.sendWhatsApp(payload.to, payload.message);
    case 'template':
      return messaging.sendTemplate(payload.channel || 'whatsapp', payload.to, payload.template, payload.vars || {});
    case 'push_topic':
      return fcm.sendToTopic(payload.topic, payload.payload);
    case 'push_tokens':
      return fcm.sendToMultiple(payload.tokens || [], payload.payload);
    default:
      throw new Error(`Unsupported notification retry channel '${channel}'`);
  }
}

async function processPendingJobs(limit = 25) {
  const rows = await db.query(
    `SELECT id, channel, payload_json, attempt_count, max_attempts
     FROM notification_retry_jobs
     WHERE status = 'pending'
       AND next_attempt_at <= NOW()
     ORDER BY next_attempt_at ASC
     LIMIT :limit`,
    { limit }
  );

  for (const row of rows) {
    const payload = typeof row.payload_json === 'string'
      ? JSON.parse(row.payload_json)
      : row.payload_json;
    const attempt = (row.attempt_count || 0) + 1;

    const [claim] = await db.query(
      `UPDATE notification_retry_jobs
       SET status = 'processing', attempt_count = :attempt, last_attempt_at = NOW(), updated_at = NOW()
       WHERE id = :id
         AND status = 'pending'
         AND next_attempt_at <= NOW()
         AND attempt_count = :previousAttempt`,
      { id: row.id, attempt, previousAttempt: row.attempt_count || 0 }
    );
    if (!claim?.affectedRows) continue;

    try {
      // BUG-34: envolver ejecución con timeout para evitar que un canal colgado bloquee el worker
      await Promise.race([
        executeJob(row.channel, payload),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Job timeout after ${JOB_TIMEOUT_MS}ms`)), JOB_TIMEOUT_MS)
        ),
      ]);
      await db.query(
        `UPDATE notification_retry_jobs
         SET status = 'sent', updated_at = NOW(), last_error = NULL
         WHERE id = :id`,
        { id: row.id }
      );
    } catch (err) {
      const failedPermanently = attempt >= (row.max_attempts || MAX_ATTEMPTS);
      await db.query(
        `UPDATE notification_retry_jobs
         SET status = :status,
             next_attempt_at = :nextAttemptAt,
             last_error = :lastError,
             updated_at = NOW()
         WHERE id = :id`,
        {
          id: row.id,
          status: failedPermanently ? 'failed' : 'pending',
          nextAttemptAt: failedPermanently ? null : nextAttemptDate(attempt),
          lastError: String(err.message || err).slice(0, 512),
        }
      );
    }
  }

  return rows.length;
}

async function resetStaleProcessingJobs() {
  const [result] = await db.query(
    `UPDATE notification_retry_jobs
     SET status = 'pending',
         next_attempt_at = NOW(),
         updated_at = NOW()
     WHERE status = 'processing'
       AND last_attempt_at < DATE_SUB(NOW(), INTERVAL :ttlSec SECOND)
       AND attempt_count < max_attempts`,
    { ttlSec: PROCESSING_TTL_SEC }
  );
  const reset = result?.affectedRows || 0;
  if (reset > 0) {
    const { createLogger } = require('./logger');
    createLogger('notification-retry').warn('Reset stale processing jobs', { count: reset });
  }
  return reset;
}

async function getQueueStats() {
  const rows = await db.query(
    `SELECT status, COUNT(*) AS cnt
     FROM notification_retry_jobs
     WHERE status IN ('pending','processing','failed')
     GROUP BY status`
  );
  const stats = { pending: 0, processing: 0, failed: 0 };
  for (const r of rows) stats[r.status] = Number(r.cnt);
  return stats;
}

module.exports = { enqueueJob, processPendingJobs, resetStaleProcessingJobs, getQueueStats };
