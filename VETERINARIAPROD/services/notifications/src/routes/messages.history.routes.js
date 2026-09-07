'use strict';

const express = require('express');
const {
  R,
  db,
  log,
  requireUserContext,
} = require('../notifications.common');

const router = express.Router();

const ALLOWED_CHANNELS_HISTORY = new Set(['sms', 'whatsapp', 'both', 'email', 'push_topic', 'template']);

router.get('/', async (req, res, next) => {
  try {
    if (!requireUserContext(req, res)) return;

    // Cap en paginación: page máx 10000, limit entre 1 y 100
    const page  = Math.min(Math.max(parseInt(`${req.query.page  || '1'}`,  10) || 1,  1), 10000);
    const limit = Math.min(Math.max(parseInt(`${req.query.limit || '30'}`, 10) || 30, 1), 100);
    const offset = (page - 1) * limit;

    const conds = ['branch_id = :bid'];
    const p = { bid: req.user.branchId, limit, offset };
    if (req.query.channel) {
      if (!ALLOWED_CHANNELS_HISTORY.has(req.query.channel)) return R.badRequest(res, 'channel inválido');
      conds.push('channel = :channel');
      p.channel = req.query.channel;
    }

    const rows = await db.query(
      `SELECT id, channel, to_number, template_name, message_preview,
              status, twilio_sid, error_message, sent_at
       FROM message_logs
       WHERE ${conds.join(' AND ')}
       ORDER BY sent_at DESC
       LIMIT :limit OFFSET :offset`,
      p
    );
    return R.ok(res, rows);
  } catch (err) {
    log.warn('message history failed', { err: err.message });
    next(err);
  }
});

module.exports = router;
