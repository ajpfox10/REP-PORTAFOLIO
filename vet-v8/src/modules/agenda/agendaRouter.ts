/**
 * agendaRouter — v11  (Punto 4)
 *
 * Vista de agenda semanal/mensual, detección de conflictos de horario,
 * reglas de disponibilidad por veterinario y recordatorios pendientes.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { getCtx, requireRole, ok } from "../../core/context.js";
import { AppError } from "../../core/errors/appError.js";

export function buildAgendaRouter(): Router {
  const r = Router();

  // ── GET /semanal — vista de agenda de la semana ─────────────────────────
  r.get("/semanal", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getCtx(req);
      const { fecha, veterinario_id, sucursal_id } = req.query;

      const base = fecha ? new Date(String(fecha)) : new Date();
      if (isNaN(base.getTime())) throw new AppError("VALIDATION_ERROR", "fecha inválida");

      // Inicio del lunes de la semana
      const day = base.getDay();
      const mondayOffset = day === 0 ? -6 : 1 - day;
      const monday = new Date(base);
      monday.setDate(base.getDate() + mondayOffset);
      monday.setHours(0, 0, 0, 0);

      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      sunday.setHours(23, 59, 59, 999);

      const conditions: string[] = ["t.tenant_id=?", "t.fecha_hora BETWEEN ? AND ?"];
      const params: any[] = [ctx.tenantId, monday.toISOString(), sunday.toISOString()];

      if (veterinario_id) { conditions.push("t.veterinario_id=?"); params.push(veterinario_id); }
      if (sucursal_id)    { conditions.push("t.sucursal_id=?");    params.push(sucursal_id); }
      else if (ctx.sucursalId) { conditions.push("t.sucursal_id=?"); params.push(ctx.sucursalId); }

      const [turnos] = await ctx.tenantPool.query<any[]>(
        `SELECT
           t.id, t.fecha_hora, t.duracion_min, t.motivo, t.estado, t.notas,
           CONCAT(v.nombre,' ',v.apellido) AS veterinario_nombre, v.color_agenda,
           p.nombre AS paciente_nombre, p.especie,
           CONCAT(prop.nombre,' ',prop.apellido) AS propietario_nombre,
           prop.telefono AS propietario_telefono
         FROM turnos t
         LEFT JOIN veterinarios v ON v.id=t.veterinario_id
         LEFT JOIN pacientes p ON p.id=t.paciente_id
         LEFT JOIN propietarios prop ON prop.id=t.propietario_id
         WHERE ${conditions.join(" AND ")}
         ORDER BY t.fecha_hora ASC`,
        params
      );

      // Agrupar por día
      const byDay: Record<string, any[]> = {};
      for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        byDay[d.toISOString().slice(0, 10)] = [];
      }
      for (const t of turnos) {
        const key = new Date(t.fecha_hora).toISOString().slice(0, 10);
        if (byDay[key]) byDay[key].push(t);
      }

      res.json(ok({ semana_inicio: monday.toISOString().slice(0, 10), dias: byDay, total: turnos.length }));
    } catch (e) { next(e); }
  });

  // ── GET /mensual — vista mensual por veterinario ─────────────────────────
  r.get("/mensual", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getCtx(req);
      const { anio, mes, veterinario_id } = req.query;

      const year  = parseInt(String(anio ?? new Date().getFullYear()));
      const month = parseInt(String(mes  ?? new Date().getMonth() + 1));
      if (month < 1 || month > 12) throw new AppError("VALIDATION_ERROR", "mes debe ser 1-12");

      const inicio = new Date(year, month - 1, 1);
      const fin    = new Date(year, month, 0, 23, 59, 59);

      const conditions = ["t.tenant_id=?", "t.fecha_hora BETWEEN ? AND ?", "t.estado != 'cancelado'"];
      const params: any[] = [ctx.tenantId, inicio.toISOString(), fin.toISOString()];
      if (veterinario_id) { conditions.push("t.veterinario_id=?"); params.push(veterinario_id); }

      const [turnos] = await ctx.tenantPool.query<any[]>(
        `SELECT
           t.id, DATE(t.fecha_hora) AS fecha, t.fecha_hora, t.duracion_min,
           t.motivo, t.estado,
           CONCAT(v.nombre,' ',v.apellido) AS veterinario_nombre, v.color_agenda,
           p.nombre AS paciente_nombre, p.especie
         FROM turnos t
         LEFT JOIN veterinarios v ON v.id=t.veterinario_id
         LEFT JOIN pacientes p ON p.id=t.paciente_id
         WHERE ${conditions.join(" AND ")}
         ORDER BY t.fecha_hora ASC`,
        params
      );

      // Conteo por estado por día
      const resumen: Record<string, { total: number; pendiente: number; confirmado: number; completado: number }> = {};
      for (const t of turnos) {
        const key = String(t.fecha).slice(0, 10);
        if (!resumen[key]) resumen[key] = { total: 0, pendiente: 0, confirmado: 0, completado: 0 };
        resumen[key].total++;
        if (t.estado in resumen[key]) (resumen[key] as any)[t.estado]++;
      }

      res.json(ok({ anio: year, mes: month, turnos, resumen_por_dia: resumen, total: turnos.length }));
    } catch (e) { next(e); }
  });

  // ── GET /disponibilidad — slots libres para agendar ─────────────────────
  r.get("/disponibilidad", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getCtx(req);
      const { veterinario_id, fecha, duracion } = req.query;

      if (!veterinario_id) throw new AppError("VALIDATION_ERROR", "veterinario_id requerido");
      if (!fecha)          throw new AppError("VALIDATION_ERROR", "fecha requerida");

      const slotMin = parseInt(String(duracion ?? "30"));
      const fechaDate = new Date(String(fecha));
      if (isNaN(fechaDate.getTime())) throw new AppError("VALIDATION_ERROR", "fecha inválida");

      const dayStart = new Date(fechaDate); dayStart.setHours(0,0,0,0);
      const dayEnd   = new Date(fechaDate); dayEnd.setHours(23,59,59,999);

      // Reglas de agenda del veterinario
      const [reglas] = await ctx.tenantPool.query<any[]>(
        `SELECT hora_inicio, hora_fin, dia_semana
         FROM agenda_reglas
         WHERE veterinario_id=? AND tenant_id=? AND activo=1`,
        [veterinario_id, ctx.tenantId]
      );

      // Turnos ya agendados ese día
      const [ocupados] = await ctx.tenantPool.query<any[]>(
        `SELECT fecha_hora, duracion_min FROM turnos
         WHERE veterinario_id=? AND tenant_id=?
           AND fecha_hora BETWEEN ? AND ?
           AND estado NOT IN ('cancelado')`,
        [veterinario_id, ctx.tenantId, dayStart.toISOString(), dayEnd.toISOString()]
      );

      // Día de la semana (0=domingo, 1=lunes…)
      const diaSemana = fechaDate.getDay();
      const regla = reglas.find((r: any) => r.dia_semana === diaSemana);

      if (!regla) {
        return res.json(ok({ fecha: String(fecha), slots: [], mensaje: "Veterinario no atiende este día" }));
      }

      // Generar slots
      function toMins(hhmm: string) {
        const [h, m] = hhmm.split(":").map(Number);
        return h * 60 + m;
      }

      const inicio = toMins(regla.hora_inicio);
      const fin    = toMins(regla.hora_fin);

      // Turnos ocupados como rangos en minutos desde medianoche
      const ocupadosMin = ocupados.map((t: any) => {
        const d = new Date(t.fecha_hora);
        const s = d.getHours() * 60 + d.getMinutes();
        return { start: s, end: s + t.duracion_min };
      });

      const slots: string[] = [];
      for (let m = inicio; m + slotMin <= fin; m += slotMin) {
        const slotEnd = m + slotMin;
        const libre = !ocupadosMin.some(({ start, end }: any) => m < end && slotEnd > start);
        if (libre) {
          slots.push(`${String(Math.floor(m/60)).padStart(2,"0")}:${String(m%60).padStart(2,"0")}`);
        }
      }

      res.json(ok({ fecha: String(fecha), veterinario_id, duracion_min: slotMin, slots }));
    } catch (e) { next(e); }
  });

  // ── GET /conflictos — turnos superpuestos del día ───────────────────────
  r.get("/conflictos", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getCtx(req);
      requireRole(ctx, "admin", "staff");

      const fecha = req.query.fecha ? new Date(String(req.query.fecha)) : new Date();
      const dayStart = new Date(fecha); dayStart.setHours(0,0,0,0);
      const dayEnd   = new Date(fecha); dayEnd.setHours(23,59,59,999);

      const [turnos] = await ctx.tenantPool.query<any[]>(
        `SELECT t.id, t.veterinario_id, t.fecha_hora, t.duracion_min,
                CONCAT(v.nombre,' ',v.apellido) AS veterinario_nombre
         FROM turnos t
         LEFT JOIN veterinarios v ON v.id=t.veterinario_id
         WHERE t.tenant_id=? AND t.fecha_hora BETWEEN ? AND ?
           AND t.estado NOT IN ('cancelado')
         ORDER BY t.veterinario_id, t.fecha_hora`,
        [ctx.tenantId, dayStart.toISOString(), dayEnd.toISOString()]
      );

      const conflictos: any[] = [];
      for (let i = 0; i < turnos.length; i++) {
        for (let j = i + 1; j < turnos.length; j++) {
          const a = turnos[i], b = turnos[j];
          if (a.veterinario_id !== b.veterinario_id) continue;
          const aStart = new Date(a.fecha_hora).getTime();
          const aEnd   = aStart + a.duracion_min * 60_000;
          const bStart = new Date(b.fecha_hora).getTime();
          const bEnd   = bStart + b.duracion_min * 60_000;
          if (bStart < aEnd && bEnd > aStart) {
            conflictos.push({ turno_a: a.id, turno_b: b.id, veterinario: a.veterinario_nombre });
          }
        }
      }

      res.json(ok({ fecha: fecha.toISOString().slice(0, 10), conflictos, total: conflictos.length }));
    } catch (e) { next(e); }
  });

  return r;
}
