'use strict';

/**
 * Webhook dispatcher — mirrors apipersonal webhook system.
 *
 * Fetches pending webhook_deliveries, fires HTTP POST with HMAC signature,
 * records result, and applies exponential back-off on failure.
 *
 * Max retries: 5 (backoff: 1m, 5m, 30m, 2h, 8h)
 */

const axios  = require('axios');
const { URL } = require('url');
const db     = require('../db');
const { sign, HEADER } = require('./signature');
const { webhookDeliveries } = require('../metrics');
const dns = require('dns').promises;
const { isPrivateIp } = require('../ssrf');

// SSRF protection: block requests to private/loopback/link-local addresses
const BLOCKED_HOSTS = /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|::1|0\.0\.0\.0|169\.254\.\d+\.\d+|fd[0-9a-f]{2}:.*)$/i;

function isSafeWebhookUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    const hostname = u.hostname;
    if (BLOCKED_HOSTS.test(hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

const MAX_RETRIES = 5;
const BACKOFF_MS  = [60_000, 300_000, 1_800_000, 7_200_000, 28_800_000];
const CLAIM_TTL_MS = Math.max(30_000, parseInt(process.env.WEBHOOK_DELIVERY_CLAIM_TTL_MS || '120000', 10));

/**
 * Enqueue a webhook event for all subscribers of that event type.
 *
 * @param {object} opts
 * @param {string} opts.event      e.g. 'patient.created'
 * @param {object} opts.payload    JSON-serialisable event data
 * @param {number} [opts.orgId]    scope to org (null = all orgs)
 */
async function enqueue({ event, payload, orgId = null }) {
  // Find all active webhook endpoints subscribed to this event (or wildcard *)
  const endpoints = await db.query(
    `SELECT we.id, we.url, we.secret
       FROM webhook_endpoints we
       JOIN webhook_subscriptions ws ON ws.endpoint_id = we.id
      WHERE we.is_active = 1
        AND (ws.event_type = :event OR ws.event_type = '*')
        AND (:orgId IS NULL OR we.org_id = :orgId)`,
    { event, orgId },
  );

  if (!endpoints.length) return;

  const payloadJson = JSON.stringify({ event, data: payload, timestamp: new Date().toISOString() });

  // Guard against storing extremely large payloads in the deliveries table.
  // 64 KB is ample for any legitimate webhook payload; truncation prevents
  // unbounded DB growth and limits accidental PII storage in retry queues.
  const MAX_PAYLOAD_BYTES = 65536;
  if (Buffer.byteLength(payloadJson, 'utf8') > MAX_PAYLOAD_BYTES) {
    const { createLogger } = require('../logger');
    createLogger('webhook-dispatcher').warn('Webhook payload truncated — exceeds 64 KB', {
      event,
      orgId,
      payloadSize: Buffer.byteLength(payloadJson, 'utf8'),
    });
    // Store a stub payload so the delivery record still exists for monitoring
    const stubPayload = JSON.stringify({
      event,
      data:      { _truncated: true, _reason: 'payload_too_large' },
      timestamp: new Date().toISOString(),
    });
    for (const ep of endpoints) {
      await db.query(
        `INSERT INTO webhook_deliveries
           (endpoint_id, event_type, payload, status, next_attempt_at, created_at)
         VALUES (:endpointId, :event, :payload, 'failed', NOW(), NOW())`,
        { endpointId: ep.id, event, payload: stubPayload },
      );
    }
    return;
  }

  for (const ep of endpoints) {
    await db.query(
      `INSERT INTO webhook_deliveries
         (endpoint_id, event_type, payload, status, next_attempt_at, created_at)
       VALUES (:endpointId, :event, :payload, 'pending', NOW(), NOW())`,
      { endpointId: ep.id, event, payload: payloadJson },
    );
  }
}

/**
 * Process one batch of pending deliveries.
 * Called by the worker on each tick.
 */
async function processPending() {
  const rows = await db.query(
    `SELECT id
       FROM webhook_deliveries
      WHERE status = 'pending'
        AND next_attempt_at <= NOW()
      ORDER BY next_attempt_at ASC, id ASC
      LIMIT 50`,
  );

  await Promise.allSettled(rows.map(async ({ id }) => {
    const delivery = await claimDelivery(id);
    if (!delivery) return;
    await deliver(delivery);
  }));
}

async function claimDelivery(id) {
  const leaseUntil = new Date(Date.now() + CLAIM_TTL_MS);
  const [claim] = await db.query(
    `UPDATE webhook_deliveries
        SET attempt_count = attempt_count + 1,
            last_attempt_at = NOW(),
            next_attempt_at = :leaseUntil
      WHERE id = :id
        AND status = 'pending'
        AND next_attempt_at <= NOW()`,
    { id, leaseUntil },
  );

  if (claim.affectedRows !== 1) return null;

  return db.queryOne(
    `SELECT wd.id, wd.endpoint_id, wd.event_type, wd.payload, wd.attempt_count,
            we.url, we.secret
       FROM webhook_deliveries wd
       JOIN webhook_endpoints we ON we.id = wd.endpoint_id
      WHERE wd.id = :id`,
    { id },
  );
}

async function deliver(row) {
  const { id, url, secret, payload, attempt_count } = row;
  const attempt = attempt_count || 1;
  const sig     = sign(payload, secret || '');

  let success = false;
  let responseStatus = null;
  let responseBody   = null;
  let errorMessage   = null;

  // SSRF guard — reject internal/private addresses before making the request.
  // 1) chequeo sincrónico del hostname literal; 2) resolución DNS para frenar
  // DNS-rebinding (un dominio público que resuelve a una IP interna).
  // Solo bloquea ante una resolución CONFIRMADA a IP privada; un fallo de DNS NO
  // bloquea (axios fallará y el backoff reintentará), para no romper entregas ante
  // DNS transitorio o entornos sin resolución.
  let ssrfBlocked = !isSafeWebhookUrl(url);
  if (!ssrfBlocked) {
    try {
      const host = new URL(url).hostname;
      const isLiteralIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
      if (!isLiteralIp) {
        const addresses = await dns.lookup(host, { all: true });
        if (addresses.some(({ address }) => isPrivateIp(address))) {
          ssrfBlocked = true;
          errorMessage = 'SSRF blocked: el dominio resuelve a una dirección privada';
        }
      }
    } catch { /* DNS error → no bloquear; axios manejará el fallo y el backoff reintentará */ }
  }
  if (ssrfBlocked) {
    if (!errorMessage) errorMessage = `SSRF blocked: delivery to '${url}' is not allowed`;
    await db.query(
      `UPDATE webhook_deliveries
          SET status = 'failed', attempt_count = :attempt, last_attempt_at = NOW(),
              error_message = :errorMessage
        WHERE id = :id`,
      { id, attempt, errorMessage }
    );
    return;
  }

  try {
    const resp = await axios.post(url, JSON.parse(payload), {
      headers: {
        'Content-Type': 'application/json',
        [HEADER]:        sig,
        'X-Webhook-Event': row.event_type,
        'X-Delivery-Id':   String(id),
      },
      timeout: 10_000,
      maxRedirects: 0,
    });

    success        = resp.status >= 200 && resp.status < 300;
    responseStatus = resp.status;
    responseBody   = JSON.stringify(resp.data).slice(0, 2048);
  } catch (err) {
    errorMessage   = err.message?.slice(0, 512);
    responseStatus = err.response?.status || null;
    responseBody   = err.response ? JSON.stringify(err.response.data).slice(0, 2048) : null;
  }

  const status = success
    ? 'delivered'
    : attempt >= MAX_RETRIES ? 'failed' : 'pending';

  const nextAttemptAt = (!success && attempt < MAX_RETRIES)
    ? new Date(Date.now() + (BACKOFF_MS[attempt - 1] || BACKOFF_MS[BACKOFF_MS.length - 1]))
    : null;

  await db.query(
    `UPDATE webhook_deliveries
        SET status           = :status,
            attempt_count    = :attempt,
            last_attempt_at  = NOW(),
            next_attempt_at  = :nextAttemptAt,
            response_status  = :responseStatus,
            response_body    = :responseBody,
            error_message    = :errorMessage
      WHERE id = :id`,
    { id, status, attempt, nextAttemptAt, responseStatus, responseBody, errorMessage },
  );

  webhookDeliveries?.inc({ event: row.event_type, result: success ? 'success' : 'failure' });
}

async function getQueueStats() {
  const rows = await db.query(
    `SELECT status, COUNT(*) AS cnt
     FROM webhook_deliveries
     WHERE status IN ('pending','processing','failed')
     GROUP BY status`
  );
  const stats = { pending: 0, processing: 0, failed: 0 };
  for (const r of rows) stats[r.status] = Number(r.cnt);
  return stats;
}

module.exports = { enqueue, processPending, getQueueStats };
