/**
 * Scheduler — daily cron jobs using setInterval / BullMQ repeatable jobs
 *
 * Jobs registered at startup:
 *   - 08:00 AR → vacuna-reminders: find pacientes with proxima_dosis in next 7 days
 *   - 18:00 AR → turno-reminders: find turnos for tomorrow, send reminders
 *   - 00:05    → outbox-dispatch: flush any pending outbox events
 *   - Weekly   → audit-verify-chain: verify integrity of each tenant's audit log
 *
 * Uses BullMQ repeatable jobs so the scheduler is cluster-safe:
 * only one worker picks up each repeat even with multiple app instances.
 */

import { Queue } from "bullmq";
import type Redis from "ioredis";
import type { Pool } from "mysql2/promise";
import { logger } from "../core/logging/logger.js";

export async function startScheduler(opts: {
  redis: Redis;
  masterPool: Pool;
  tenantPoolFactory: (dbName: string) => Pool;
}) {
  const queue = new Queue("jobs", { connection: opts.redis });

  logger.info("Registering scheduled jobs...");

  // ── Daily: vaccine reminders at 08:00 (UTC-3 = 11:00 UTC) ────────────────
  await queue.add(
    "scheduler:vacuna-reminders",
    { type: "vacuna-reminders" },
    {
      repeat: { pattern: "0 11 * * *", tz: "America/Argentina/Buenos_Aires" },
      jobId: "vacuna-reminders-daily",
      removeOnComplete: 10,
      removeOnFail: 5,
    }
  );

  // ── Daily: turno reminders at 18:00 AR (21:00 UTC) ──────────────────────
  await queue.add(
    "scheduler:turno-reminders",
    { type: "turno-reminders" },
    {
      repeat: { pattern: "0 21 * * *", tz: "America/Argentina/Buenos_Aires" },
      jobId: "turno-reminders-daily",
      removeOnComplete: 10,
      removeOnFail: 5,
    }
  );

  // ── Every 5 min: outbox dispatcher ───────────────────────────────────────
  await queue.add(
    "scheduler:outbox-dispatch",
    { type: "outbox-dispatch" },
    {
      repeat: { every: 5 * 60 * 1000 },
      jobId: "outbox-dispatch-repeat",
      removeOnComplete: 5,
    }
  );

  // ── Weekly Monday 02:00 AR: audit chain verification ────────────────────
  await queue.add(
    "scheduler:audit-verify",
    { type: "audit-verify-chain" },
    {
      repeat: { pattern: "0 5 * * 1", tz: "America/Argentina/Buenos_Aires" },
      jobId: "audit-verify-weekly",
      removeOnComplete: 5,
      removeOnFail: 5,
    }
  );

  logger.info("Scheduled jobs registered");

  // ── Dispatch handler for scheduler meta-jobs ─────────────────────────────
  // The worker/index.ts handles the actual jobs.
  // Here we dispatch tenant-specific sub-jobs when the scheduler fires.
  const { Worker } = await import("bullmq");

  const schedulerWorker = new Worker(
    "jobs",
    async (job) => {
      if (!job.name.startsWith("scheduler:")) return;

      const { type } = job.data ?? {};
      logger.info({ type }, "scheduler job fired");

      const [tenants] = await opts.masterPool.query<any[]>(
        "SELECT tenant_id, db_name FROM tenants WHERE status='active'"
      );

      for (const tenant of tenants) {
        try {
          if (type === "vacuna-reminders") {
            await dispatchVacunaReminders(queue, tenant, opts.tenantPoolFactory);
          } else if (type === "turno-reminders") {
            await dispatchTurnoReminders(queue, tenant, opts.tenantPoolFactory);
          } else if (type === "outbox-dispatch") {
            await queue.add("outbox-dispatch", { tenantId: tenant.tenant_id, dbName: tenant.db_name });
          } else if (type === "audit-verify-chain") {
            await queue.add("audit-verify-chain", { tenantId: tenant.tenant_id, dbName: tenant.db_name });
          }
        } catch (e) {
          logger.error({ err: e, tenantId: tenant.tenant_id, type }, "scheduler dispatch error");
        }
      }
    },
    { connection: opts.redis, concurrency: 1 }
  );

  schedulerWorker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "scheduler worker job failed");
  });

  return { queue, schedulerWorker };
}

async function dispatchVacunaReminders(
  queue: Queue,
  tenant: { tenant_id: string; db_name: string },
  tenantPoolFactory: (dbName: string) => any
) {
  const pool = tenantPoolFactory(tenant.db_name);
  const [rows] = await pool.query<any[]>(
    `SELECT v.id as vacuna_id, v.paciente_id, pr.email as owner_email, pr.telefono
     FROM vacunas v
     JOIN pacientes p ON p.id=v.paciente_id
     LEFT JOIN propietarios pr ON pr.id=p.propietario_id
     WHERE v.tenant_id=? AND v.recordatorio_env=0
       AND v.proxima_dosis BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)
       AND pr.email IS NOT NULL`,
    [tenant.tenant_id]
  );

  for (const row of rows) {
    await queue.add("vacuna-reminder", {
      tenantId: tenant.tenant_id,
      dbName: tenant.db_name,
      pacienteId: row.paciente_id,
      vacunaId: row.vacuna_id,
      ownerEmail: row.owner_email,
    }, { attempts: 3, backoff: { type: "exponential", delay: 60_000 } });
  }

  logger.info({ tenantId: tenant.tenant_id, count: rows.length }, "vacuna reminders dispatched");
}

async function dispatchTurnoReminders(
  queue: Queue,
  tenant: { tenant_id: string; db_name: string },
  tenantPoolFactory: (dbName: string) => any
) {
  const pool = tenantPoolFactory(tenant.db_name);
  const [rows] = await pool.query<any[]>(
    `SELECT t.id as turno_id, pr.email as owner_email, pr.telefono
     FROM turnos t
     LEFT JOIN propietarios pr ON pr.id=t.propietario_id
     WHERE t.tenant_id=? AND t.recordatorio_env=0
       AND DATE(t.fecha_hora) = DATE_ADD(CURDATE(), INTERVAL 1 DAY)
       AND t.estado IN ('pendiente','confirmado')
       AND pr.email IS NOT NULL`,
    [tenant.tenant_id]
  );

  for (const row of rows) {
    await queue.add("turno-reminder", {
      tenantId: tenant.tenant_id,
      dbName: tenant.db_name,
      turnoId: row.turno_id,
      ownerEmail: row.owner_email,
    }, { attempts: 3, backoff: { type: "exponential", delay: 60_000 } });
  }

  logger.info({ tenantId: tenant.tenant_id, count: rows.length }, "turno reminders dispatched");
}
