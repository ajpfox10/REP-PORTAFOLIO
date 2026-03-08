/**
 * schedulerWorker — proceso SEPARADO del API.
 *
 * Consume la queue "scheduler" y dispara jobs tenant-específicos
 * en la queue "jobs" (consumida por worker/index.ts).
 *
 * Corre como: node dist/scheduler/schedulerWorker.js
 * Docker: servicio "scheduler" en docker-compose.yml
 *
 * Con concurrency:1 y la queue "scheduler" solo hay UN procesador
 * activo en todo el cluster, sin importar cuántas replicas haya.
 */

import { Worker, Queue } from "bullmq";
import { loadConfig } from "../config/loadConfig.js";
import { buildRedis } from "../infra/redis/redisClient.js";
import { buildMasterPool, buildTenantPoolFactory } from "../db/pools.js";
import { logger } from "../core/logging/logger.js";

const config = loadConfig();
const redis  = buildRedis(config);
const masterPool = buildMasterPool(config);
const tenantPoolFactory = buildTenantPoolFactory(config);
const jobsQueue = new Queue("jobs", { connection: redis });

const worker = new Worker(
  "scheduler",
  async (job) => {
    const { type } = job.data ?? {};
    logger.info({ type, jobId: job.id }, "scheduler tick");

    const [tenants] = await masterPool.query<any[]>(
      "SELECT tenant_id, db_name FROM tenants WHERE status='active'"
    );

    for (const tenant of tenants) {
      try {
        switch (type) {
          case "vacuna-reminders":
            await dispatchVacunaReminders(tenant);
            break;
          case "turno-reminders":
            await dispatchTurnoReminders(tenant);
            break;
          case "outbox-dispatch":
            await jobsQueue.add("outbox-dispatch", {
              tenantId: tenant.tenant_id,
              dbName: tenant.db_name,
            });
            break;
          case "audit-verify-chain":
            await jobsQueue.add("audit-verify-chain", {
              tenantId: tenant.tenant_id,
              dbName: tenant.db_name,
            });
            break;
          default:
            logger.warn({ type }, "unknown scheduler job type");
        }
      } catch (e) {
        logger.error({ err: e, tenantId: tenant.tenant_id, type }, "scheduler dispatch error");
      }
    }
  },
  {
    connection: redis,
    concurrency: 1, // solo 1 tick activo en el cluster
  }
);

async function dispatchVacunaReminders(tenant: { tenant_id: string; db_name: string }) {
  const pool = tenantPoolFactory(tenant.db_name);
  const [rows] = await pool.query<any[]>(
    `SELECT v.id as vacuna_id, v.paciente_id, pr.email as owner_email, pr.telefono
     FROM vacunas v
     JOIN pacientes p    ON p.id  = v.paciente_id
     LEFT JOIN propietarios pr ON pr.id = p.propietario_id
     WHERE v.tenant_id=? AND v.recordatorio_env=0 AND v.is_active=1
       AND v.proxima_dosis BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)
       AND pr.email IS NOT NULL`,
    [tenant.tenant_id]
  );

  for (const row of rows) {
    await jobsQueue.add("vacuna-reminder", {
      tenantId: tenant.tenant_id,
      dbName: tenant.db_name,
      pacienteId: row.paciente_id,
      vacunaId: row.vacuna_id,
      ownerEmail: row.owner_email,
    }, { attempts: 3, backoff: { type: "exponential", delay: 60_000 } });
  }
  logger.info({ tenantId: tenant.tenant_id, count: rows.length }, "vacuna reminders dispatched");
}

async function dispatchTurnoReminders(tenant: { tenant_id: string; db_name: string }) {
  const pool = tenantPoolFactory(tenant.db_name);
  const [rows] = await pool.query<any[]>(
    `SELECT t.id as turno_id, pr.email as owner_email, pr.telefono
     FROM turnos t
     LEFT JOIN propietarios pr ON pr.id = t.propietario_id
     WHERE t.tenant_id=? AND t.recordatorio_env=0
       AND DATE(t.fecha_hora) = DATE_ADD(CURDATE(), INTERVAL 1 DAY)
       AND t.estado IN ('pendiente','confirmado')
       AND pr.email IS NOT NULL`,
    [tenant.tenant_id]
  );

  for (const row of rows) {
    await jobsQueue.add("turno-reminder", {
      tenantId: tenant.tenant_id,
      dbName: tenant.db_name,
      turnoId: row.turno_id,
      ownerEmail: row.owner_email,
    }, { attempts: 3, backoff: { type: "exponential", delay: 60_000 } });
  }
  logger.info({ tenantId: tenant.tenant_id, count: rows.length }, "turno reminders dispatched");
}

worker.on("completed", (job) => logger.info({ jobId: job.id, type: job.data?.type }, "scheduler job done"));
worker.on("failed", (job, err) => logger.error({ jobId: job?.id, err }, "scheduler job failed"));

process.on("SIGTERM", async () => {
  logger.info("scheduler worker shutting down");
  await worker.close();
  await redis.quit();
  process.exit(0);
});

logger.info("Scheduler worker started");
