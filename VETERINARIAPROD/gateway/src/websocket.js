'use strict';

const { WebSocketServer } = require('ws');
const { logger } = require('./middleware/logger');
const { verifyWsRequest, getTokenFromRequest, isAllowedOrigin } = require('./websocket.auth');
const { registerSocket, broadcast, attachHeartbeat } = require('./websocket.connections');
const { subscribeNotifications, publishNotification } = require('./websocket.pubsub');

async function attachWebSocket(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  await subscribeNotifications(broadcast);

  wss.on('connection', async (ws, req) => {
    const auth = await verifyWsRequest(req);
    if (!auth.ok) {
      logger.warn(auth.log.message, auth.log.meta);
      ws.close(auth.code, auth.reason);
      return;
    }

    registerSocket(auth.user, ws, req);
  });

  wss.on('error', (err) => {
    logger.error('WebSocket server error', { error: err.message, stack: err.stack });
  });

  attachHeartbeat(wss);

  logger.info('WebSocket server attached at /ws');
  return wss;
}

module.exports = { attachWebSocket, publishNotification, broadcast, getTokenFromRequest, isAllowedOrigin };
