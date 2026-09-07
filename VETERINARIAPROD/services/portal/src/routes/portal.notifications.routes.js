'use strict';

const { Router } = require('express');
const {
  db,
  R,
  portalAuth,
  getNotificationSchema,
  notificationExpr,
  notificationReadAtExpr,
  notificationMarkReadSet,
  notificationOrderExpr,
} = require('../portal.common');

const router = Router();

router.get('/', portalAuth, async (req, res, next) => {
  try {
    const { page = 1 } = req.query;
    const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);
    const offset = (Math.max(parseInt(page, 10), 1) - 1) * limit;
    const schema = await getNotificationSchema();
    const cols = schema.notification_logs || new Set();
    const rows = await db.query(
      `SELECT nl.id,
              ${notificationExpr(cols, 'nl', 'type', `'info'`)} AS notification_type,
              ${notificationExpr(cols, 'nl', 'title', `''`)} AS title,
              ${notificationExpr(cols, 'nl', 'message', `''`)} AS message,
              ${notificationExpr(cols, 'nl', 'severity', `'info'`)} AS severity,
              ${notificationExpr(cols, 'nl', 'sentAt', 'NOW()')} AS sent_at,
              ${notificationReadAtExpr(cols, 'nl')} AS read_at,
              ${notificationExpr(cols, 'nl', 'actionUrl', 'NULL')} AS action_url
       FROM notification_logs nl
       WHERE client_id=:cid
       ORDER BY ${notificationOrderExpr(cols, 'nl')} DESC
       LIMIT :limit OFFSET :offset`,
      { cid: req.owner.clientId, limit: parseInt(limit, 10), offset: parseInt(offset, 10) }
    );
    return R.ok(res, rows);
  } catch (e) { next(e); }
});

router.patch('/:id/read', portalAuth, async (req, res, next) => {
  try {
    const schema = await getNotificationSchema();
    const cols = schema.notification_logs || new Set();
    const setClause = notificationMarkReadSet(cols);
    if (!setClause) return R.noContent(res);
    await db.query(
      `UPDATE notification_logs SET ${setClause} WHERE id=:id AND client_id=:cid`,
      { id: req.params.id, cid: req.owner.clientId }
    );
    return R.noContent(res);
  } catch (e) { next(e); }
});

module.exports = router;
