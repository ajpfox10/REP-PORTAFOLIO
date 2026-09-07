'use strict';

const { logger } = require('../middleware/logger');
const { config } = require('../config');
const eventBus = require('../../../shared/eventBus');
const { validateCriticalEnv } = require('../../../shared/validateEnv');

function attachRuntime(server, { port, version, attachWebSocket, webhookWorker }) {
  validateCriticalEnv(logger);

  let webhookWorkerStarted = false;
  let wss = null;
  const outboxRelay = eventBus.startOutboxRelay({
    intervalMs: parseInt(process.env.EVENT_BUS_OUTBOX_RELAY_INTERVAL_MS || '5000', 10),
  });

  attachWebSocket(server)
    .then((ws) => { wss = ws; })
    .catch((error) => logger.error('WS init error', { error: error.message }));

  if (config.webhookWorkerEnabled) {
    webhookWorker.start();
    webhookWorkerStarted = true;
    logger.info('Webhook worker started');
  }

  server.listen(port, () => {
    logger.info(`Gateway running on port ${port}`, { env: config.env, version });
  });

  function shutdown(signal) {
    logger.info(`${signal} received — starting graceful shutdown`);
    if (webhookWorkerStarted) webhookWorker.stop();
    if (outboxRelay) clearInterval(outboxRelay);
    if (wss) {
      wss.clients.forEach((client) => client.terminate());
      wss.close();
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection — exiting process', { reason: String(reason?.message || reason) });
    process.exit(1);
  });
}

module.exports = { attachRuntime };
