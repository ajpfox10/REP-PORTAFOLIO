/**
 * Availability Router — calcula slots libres para un veterinario.
 *
 * FIX: queries ahora usan el schema real de `provisioningService`:
 *   - agenda_rules: veterinario_id, dia_semana, hora_inicio, hora_fin, duracion_slot_min, is_active
 *   - agenda_holidays: veterinario_id, sucursal_id, fecha
 *   - turnos: veterinario_id, fecha_hora, duracion_min, estado
 */

import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../core/errors/appError.js";
import { getCtx, getRequestId, ok } from "../../core/http/requestCtx.js";

const Q = z.object({
  veterinario_id: z.coerce.number().int().positive(),
  fecha_desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fecha_hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function fromMinutes(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

// Días de la semana: 0=Dom, 1=Lun, ..., 6=Sab
function getDayOfWeek(dateStr: string): number {
  return new Date(dateStr + "T12:00:00").getDay();
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export function buildAvailabilityRouter() {
  const router = Router();

  /**
   * GET /api/v1/agenda/availability?veterinario_id=&fecha_desde=&fecha_hasta=
   *
   * Devuelve slots disponibles considerando:
   *  1. Reglas de horario (agenda_rules)
   *  2. Feriados/bloqueos (agenda_holidays)
   *  3. Turnos ya tomados (turnos)
   */
  router.get("/", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      const rid = getRequestId(req);

      const { veterinario_id, fecha_desde, fecha_hasta } = Q.parse(req.query);

      // Validar rango máximo (30 días)
      const diffDays = Math.round(
        (new Date(fecha_hasta + "T00:00:00").getTime() - new Date(fecha_desde + "T00:00:00").getTime())
        / 86_400_000
      );
      if (diffDays < 0) throw new AppError("VALIDATION_ERROR", "fecha_hasta debe ser >= fecha_desde");
      if (diffDays > 30) throw new AppError("VALIDATION_ERROR", "Rango máximo: 30 días");

      // 1. Reglas de horario del veterinario
      const [rules] = await ctx.tenantPool.query<any[]>(
        `SELECT dia_semana, hora_inicio, hora_fin, duracion_slot_min
         FROM agenda_rules
         WHERE tenant_id=? AND veterinario_id=? AND is_active=1`,
        [ctx.tenantId, veterinario_id]
      );

      if (!rules?.length) {
        return res.json(ok({ veterinario_id, fecha_desde, fecha_hasta, slots: [], message: "Sin reglas de agenda configuradas" }, rid));
      }

      // 2. Días bloqueados (feriados)
      const [holidays] = await ctx.tenantPool.query<any[]>(
        `SELECT fecha FROM agenda_holidays
         WHERE tenant_id=? AND fecha BETWEEN ? AND ?
           AND (veterinario_id=? OR veterinario_id IS NULL)`,
        [ctx.tenantId, fecha_desde, fecha_hasta, veterinario_id]
      );
      const holidaySet = new Set(holidays.map((h: any) => String(h.fecha).slice(0, 10)));

      // 3. Turnos ya tomados en el rango
      const [bookedTurnos] = await ctx.tenantPool.query<any[]>(
        `SELECT fecha_hora, duracion_min FROM turnos
         WHERE tenant_id=? AND veterinario_id=?
           AND DATE(fecha_hora) BETWEEN ? AND ?
           AND estado NOT IN ('cancelado','no_show')`,
        [ctx.tenantId, veterinario_id, fecha_desde, fecha_hasta]
      );

      // Construir set de slots ocupados: "YYYY-MM-DD HH:MM"
      const bookedSlots = new Set<string>();
      for (const t of bookedTurnos) {
        const start = new Date(t.fecha_hora);
        const dur = Number(t.duracion_min ?? 30);
        // Marcar cada slot de `duracion_slot` dentro del turno como ocupado
        for (let offset = 0; offset < dur; offset += 30) {
          const slotTime = new Date(start.getTime() + offset * 60_000);
          const dateStr  = slotTime.toISOString().slice(0, 10);
          const timeStr  = slotTime.toISOString().slice(11, 16);
          bookedSlots.add(`${dateStr} ${timeStr}`);
        }
      }

      // Generar slots disponibles por día
      const availability: Record<string, { hora: string; disponible: boolean }[]> = {};

      let currentDate = fecha_desde;
      while (currentDate <= fecha_hasta) {
        // Saltar días bloqueados
        if (holidaySet.has(currentDate)) {
          currentDate = addDays(currentDate, 1);
          continue;
        }

        const dow = getDayOfWeek(currentDate);
        const dayRules = rules.filter((r: any) => Number(r.dia_semana) === dow);

        if (dayRules.length > 0) {
          const daySlots: { hora: string; disponible: boolean }[] = [];

          for (const rule of dayRules) {
            const startMin = toMinutes(String(rule.hora_inicio).slice(0, 5));
            const endMin   = toMinutes(String(rule.hora_fin).slice(0, 5));
            const slotDur  = Number(rule.duracion_slot_min ?? 30);

            for (let m = startMin; m + slotDur <= endMin; m += slotDur) {
              const horaStr = fromMinutes(m);
              const key = `${currentDate} ${horaStr}`;
              daySlots.push({ hora: horaStr, disponible: !bookedSlots.has(key) });
            }
          }

          if (daySlots.length > 0) {
            availability[currentDate] = daySlots;
          }
        }

        currentDate = addDays(currentDate, 1);
      }

      res.json(ok({ veterinario_id, fecha_desde, fecha_hasta, availability }, rid));
    } catch (e) { next(e); }
  });

  return router;
}
