'use strict';

const express = require('express');
const {
  R,
  db,
  log,
  messaging,
  queueNotificationRetry,
  reminderDueExpr,
  getRedis,
} = require('../notifications.common');
const { formatDate, formatTime } = require('../../../../shared/locale');

const router = express.Router();

const BULK_MAX_DAYS_AHEAD = 7;
// Límite duro en 200 — aunque la env var sea mayor, nunca supera este valor
const BULK_MAX_BATCH = Math.min(parseInt(process.env.BULK_REMINDER_BATCH_SIZE || '100', 10) || 100, 200);

// Rate limiting para bulk: máximo N envíos por sucursal en WINDOW_MS
const BULK_RATE_LIMIT  = parseInt(process.env.BULK_RATE_LIMIT  || '5',     10); // llamadas a POST /bulk por ventana
const BULK_RATE_WINDOW = parseInt(process.env.BULK_RATE_WINDOW_MS || '300000', 10); // 5 minutos por defecto

const PHONE_RE_BULK = /^\+?[1-9]\d{6,14}$/;

function sanitizePhone(phone) {
  const clean = String(phone || '').replace(/[\r\n\0\s]/g, '');
  return PHONE_RE_BULK.test(clean) ? clean : null;
}

async function checkBulkRateLimit(branchId) {
  const redis = await getRedis().catch(() => null);
  if (!redis?.pub?.isReady) return; // degraded — dejar pasar

  const key = `ratelimit:bulk:${branchId}`;
  const count = await redis.pub.incr(key);
  if (count === 1) await redis.pub.pExpire(key, BULK_RATE_WINDOW);
  if (count > BULK_RATE_LIMIT) {
    const ttl = await redis.pub.pTTL(key);
    const err = new Error('Bulk reminder rate limit exceeded');
    err.status = 429;
    err.retryAfter = Math.ceil(ttl / 1000);
    throw err;
  }
}

router.post('/', async (req, res, next) => {
  try {
    // Rate limit: evitar flood de envíos bulk desde la misma sucursal
    try {
      await checkBulkRateLimit(req.user?.branchId);
    } catch (rlErr) {
      if (rlErr.status === 429) {
        res.setHeader('Retry-After', rlErr.retryAfter || 300);
        return R.tooMany(res, 'Bulk reminder rate limit exceeded — try again later');
      }
      throw rlErr;
    }

    const channel   = ['sms', 'whatsapp', 'both'].includes(req.body.channel) ? req.body.channel : 'both';
    const daysAhead = Math.min(Math.max(parseInt(req.body.daysAhead ?? 1, 10) || 1, 0), BULK_MAX_DAYS_AHEAD);

    const reminders = await db.query(
      `SELECT r.id, r.reminder_type, ${reminderDueExpr('r')} AS due_date,
              p.name AS pet_name,
              CONCAT(cl.first_name,' ',cl.last_name) AS owner_name,
              cl.phone,
              b.name AS clinic_name
       FROM reminders r
       JOIN patients p        ON r.patient_id = p.id
       JOIN patient_owners po ON po.patient_id = p.id AND po.ownership_type = 'primary'
       JOIN clients cl         ON po.client_id = cl.id
       JOIN branches b         ON r.branch_id = b.id
       WHERE r.branch_id = :bid
         AND r.status = 'pending'
         AND r.scheduled_send_at BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL :days DAY)
         AND cl.phone IS NOT NULL
       LIMIT :limit`,
      { bid: req.user.branchId, days: daysAhead, limit: BULK_MAX_BATCH }
    );

    let sent = 0;
    let failed = 0;
    for (const r of reminders) {
      const cleanPhone = sanitizePhone(r.phone);
      if (!cleanPhone) {
        log.warn('bulk reminder skipped: invalid phone', { reminderId: r.id });
        failed++;
        continue;
      }
      try {
        const retryPayload = {
          channel,
          to: cleanPhone,
          template: 'appointmentReminder',
          vars: {
            ownerName: r.owner_name,
            petName: r.pet_name,
            date: formatDate(r.due_date),
            time: formatTime(r.due_date),
            vetName: 'su veterinario',
            clinicName: r.clinic_name,
          },
        };
        await messaging.sendTemplate(channel, retryPayload.to, retryPayload.template, retryPayload.vars);
        await db.query(`UPDATE reminders SET status='sent', sent_at=NOW() WHERE id=:id`, { id: r.id });
        sent++;
      } catch (err) {
        await queueNotificationRetry({
          channel: 'template',
          payload: {
            channel,
            to: cleanPhone,
            template: 'appointmentReminder',
            vars: {
              ownerName: r.owner_name,
              petName: r.pet_name,
              date: formatDate(r.due_date),
              time: formatTime(r.due_date),
              vetName: 'su veterinario',
              clinicName: r.clinic_name,
            },
          },
          req,
        }).catch((retryErr) => log.warn('bulk reminder retry queue failed', { err: retryErr.message, reminderId: r.id }));
        failed++;
      }
    }

    return R.ok(res, { total: reminders.length, sent, failed });
  } catch (err) {
    log.warn('bulk reminders failed', { err: err.message });
    next(err);
  }
});

module.exports = router;
