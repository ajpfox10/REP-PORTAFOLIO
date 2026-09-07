'use strict';

const { logger } = require('./middleware/logger');
const { config } = require('./config');
const { getRedisSingleton } = require('../../shared/redis');

const userSockets = new Map();
const ipConnections = new Map();

const MAX_SOCKETS_PER_USER    = parseInt(process.env.WS_MAX_CONNECTIONS_PER_USER || '5',  10);
const MAX_SOCKETS_PER_IP      = parseInt(process.env.WS_MAX_CONNECTIONS_PER_IP   || '20', 10);
const WS_MAX_CLIENT_MSG_BYTES = parseInt(process.env.WS_MAX_CLIENT_MSG_BYTES     || String(4 * 1024), 10);

function normalizeId(value) {
  if (value === undefined || value === null || value === '') return null;
  return String(value);
}

function normalizeRoles(roles) {
  if (!Array.isArray(roles)) return [];
  return roles.map((role) => String(role).trim().toLowerCase()).filter(Boolean);
}

function socketMatchesScope(ws, payload) {
  const userContext = ws.userContext || {};
  const targetUserIds = Array.isArray(payload.targetUserIds)
    ? payload.targetUserIds.map((id) => String(id))
    : [];
  const targetRoles = Array.isArray(payload.targetRoles)
    ? payload.targetRoles.map((role) => String(role).trim().toLowerCase()).filter(Boolean)
    : [];
  const targetOrgId    = normalizeId(payload.orgId);
  const targetBranchId = normalizeId(payload.branchId);

  if (targetUserIds.length && !targetUserIds.includes(userContext.userId)) return false;
  if (targetOrgId     && userContext.orgId     !== targetOrgId)     return false;
  if (targetBranchId  && userContext.branchId  !== targetBranchId)  return false;
  if (targetRoles.length && !targetRoles.some((role) => userContext.roles.includes(role))) return false;

  return true;
}

function registerSocket(user, ws, req) {
  const userId = String(user.userId);
  const ip     = req.socket?.remoteAddress || 'unknown';

  // Per-user connection limit
  if (!userSockets.has(userId)) userSockets.set(userId, new Set());
  const userSet = userSockets.get(userId);
  if (userSet.size >= MAX_SOCKETS_PER_USER) {
    logger.warn('WS: max connections per user reached — rejecting', { userId, limit: MAX_SOCKETS_PER_USER });
    ws.close(4029, 'Too many connections');
    return;
  }

  // Per-IP connection limit
  const ipCount = ipConnections.get(ip) || 0;
  if (ipCount >= MAX_SOCKETS_PER_IP) {
    logger.warn('WS: max connections per IP reached — rejecting', { ip, limit: MAX_SOCKETS_PER_IP });
    ws.close(4029, 'Too many connections');
    return;
  }
  ipConnections.set(ip, ipCount + 1);

  userSet.add(ws);
  ws.userContext = {
    userId,
    orgId:    normalizeId(user.orgId),
    branchId: normalizeId(user.branchId),
    roles:    normalizeRoles(user.roles),
    jti:      user.jti || null,
  };
  ws.tokenExp = user.exp ? user.exp * 1000 : null;
  ws._ip = ip;

  logger.info('WS: client connected', { userId, ip });

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (rawData) => {
    if (rawData.length > WS_MAX_CLIENT_MSG_BYTES) {
      logger.warn('WS: client message too large — dropping', {
        userId, size: rawData.length, limit: WS_MAX_CLIENT_MSG_BYTES,
      });
      return;
    }
    try {
      const msg = JSON.parse(rawData.toString());
      if (!msg || typeof msg.type !== 'string') {
        logger.warn('WS: invalid message schema — missing type', { userId });
        return;
      }
      if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
    } catch (error) {
      logger.warn('WS: invalid message payload', { userId, error: error?.message });
    }
  });

  function cleanup() {
    const sockets = userSockets.get(userId);
    if (sockets) {
      sockets.delete(ws);
      if (sockets.size === 0) userSockets.delete(userId);
    }
    const current = ipConnections.get(ip) || 0;
    if (current <= 1) ipConnections.delete(ip);
    else ipConnections.set(ip, current - 1);
  }

  ws.on('error', (err) => {
    logger.error('WS: client socket error', { userId, error: err.message });
    cleanup();
    try { ws.terminate(); } catch (_) {}
  });

  ws.on('close', () => {
    cleanup();
    logger.info('WS: client disconnected', { userId });
  });

  ws.send(JSON.stringify({ type: 'connected' }));
}

function broadcast(payload) {
  const { type, data } = payload;
  if (!type) {
    logger.warn('WS: notification dropped — missing type', { payload });
    return;
  }

  const hasScopedTargets =
    (Array.isArray(payload.targetUserIds) && payload.targetUserIds.length > 0) ||
    (Array.isArray(payload.targetRoles)   && payload.targetRoles.length   > 0) ||
    payload.orgId     !== undefined ||
    payload.branchId  !== undefined;

  if (!hasScopedTargets) {
    logger.warn('WS: notification dropped — no scope (orgId, branchId, targetUserIds or targetRoles required)', { type });
    return;
  }

  const message = JSON.stringify({ type, data, ts: new Date().toISOString() });

  if (Array.isArray(payload.targetUserIds) && payload.targetUserIds.length > 0) {
    for (const uid of payload.targetUserIds) {
      const sockets = userSockets.get(String(uid));
      if (!sockets) continue;
      for (const ws of sockets) {
        if (ws.readyState === 1 && socketMatchesScope(ws, payload)) ws.send(message);
      }
    }
    return;
  }

  for (const [, sockets] of userSockets) {
    for (const ws of sockets) {
      if (ws.readyState !== 1) continue;
      if (socketMatchesScope(ws, payload)) ws.send(message);
    }
  }
}

function attachHeartbeat(wss) {
  const heartbeatInterval = setInterval(async () => {
    const now = Date.now();
    let redis = null;
    try {
      redis = await getRedisSingleton('gateway-auth', 'gateway-auth');
    } catch (_) {}

    for (const ws of wss.clients) {
      // Token expiry check
      if (ws.tokenExp && now > ws.tokenExp) {
        logger.warn('WS: terminating — token expired', { userId: ws.userContext?.userId });
        ws.terminate();
        continue;
      }
      // Revocation check against Redis
      if (ws.userContext?.jti && redis?.isReady) {
        try {
          const revoked = await redis.get(`revoked:${ws.userContext.jti}`);
          if (revoked) {
            logger.warn('WS: terminating — token revoked', { userId: ws.userContext?.userId });
            ws.terminate();
            continue;
          }
        } catch (_) {}
      }
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }

    // Purge stale entries from userSockets (closed but not yet cleaned up)
    for (const [uid, sockets] of userSockets) {
      for (const ws of sockets) {
        if (ws.readyState === 3 /* CLOSED */) sockets.delete(ws);
      }
      if (sockets.size === 0) userSockets.delete(uid);
    }
  }, config.wsHeartbeatIntervalMs);

  wss.on('close', () => clearInterval(heartbeatInterval));
}

module.exports = {
  userSockets,
  registerSocket,
  broadcast,
  attachHeartbeat,
};
