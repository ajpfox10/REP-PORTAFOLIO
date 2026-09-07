'use strict';

const { getRedisSingleton } = require('./redis');
const { createLogger } = require('./logger');

const STREAM = process.env.EVENT_BUS_STREAM || 'vetmanager:events';
const GROUP = process.env.EVENT_BUS_GROUP || 'vetmanager';
const DLQ_STREAM = process.env.EVENT_BUS_DLQ_STREAM || `${STREAM}:dlq`;
const OUTBOX_ENABLED = process.env.EVENT_BUS_OUTBOX !== 'false';
const OUTBOX_MAX_ATTEMPTS = parseInt(process.env.EVENT_BUS_OUTBOX_MAX_ATTEMPTS || '10', 10);
const OUTBOX_RELAY_INTERVAL_MS = parseInt(process.env.EVENT_BUS_OUTBOX_RELAY_INTERVAL_MS || '5000', 10);
const HANDLER_TIMEOUT_MS = parseInt(process.env.EVENT_BUS_HANDLER_TIMEOUT_MS || '30000', 10);
const DLQ_MAX_LEN = parseInt(process.env.EVENT_BUS_DLQ_MAX_LEN || '10000', 10);
const DLQ_ALERT_THRESHOLD = parseInt(process.env.EVENT_BUS_DLQ_ALERT_THRESHOLD || '500', 10);
const log = createLogger('event-bus');

let _eventBusMessages;
function getEventBusMessagesMetric() {
  if (_eventBusMessages) return _eventBusMessages;
  try {
    _eventBusMessages = require('./metrics').eventBusMessages;
  } catch (err) {
    log.warn('Event bus metric unavailable', { error: err.message });
  }
  return _eventBusMessages;
}

function count(topic, direction, result) {
  getEventBusMessagesMetric()?.inc({ topic: topic || 'unknown', direction, result });
}

async function getRedis() {
  return getRedisSingleton('event-bus', 'event-bus');
}

function getDb() {
  return require('./db');
}

async function ensureGroup(redis, groupName = GROUP) {
  try {
    await redis.xGroupCreate(STREAM, groupName, '0', { MKSTREAM: true });
  } catch (err) {
    if (!String(err?.message || '').includes('BUSYGROUP')) throw err;
  }
}

// SEC: validar que el topic no contenga caracteres de control o newlines que
// pudieran usarse para envenenar el stream o alterar el routing de mensajes.
function validateTopic(topic) {
  if (!topic || typeof topic !== 'string') {
    throw Object.assign(new Error('Event topic is required'), { code: 'INVALID_TOPIC' });
  }
  // Solo caracteres alfanuméricos, puntos, guiones y underscores
  if (!/^[a-zA-Z0-9._-]{1,128}$/.test(topic)) {
    throw Object.assign(new Error(`Invalid event topic format: '${topic}'`), { code: 'INVALID_TOPIC' });
  }
}

async function publish(topic, payload, meta = {}) {
  validateTopic(topic);
  const outboxId = OUTBOX_ENABLED
    ? await enqueueOutbox(topic, payload, meta).catch((err) => {
      log.warn('Event bus outbox enqueue failed', { topic, message: err?.message, code: err?.code });
      return null;
    })
    : null;

  const redis = await getRedis();
  if (!redis?.isReady) {
    count(topic, 'publish', 'unavailable');
    log.warn('Event bus publish deferred - Redis unavailable', { topic, outboxId });
    return outboxId ? { outboxId, deferred: true } : null;
  }

  try {
    const id = await publishToRedis(redis, topic, payload, meta, outboxId);
    if (outboxId) await markOutboxPublished(outboxId, id).catch(() => {});
    count(topic, 'publish', 'success');
    return id;
  } catch (err) {
    count(topic, 'publish', 'failure');
    if (outboxId) {
      await markOutboxRetry(outboxId, err).catch(() => {});
      log.warn('Event bus publish deferred to outbox after Redis failure', { topic, outboxId, message: err?.message, code: err?.code });
      return { outboxId, deferred: true };
    }
    log.warn('Event bus publish failed', { topic, message: err?.message, code: err?.code });
    throw err;
  }
}

async function publishToRedis(redis, topic, payload, meta = {}, outboxId = null) {
  return redis.xAdd(STREAM, '*', {
      topic,
      payload: JSON.stringify(payload || {}),
      meta: JSON.stringify({ ...(meta || {}), ...(outboxId ? { outboxId } : {}) }),
      ts: new Date().toISOString(),
  });
}

async function enqueueOutbox(topic, payload, meta = {}) {
  const db = getDb();
  const resultRows = await db.query(
    `INSERT INTO event_outbox
       (topic, payload_json, meta_json, status, attempt_count, max_attempts, next_attempt_at, created_at)
     VALUES
       (:topic, :payload, :meta, 'pending', 0, :maxAttempts, NOW(), NOW())`,
    {
      topic,
      payload: JSON.stringify(payload || {}),
      meta: JSON.stringify(meta || {}),
      maxAttempts: OUTBOX_MAX_ATTEMPTS,
    }
  );
  return resultRows[0]?.insertId || null;
}

async function markOutboxPublished(id, streamId) {
  const db = getDb();
  await db.query(
    `UPDATE event_outbox
     SET status = 'published', stream_id = :streamId, published_at = NOW(), updated_at = NOW(), last_error = NULL
     WHERE id = :id`,
    { id, streamId }
  );
}

function nextOutboxAttemptDate(attempt) {
  const seconds = Math.min(300, Math.max(5, 2 ** Math.min(attempt, 8)));
  return new Date(Date.now() + seconds * 1000);
}

async function markOutboxRetry(id, err) {
  const db = getDb();
  // Backoff exponencial real basado en el attempt_count actual (5s..300s).
  // Las expresiones CASE usan attempt_count (valor previo) y el incremento va al final,
  // por lo que se evalúan con el conteo correcto.
  await db.query(
    `UPDATE event_outbox
     SET status = CASE WHEN attempt_count + 1 >= max_attempts THEN 'failed' ELSE 'pending' END,
         next_attempt_at = CASE WHEN attempt_count + 1 >= max_attempts THEN NULL
           ELSE DATE_ADD(NOW(), INTERVAL FLOOR(LEAST(300, GREATEST(5, POW(2, LEAST(attempt_count + 1, 8))))) SECOND) END,
         attempt_count = attempt_count + 1,
         last_error = :lastError,
         updated_at = NOW()
     WHERE id = :id`,
    {
      id,
      lastError: String(err?.message || err).slice(0, 512),
    }
  );
}

async function claimOutboxRow(id) {
  const db = getDb();
  const result = await db.query(
    `UPDATE event_outbox
     SET status = 'processing', updated_at = NOW()
     WHERE id = :id
       AND status IN ('pending', 'failed')
       AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
       AND attempt_count < max_attempts`,
    { id }
  );
  return result[0]?.affectedRows === 1;
}

async function processPendingOutbox(limit = 50) {
  if (!OUTBOX_ENABLED) return 0;
  const redis = await getRedis();
  if (!redis?.isReady) return 0;

  const db = getDb();
  const rows = await db.query(
    `SELECT id, topic, payload_json, meta_json
     FROM event_outbox
     WHERE status IN ('pending', 'failed')
       AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
       AND attempt_count < max_attempts
     ORDER BY created_at ASC
     LIMIT :limit`,
    { limit }
  );

  let published = 0;
  for (const row of rows) {
    if (!await claimOutboxRow(row.id)) continue;
    const payload = typeof row.payload_json === 'string' ? JSON.parse(row.payload_json || '{}') : (row.payload_json || {});
    const meta = typeof row.meta_json === 'string' ? JSON.parse(row.meta_json || '{}') : (row.meta_json || {});
    try {
      const streamId = await publishToRedis(redis, row.topic, payload, meta, row.id);
      await markOutboxPublished(row.id, streamId);
      count(row.topic, 'relay', 'success');
      published += 1;
    } catch (err) {
      await markOutboxRetry(row.id, err).catch(() => {});
      count(row.topic, 'relay', 'failure');
    }
  }

  return published;
}

function startOutboxRelay({ intervalMs = OUTBOX_RELAY_INTERVAL_MS, limit = 50 } = {}) {
  if (!OUTBOX_ENABLED) return null;
  const timer = setInterval(() => {
    processPendingOutbox(limit).catch((err) => {
      log.warn('Event bus outbox relay failed', { message: err?.message, code: err?.code });
    });
  }, intervalMs);
  timer.unref?.();
  return timer;
}

async function writeDlq(redis, groupName, consumerName, envelope, err) {
  await redis.xAdd(DLQ_STREAM, '*', {
    topic: envelope.topic,
    payload: JSON.stringify(envelope.payload || {}),
    meta: JSON.stringify(envelope.meta || {}),
    ts: envelope.ts || new Date().toISOString(),
    group: groupName,
    consumer: consumerName,
    error: JSON.stringify({
      message: err?.message,
      code: err?.code,
      failedAt: new Date().toISOString(),
    }),
  });
  count(envelope.topic, 'consume', 'dlq');

  // Trim DLQ to max length and alert when approaching threshold
  try {
    await redis.xTrim(DLQ_STREAM, 'MAXLEN', '~', DLQ_MAX_LEN);
    const dlqLen = await redis.xLen(DLQ_STREAM);
    if (dlqLen >= DLQ_ALERT_THRESHOLD) {
      log.error('Event bus DLQ above alert threshold', {
        stream: DLQ_STREAM,
        length: dlqLen,
        threshold: DLQ_ALERT_THRESHOLD,
        maxLen: DLQ_MAX_LEN,
      });
    }
  } catch {}
}

function defaultGroupName(consumerName) {
  return `${GROUP}:${String(consumerName || 'default').replace(/[^a-zA-Z0-9_.:-]/g, '-')}`;
}

async function subscribe(consumerName, handler, topics = [], options = {}) {
  const redis = await getRedis();
  if (!redis?.isReady) return async () => {};
  const groupName = options.groupName || defaultGroupName(consumerName);
  await ensureGroup(redis, groupName);
  let stopped = false;

  async function loop() {
    while (!stopped) {
      const rows = await redis.xReadGroup(
        groupName,
        consumerName,
        { key: STREAM, id: '>' },
        { COUNT: 20, BLOCK: 5000 }
      ).catch(() => null);

      if (!rows?.length) continue;
      for (const stream of rows) {
        for (const message of stream.messages || []) {
          const topic = message.message.topic;
          if (topics.length && !topics.includes(topic)) {
            await redis.xAck(STREAM, groupName, message.id).catch(() => {});
            continue;
          }

          const envelope = {
            id: message.id,
            topic,
            payload: JSON.parse(message.message.payload || '{}'),
            meta: JSON.parse(message.message.meta || '{}'),
            ts: message.message.ts,
          };

          try {
            await Promise.race([
              handler(envelope),
              new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error(`Event handler timeout after ${HANDLER_TIMEOUT_MS}ms`), { code: 'HANDLER_TIMEOUT' })), HANDLER_TIMEOUT_MS)),
            ]);
            await redis.xAck(STREAM, groupName, message.id);
            count(topic, 'consume', 'success');
          } catch (err) {
            count(topic, 'consume', 'failure');
            try {
              await writeDlq(redis, groupName, consumerName, envelope, err);
              await redis.xAck(STREAM, groupName, message.id);
            } catch (dlqErr) {
              log.warn('Event bus DLQ write failed', {
                topic,
                groupName,
                consumerName,
                message: dlqErr?.message,
                originalError: err?.message,
              });
            }
          }
        }
      }
    }
  }

  loop().catch((err) => log.warn('Event bus loop failed', { consumerName, message: err?.message }));
  return async () => { stopped = true; };
}

module.exports = {
  publish,
  subscribe,
  processPendingOutbox,
  startOutboxRelay,
  DLQ_STREAM,
};
