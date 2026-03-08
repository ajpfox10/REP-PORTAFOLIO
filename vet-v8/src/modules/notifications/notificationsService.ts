/**
 * notificationsService — v11  (Punto 5)
 *
 * Sistema de recordatorios automáticos usando BullMQ:
 *   - Vacunas vencidas o próximas a vencer (diario)
 *   - Turnos del día siguiente (noche anterior)
 *   - Envío por WhatsApp (infra existente) y email (simulado)
 *
 * Los jobs se registran en el scheduler existente.
 * Cada job procesa todos los tenants activos de forma paralela (con límite).
 */

import type { Pool } from "mysql2/promise";
import type { Queue } from "bullmq";
import { logger } from "../../core/logging/logger.js";

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type NotifChannel = "whatsapp" | "email" | "both";

export type NotifJob =
  | { type: "vacuna_vencida";   tenantId: string; pacienteId: number; propietarioEmail: string; propietarioTel: string; pacienteNombre: string; vacunaNombre: string; fechaVencimiento: string }
  | { type: "turno_recordatorio"; tenantId: string; turnoId: number; propietarioEmail: string; propietarioTel: string; pacienteNombre: string; fecha: string; veterinario: string }
  | { type: "desparasitacion_vencida"; tenantId: string; pacienteId: number; propietarioEmail: string; propietarioTel: string; pacienteNombre: string; producto: string; fechaProxima: string };

// ── Nombre de colas ───────────────────────────────────────────────────────────

export const NOTIF_QUEUE = "vetpro:notifications";

// ── Job: vacunas próximas a vencer ────────────────────────────────────────────

/**
 * Busca vacunas con proxima_dosis en los próximos 7 días y encola recordatorios.
 * Ejecutar: diariamente a las 8:00 AM
 */
export async function enqueueVacunaReminders(masterPool: Pool, queue: Queue): Promise<number> {
  let count = 0;
  try {
    // Obtener todos los tenant DBs activos
    const [tenants] = await masterPool.query<any[]>(
      "SELECT id, db_name FROM tenants WHERE is_active=1 LIMIT 500"
    );

    for (const tenant of tenants) {
      try {
        // Re-usar el pool del tenant (en arquitectura real se usaría tenantPoolFactory)
        const [vacunas] = await masterPool.query<any[]>(
          `SELECT v.id, v.paciente_id, v.nombre_vacuna, v.proxima_dosis,
                  p.nombre AS paciente_nombre,
                  prop.email AS propietario_email, prop.telefono AS propietario_tel
           FROM ${tenant.db_name}.vacunas v
           JOIN ${tenant.db_name}.pacientes p ON p.id = v.paciente_id
           LEFT JOIN ${tenant.db_name}.propietarios prop ON prop.id = p.propietario_id
           WHERE v.proxima_dosis BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)
             AND v.recordatorio_env = 0
           LIMIT 200`
        );

        for (const v of vacunas) {
          if (!v.propietario_email && !v.propietario_tel) continue;
          const job: NotifJob = {
            type: "vacuna_vencida",
            tenantId: tenant.id,
            pacienteId: v.paciente_id,
            propietarioEmail: v.propietario_email ?? "",
            propietarioTel:   v.propietario_tel ?? "",
            pacienteNombre:   v.paciente_nombre,
            vacunaNombre:     v.nombre_vacuna,
            fechaVencimiento: v.proxima_dosis,
          };
          await queue.add("vacuna-reminder", job, {
            attempts: 3,
            backoff: { type: "exponential", delay: 5000 },
          });
          count++;
        }
      } catch (err) {
        logger.error({ tenant: tenant.id, err }, "[notifications] Error procesando vacunas de tenant");
      }
    }
  } catch (err) {
    logger.error({ err }, "[notifications] Error en enqueueVacunaReminders");
  }
  logger.info({ count }, "[notifications] Vacuna reminders enqueued");
  return count;
}

// ── Job: turnos del día siguiente ─────────────────────────────────────────────

/**
 * Encola recordatorios de turnos del día siguiente.
 * Ejecutar: diariamente a las 19:00
 */
export async function enqueueTurnoReminders(masterPool: Pool, queue: Queue): Promise<number> {
  let count = 0;
  try {
    const [tenants] = await masterPool.query<any[]>(
      "SELECT id, db_name FROM tenants WHERE is_active=1 LIMIT 500"
    );

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStart = new Date(tomorrow); tomorrowStart.setHours(0,0,0,0);
    const tomorrowEnd   = new Date(tomorrow); tomorrowEnd.setHours(23,59,59,999);

    for (const tenant of tenants) {
      try {
        const [turnos] = await masterPool.query<any[]>(
          `SELECT t.id, t.fecha_hora, t.duracion_min,
                  p.nombre AS paciente_nombre,
                  prop.email AS propietario_email, prop.telefono AS propietario_tel,
                  CONCAT(v.nombre,' ',v.apellido) AS veterinario_nombre
           FROM ${tenant.db_name}.turnos t
           LEFT JOIN ${tenant.db_name}.pacientes p ON p.id=t.paciente_id
           LEFT JOIN ${tenant.db_name}.propietarios prop ON prop.id=t.propietario_id
           LEFT JOIN ${tenant.db_name}.veterinarios v ON v.id=t.veterinario_id
           WHERE t.fecha_hora BETWEEN ? AND ?
             AND t.estado IN ('pendiente','confirmado')
             AND t.recordatorio_env = 0
           LIMIT 500`,
          [tomorrowStart.toISOString(), tomorrowEnd.toISOString()]
        );

        for (const t of turnos) {
          if (!t.propietario_email && !t.propietario_tel) continue;
          const job: NotifJob = {
            type: "turno_recordatorio",
            tenantId: tenant.id,
            turnoId: t.id,
            propietarioEmail: t.propietario_email ?? "",
            propietarioTel:   t.propietario_tel ?? "",
            pacienteNombre:   t.paciente_nombre ?? "su mascota",
            fecha:            new Date(t.fecha_hora).toLocaleString("es-AR"),
            veterinario:      t.veterinario_nombre ?? "el veterinario",
          };
          await queue.add("turno-reminder", job, {
            attempts: 3,
            backoff: { type: "exponential", delay: 5000 },
          });
          count++;
        }
      } catch (err) {
        logger.error({ tenant: tenant.id, err }, "[notifications] Error procesando turnos de tenant");
      }
    }
  } catch (err) {
    logger.error({ err }, "[notifications] Error en enqueueTurnoReminders");
  }
  logger.info({ count }, "[notifications] Turno reminders enqueued");
  return count;
}

// ── Worker processor ──────────────────────────────────────────────────────────

/**
 * Procesa un job de notificación.
 * En producción: integrar con WhatsApp API (buildWhatsAppRouter existe)
 * y con proveedor de email (SendGrid, Resend, etc.).
 */
export async function processNotifJob(job: NotifJob, _config: any): Promise<void> {
  switch (job.type) {
    case "vacuna_vencida": {
      const msg = `🐾 Recordatorio VetPro: La vacuna *${job.vacunaNombre}* de *${job.pacienteNombre}* vence el ${job.fechaVencimiento}. ¡No olvides renovarla!`;
      await sendNotification(job.propietarioTel, job.propietarioEmail, msg, _config);
      break;
    }
    case "turno_recordatorio": {
      const msg = `📅 Recordatorio VetPro: Mañana tenés turno para *${job.pacienteNombre}* con ${job.veterinario} a las ${job.fecha}. ¡Te esperamos!`;
      await sendNotification(job.propietarioTel, job.propietarioEmail, msg, _config);
      break;
    }
    case "desparasitacion_vencida": {
      const msg = `💊 Recordatorio VetPro: Es momento de la desparasitación de *${job.pacienteNombre}* (${job.producto}). Fecha sugerida: ${job.fechaProxima}.`;
      await sendNotification(job.propietarioTel, job.propietarioEmail, msg, _config);
      break;
    }
  }
}

async function sendNotification(tel: string, email: string, message: string, config: any): Promise<void> {
  // WhatsApp: si hay teléfono y config de WhatsApp
  if (tel && config?.whatsappApiUrl) {
    try {
      await fetch(config.whatsappApiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${config.whatsappToken}` },
        body: JSON.stringify({ to: tel, type: "text", text: { body: message } }),
      });
    } catch (err) {
      logger.warn({ tel, err }, "[notifications] WhatsApp send failed");
    }
  }

  // Email: si hay email (integrar con proveedor)
  if (email) {
    logger.info({ email, preview: message.slice(0, 60) }, "[notifications] Email queued (implement provider)");
    // await emailProvider.send({ to: email, subject: "Recordatorio VetPro", text: message });
  }
}

// ── Router HTTP para disparar manualmente (admin) ─────────────────────────────

import { Router } from "express";
import { getCtx, requireRole, ok } from "../../core/context.js";

export function buildNotificationsRouter(deps: { masterPool: Pool; queue: Queue; config: any }): Router {
  const r = Router();

  r.post("/vacunas/trigger", async (req: any, res: any, next: any) => {
    try {
      const ctx = getCtx(req);
      requireRole(ctx, "admin");
      const count = await enqueueVacunaReminders(deps.masterPool, deps.queue);
      res.json(ok({ enqueued: count, type: "vacuna_vencida" }));
    } catch (e) { next(e); }
  });

  r.post("/turnos/trigger", async (req: any, res: any, next: any) => {
    try {
      const ctx = getCtx(req);
      requireRole(ctx, "admin");
      const count = await enqueueTurnoReminders(deps.masterPool, deps.queue);
      res.json(ok({ enqueued: count, type: "turno_recordatorio" }));
    } catch (e) { next(e); }
  });

  return r;
}
