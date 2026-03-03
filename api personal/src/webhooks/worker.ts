// src/webhooks/worker.ts
import { Sequelize } from 'sequelize';
import { processQueue } from './dispatcher';
import { logger } from '../logging/logger';

let intervalId: NodeJS.Timeout | null = null;
let isProcessing = false;

export function startWebhookWorker(sequelize: Sequelize, intervalMs: number = 5000): void {
  if (intervalId) {
    return;
  }

  logger.info({ msg: 'Starting webhook worker', intervalMs });

  intervalId = setInterval(async () => {
    if (isProcessing) {
      return;
    }

    isProcessing = true;
    try {
      await processQueue(sequelize);
    } catch (err) {
      logger.error({ msg: 'Webhook worker error', err });
    } finally {
      isProcessing = false;
    }
  }, intervalMs);
}

export function stopWebhookWorker(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info({ msg: 'Webhook worker stopped' });
  }
}