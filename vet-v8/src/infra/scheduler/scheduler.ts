/**
 * Scheduler — registra repeatable jobs en BullMQ.
 *
 * FIX: Solo registra los jobs (schedule), NO arranca un Worker acá.
 * El worker que procesa los scheduler jobs está en src/scheduler/schedulerWorker.ts
 * y corre como proceso SEPARADO (docker-compose: servicio "scheduler").
 *
 * Esto evita que cada instancia del API tenga su propio worker compitiendo.
 */

import { Queue } from "bullmq";
import type Redis from "ioredis";
import { logger } from "../../core/logging/logger.js";

export async function registerScheduledJobs(opts: { redis: Redis }) {
  const queue = new Queue("scheduler", { connection: opts.redis });

  logger.info("Registering scheduled jobs...");

  await queue.add(
    "vacuna-reminders",
    { type: "vacuna-reminders" },
    {
      repeat: { pattern: "0 8 * * *", tz: "America/Argentina/Buenos_Aires" },
      jobId: "vacuna-reminders-daily",
      removeOnComplete: 10,
      removeOnFail: 5,
    }
  );

  await queue.add(
    "turno-reminders",
    { type: "turno-reminders" },
    {
      repeat: { pattern: "0 18 * * *", tz: "America/Argentina/Buenos_Aires" },
      jobId: "turno-reminders-daily",
      removeOnComplete: 10,
      removeOnFail: 5,
    }
  );

  await queue.add(
    "outbox-dispatch",
    { type: "outbox-dispatch" },
    {
      repeat: { every: 5 * 60 * 1000 },
      jobId: "outbox-dispatch-repeat",
      removeOnComplete: 5,
    }
  );

  await queue.add(
    "audit-verify",
    { type: "audit-verify-chain" },
    {
      repeat: { pattern: "0 2 * * 1", tz: "America/Argentina/Buenos_Aires" },
      jobId: "audit-verify-weekly",
      removeOnComplete: 5,
      removeOnFail: 5,
    }
  );

  logger.info("Scheduled jobs registered on queue 'scheduler'");
  return queue;
}
