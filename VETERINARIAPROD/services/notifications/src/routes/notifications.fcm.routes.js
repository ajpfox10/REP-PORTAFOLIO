'use strict';

const express = require('express');
const { requirePerm } = require('../../../../shared/serviceBase');
const {
  R,
  db,
  log,
  fcm,
  queueNotificationRetry,
  requireUserContext,
} = require('../notifications.common');

const router = express.Router();

// FCM topic: solo [a-zA-Z0-9-_.~%] (máx 900 chars según documentación Firebase)
const FCM_TOPIC_SEGMENT_RE = /^[a-zA-Z0-9_\-]+$/;

function sanitizeTopicSegment(segment) {
  if (!segment || !FCM_TOPIC_SEGMENT_RE.test(String(segment))) return null;
  return String(segment).slice(0, 64);
}

function allowedTopicForUser(topic, user) {
  if (!topic || !user?.orgId) return false;
  if (topic === `org_${user.orgId}`) return true;
  if (user.branchId && topic === `branch_${user.branchId}`) return true;
  return (user.roles || []).some((role) => topic === `role_${user.orgId}_${role}`);
}

router.post('/register', async (req, res, next) => {
  try {
    const { token, platform = 'web', deviceName } = req.body;
    if (!token) return R.badRequest(res, 'token requerido');

    await db.query(
      `INSERT INTO user_fcm_tokens (user_id, org_id, branch_id, token, platform, device_name, is_active, last_used_at)
       VALUES (:uid, :oid, :bid, :token, :platform, :device, 1, NOW())
       ON DUPLICATE KEY UPDATE
         user_id=:uid, org_id=:oid, branch_id=:bid,
         platform=:platform, device_name=:device,
         is_active=1, last_used_at=NOW(), updated_at=NOW()`,
      { uid: req.user.userId, oid: req.user.orgId, bid: req.user.branchId || null, token, platform, device: deviceName || null }
    );

    const topics = [`org_${req.user.orgId}`];
    if (req.user.branchId) topics.push(`branch_${req.user.branchId}`);
    for (const role of req.user.roles || []) topics.push(`role_${req.user.orgId}_${role}`);

    await Promise.allSettled(topics.map((t) => fcm.subscribeToTopic([token], t)));

    return R.ok(res, { message: 'Token FCM registrado' });
  } catch (err) {
    log.warn('fcm register failed', { err: err.message });
    next(err);
  }
});

router.delete('/unregister', async (req, res, next) => {
  try {
    const { token } = req.body;
    if (!token) return R.badRequest(res, 'token requerido');

    await db.query(
      `UPDATE user_fcm_tokens SET is_active=0, updated_at=NOW()
       WHERE token=:token AND user_id=:uid`,
      { token, uid: req.user.userId }
    );

    const topics = [
      `org_${req.user.orgId}`,
      `branch_${req.user.branchId}`,
      ...(req.user.roles || []).map((r) => `role_${req.user.orgId}_${r}`),
    ].filter(Boolean);

    await Promise.allSettled(topics.map((t) => fcm.unsubscribeFromTopic([token], t)));

    return R.noContent(res);
  } catch (err) {
    log.warn('fcm unregister failed', { err: err.message });
    next(err);
  }
});

router.get('/tokens', async (req, res, next) => {
  try {
    if (!requireUserContext(req, res)) return;
    const rows = await db.query(
      `SELECT id, platform, device_name, last_used_at, created_at
       FROM user_fcm_tokens
       WHERE user_id=:uid AND is_active=1
       ORDER BY last_used_at DESC`,
      { uid: req.user.userId }
    );
    return R.ok(res, rows);
  } catch (err) {
    log.warn('fcm token list failed', { err: err.message });
    next(err);
  }
});

router.post('/send', requirePerm('notifications:send'), async (req, res, next) => {
  try {
    const { targetUserIds, topic, title, body: msgBody, data, imageUrl } = req.body;
    if (!title || !msgBody) return R.badRequest(res, 'title y body requeridos');

    const payload = { title, body: msgBody, data, imageUrl };
    let result;

    if (topic) {
      if (!allowedTopicForUser(topic, req.user)) return R.forbidden(res, 'Topic fuera del alcance del usuario', 'FCM_TOPIC_FORBIDDEN');
      await fcm.sendToTopic(topic, payload);
      result = { method: 'topic', topic };
    } else if (targetUserIds?.length) {
      const tokenRows = await db.query(
        `SELECT token FROM user_fcm_tokens
         WHERE user_id IN (:uids) AND org_id=:orgId AND is_active=1`,
        { uids: targetUserIds, orgId: req.user.orgId }
      );
      const tokens = tokenRows.map((r) => r.token);
      if (!tokens.length) return R.ok(res, { sent: 0, message: 'Sin tokens registrados' });

      result = await fcm.sendToMultiple(tokens, payload);

      if (result.failedTokens.length) {
        await db.query(
          `UPDATE user_fcm_tokens SET is_active=0 WHERE token IN (:tokens)`,
          { tokens: result.failedTokens }
        );
      }
    } else {
      return R.badRequest(res, 'Especificar targetUserIds o topic');
    }

    return R.ok(res, result);
  } catch (err) {
    log.warn('fcm send failed', { err: err.message });
    next(err);
  }
});

router.post('/broadcast', requirePerm('notifications:send'), async (req, res, next) => {
  try {
    const { branchId, roles, title, body: msgBody, data, imageUrl } = req.body;
    if (!title || !msgBody) return R.badRequest(res, 'title y body requeridos');

    const payload = { title, body: msgBody, data, imageUrl };
    const results = [];
    const orgId = req.user.orgId;
    const effectiveBranchId = branchId || req.user.branchId || null;

    if (orgId) {
      try {
        await fcm.sendToTopic(`org_${orgId}`, payload);
      } catch (err) {
        await queueNotificationRetry({ channel: 'push_topic', payload: { topic: `org_${orgId}`, payload }, req });
        log.warn('fcm org broadcast failed', { err: err.message, orgId });
      }
      results.push(`org_${orgId}`);
    }
    if (effectiveBranchId) {
      if (req.user.branchId && Number(effectiveBranchId) !== Number(req.user.branchId)) {
        return R.forbidden(res, 'Sucursal fuera del alcance del usuario', 'FCM_BRANCH_FORBIDDEN');
      }
      if (!req.user.branchId && orgId) {
        const branchOwned = await db.queryOne(
          `SELECT id FROM branches WHERE id = :bid AND organization_id = :orgId`,
          { bid: effectiveBranchId, orgId }
        );
        if (!branchOwned) return R.forbidden(res, 'Sucursal fuera de la organización', 'FCM_BRANCH_FORBIDDEN');
      }
      try {
        await fcm.sendToTopic(`branch_${effectiveBranchId}`, payload);
      } catch (err) {
        await queueNotificationRetry({ channel: 'push_topic', payload: { topic: `branch_${effectiveBranchId}`, payload }, req });
        log.warn('fcm branch broadcast failed', { err: err.message, branchId: effectiveBranchId });
      }
      results.push(`branch_${effectiveBranchId}`);
    }
    if (roles?.length && orgId) {
      if (roles.length > 50) return R.badRequest(res, 'roles no puede superar 50 entradas');
      for (const role of roles) {
        const cleanRole = sanitizeTopicSegment(role);
        if (!cleanRole) {
          log.warn('fcm broadcast: invalid role segment skipped', { role, orgId });
          continue;
        }
        const topic = `role_${orgId}_${cleanRole}`;
        try {
          await fcm.sendToTopic(topic, payload);
        } catch (err) {
          await queueNotificationRetry({ channel: 'push_topic', payload: { topic, payload }, req });
          log.warn('fcm role broadcast failed', { err: err.message, role: cleanRole, orgId });
        }
        results.push(topic);
      }
    }

    return R.ok(res, { topics: results });
  } catch (err) {
    log.warn('fcm broadcast failed', { err: err.message });
    next(err);
  }
});

module.exports = router;
