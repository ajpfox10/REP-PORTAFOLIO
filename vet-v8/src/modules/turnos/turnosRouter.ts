import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../core/errors/appError.js";
import { getCtx, getRequestId, ok } from "../../core/http/requestCtx.js";
import { appendAudit } from "../../audit/auditRepo.js";
import { invalidateDashboardCache } from "../dashboard/dashboardCache.js";
import type Redis from "ioredis";

const TurnoIn = z.object({
  veterinario_id: z.coerce.number().int().positive(),
  paciente_id: z.coerce.number().int().positive().optional().nullable(),
  propietario_id: z.coerce.number().int().positive().optional().nullable(),
  sucursal_id: z.coerce.number().int().positive().optional().nullable(),
  fecha_hora: z.string().min(16),
  duracion_min: z.coerce.number().int().min(5).max(480).default(30),
  motivo: z.string().min(1).max(255).optional().nullable(),
  notas: z.string().max(2000).optional().nullable(),
});

const TurnoEstadoIn = z.object({
  estado: z.enum(["pendiente", "confirmado", "cancelado", "completado", "no_show"]),
  notas: z.string().max(500).optional().nullable(),
});

// Máquina de estados exportada para reuso en tests

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function fromMinutes(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

export const TURNO_TRANSITIONS: Record<string, string[]> = {
  pendiente:   ["confirmado", "cancelado"],
  confirmado:  ["completado", "cancelado", "no_show"],
  cancelado:   [],
  completado:  [],
  no_show:     [],
};

export function buildTurnosRouter(opts: { redis?: Redis } = {}) {
  const router = Router();


  /**
   * GET /api/v1/turnos/slots?veterinario_id=&fecha=YYYY-MM-DD
   *
   * Devuelve los slots disponibles para reservar turno en una fecha concreta.
   * Considera reglas de agenda y turnos ya tomados.
   * Usado por el frontend y por el portal del propietario.
   */
  router.get("/slots", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      const rid = getRequestId(req);

      const vetId = req.query.veterinario_id ? Number(req.query.veterinario_id) : null;
      const fecha = req.query.fecha ? String(req.query.fecha) : null;

      if (!vetId || !fecha) {
        throw new AppError("VALIDATION_ERROR", "veterinario_id y fecha son obligatorios");
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
        throw new AppError("VALIDATION_ERROR", "fecha debe ser YYYY-MM-DD");
      }

      const dow = new Date(fecha + "T12:00:00").getDay(); // 0=Dom..6=Sab

      // Reglas de horario
      const [rules] = await ctx.tenantPool.query<any[]>(
        `SELECT hora_inicio, hora_fin, duracion_slot_min
         FROM agenda_rules
         WHERE tenant_id=? AND veterinario_id=? AND dia_semana=? AND is_active=1`,
        [ctx.tenantId, vetId, dow]
      );

      if (!rules?.length) {
        return res.json(ok({ fecha, veterinario_id: vetId, slots: [], message: "Sin agenda para este día" }, rid));
      }

      // Feriados
      const [holidays] = await ctx.tenantPool.query<any[]>(
        `SELECT id FROM agenda_holidays
         WHERE tenant_id=? AND fecha=? AND (veterinario_id=? OR veterinario_id IS NULL)
         LIMIT 1`,
        [ctx.tenantId, fecha, vetId]
      );
      if (holidays?.length) {
        return res.json(ok({ fecha, veterinario_id: vetId, slots: [], message: "Día bloqueado" }, rid));
      }

      // Turnos ya tomados ese día
      const [booked] = await ctx.tenantPool.query<any[]>(
        `SELECT fecha_hora, duracion_min FROM turnos
         WHERE tenant_id=? AND veterinario_id=? AND DATE(fecha_hora)=?
           AND estado NOT IN ('cancelado','no_show')`,
        [ctx.tenantId, vetId, fecha]
      );

      // Construir set de minutos ocupados
      const occupiedMinutes = new Set<number>();
      for (const t of booked) {
        const start = new Date(t.fecha_hora);
        const startMin = start.getHours() * 60 + start.getMinutes();
        const dur = Number(t.duracion_min ?? 30);
        for (let i = 0; i < dur; i++) occupiedMinutes.add(startMin + i);
      }

      // Generar slots
      const slots: { hora: string; disponible: boolean }[] = [];
      for (const rule of rules) {
        const startMin = toMinutes(String(rule.hora_inicio).slice(0, 5));
        const endMin   = toMinutes(String(rule.hora_fin).slice(0, 5));
        const slotDur  = Number(rule.duracion_slot_min ?? 30);

        for (let m = startMin; m + slotDur <= endMin; m += slotDur) {
          // El slot está libre si ningún minuto dentro de él está ocupado
          let libre = true;
          for (let i = 0; i < slotDur; i++) {
            if (occupiedMinutes.has(m + i)) { libre = false; break; }
          }
          slots.push({ hora: fromMinutes(m), disponible: libre });
        }
      }

      res.json(ok({ fecha, veterinario_id: vetId, slots }, rid));
    } catch (e) { next(e); }
  });

  // FIX: rutas estáticas PRIMERO, antes de /:id
  /** GET /api/v1/turnos/hoy/agenda — vista rápida del día */
  router.get("/hoy/agenda", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      const sucursalId = req.query.sucursal_id ? Number(req.query.sucursal_id) : null;
      const vetId = req.query.veterinario_id ? Number(req.query.veterinario_id) : null;

      // ABAC: vets solo ven los suyos
      const vetFilter = (ctx.roles?.includes("vet") && ctx.veterinarioId && !ctx.roles.includes("admin"))
        ? ctx.veterinarioId
        : vetId;

      const conditions = [
        "t.tenant_id=?",
        "DATE(t.fecha_hora)=CURDATE()",
        "t.estado NOT IN ('cancelado')",
      ];
      const params: any[] = [ctx.tenantId];

      if (sucursalId) { conditions.push("t.sucursal_id=?"); params.push(sucursalId); }
      if (vetFilter)  { conditions.push("t.veterinario_id=?"); params.push(vetFilter); }

      const [rows] = await ctx.tenantPool.query<any[]>(
        `SELECT t.id, t.fecha_hora, t.duracion_min, t.motivo, t.estado,
                v.nombre as vet_nombre, v.apellido as vet_apellido, v.color_agenda,
                p.nombre as paciente_nombre, p.especie,
                pr.nombre as propietario_nombre, pr.telefono as propietario_telefono
         FROM turnos t
         LEFT JOIN veterinarios v  ON v.id  = t.veterinario_id
         LEFT JOIN pacientes p     ON p.id  = t.paciente_id
         LEFT JOIN propietarios pr ON pr.id = t.propietario_id
         WHERE ${conditions.join(" AND ")}
         ORDER BY t.fecha_hora ASC`,
        params
      );
      res.json({ data: rows, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  /** GET /api/v1/turnos?fecha_desde=&fecha_hasta=&veterinario_id=&estado= */
  router.get("/", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      const { fecha_desde, fecha_hasta, veterinario_id, estado, paciente_id } = req.query;
      const page  = Math.max(Number(req.query.page  ?? 1), 1);
      const limit = Math.min(Number(req.query.limit ?? 50), 200);
      const offset = (page - 1) * limit;

      // FIX: condiciones separadas de los params de paginación para el count
      const filterConditions: string[] = ["t.tenant_id=?"];
      const filterParams: any[] = [ctx.tenantId];

      if (fecha_desde)    { filterConditions.push("t.fecha_hora >= ?"); filterParams.push(String(fecha_desde)); }
      if (fecha_hasta)    { filterConditions.push("t.fecha_hora <= ?"); filterParams.push(String(fecha_hasta)); }
      if (veterinario_id) { filterConditions.push("t.veterinario_id=?"); filterParams.push(Number(veterinario_id)); }
      if (estado)         { filterConditions.push("t.estado=?"); filterParams.push(String(estado)); }
      if (paciente_id)    { filterConditions.push("t.paciente_id=?"); filterParams.push(Number(paciente_id)); }

      if (ctx.roles?.includes("vet") && ctx.veterinarioId && !ctx.roles.includes("admin")) {
        filterConditions.push("t.veterinario_id=?");
        filterParams.push(ctx.veterinarioId);
      }

      const whereClause = filterConditions.join(" AND ");

      // FIX: count usa filterConditions/filterParams sin tocar los de paginación
      const [[countRow]] = await ctx.tenantPool.query<any[]>(
        `SELECT COUNT(*) as total FROM turnos t WHERE ${whereClause}`,
        filterParams
      );

      const [rows] = await ctx.tenantPool.query<any[]>(
        `SELECT t.id, t.fecha_hora, t.duracion_min, t.motivo, t.estado, t.notas,
                t.recordatorio_env, t.created_at,
                v.nombre  as vet_nombre,   v.apellido as vet_apellido, v.color_agenda,
                p.nombre  as paciente_nombre, p.especie, p.raza,
                pr.nombre as propietario_nombre, pr.apellido as propietario_apellido,
                pr.telefono as propietario_telefono, pr.email as propietario_email,
                s.nombre  as sucursal_nombre
         FROM turnos t
         LEFT JOIN veterinarios v  ON v.id  = t.veterinario_id
         LEFT JOIN pacientes p     ON p.id  = t.paciente_id
         LEFT JOIN propietarios pr ON pr.id = t.propietario_id
         LEFT JOIN sucursales s    ON s.id  = t.sucursal_id
         WHERE ${whereClause}
         ORDER BY t.fecha_hora ASC LIMIT ? OFFSET ?`,
        [...filterParams, limit, offset]
      );

      res.json({
        data: rows,
        meta: { requestId: (req as any).id, page, limit, total: Number(countRow?.total ?? 0) },
        errors: [],
      });
    } catch (e) { next(e); }
  });

  /** GET /api/v1/turnos/:id */
  router.get("/:id", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) throw new AppError("VALIDATION_ERROR", "id inválido");

      const [rows] = await ctx.tenantPool.query<any[]>(
        `SELECT t.*,
                v.nombre  as vet_nombre,   v.apellido as vet_apellido,
                p.nombre  as paciente_nombre, p.especie,
                pr.nombre as propietario_nombre, pr.apellido as propietario_apellido,
                pr.telefono as propietario_telefono
         FROM turnos t
         LEFT JOIN veterinarios v  ON v.id  = t.veterinario_id
         LEFT JOIN pacientes p     ON p.id  = t.paciente_id
         LEFT JOIN propietarios pr ON pr.id = t.propietario_id
         WHERE t.id=? AND t.tenant_id=? LIMIT 1`,
        [id, ctx.tenantId]
      );
      if (!rows?.length) throw new AppError("NOT_FOUND", "Turno no encontrado");
      res.json({ data: rows[0], meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  /** POST /api/v1/turnos */
  router.post("/", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      const roles = ctx.roles ?? [];
      if (!roles.includes("admin") && !roles.includes("receptionist") && !roles.includes("vet") && !roles.includes("staff")) {
        throw new AppError("FORBIDDEN", "Rol insuficiente");
      }

      const body = TurnoIn.parse(req.body ?? {});
      const endTime = new Date(new Date(body.fecha_hora).getTime() + body.duracion_min * 60_000)
        .toISOString().slice(0, 19).replace("T", " ");

      const [conflicts] = await ctx.tenantPool.query<any[]>(
        `SELECT id FROM turnos
         WHERE tenant_id=? AND veterinario_id=?
           AND estado NOT IN ('cancelado','no_show')
           AND fecha_hora < ? AND DATE_ADD(fecha_hora, INTERVAL duracion_min MINUTE) > ?
         LIMIT 1`,
        [ctx.tenantId, body.veterinario_id, endTime, body.fecha_hora]
      );
      if (conflicts?.length) throw new AppError("CONFLICT", "El veterinario ya tiene un turno en ese horario");

      const [result] = await ctx.tenantPool.query<any>(
        `INSERT INTO turnos (tenant_id, veterinario_id, paciente_id, propietario_id, sucursal_id,
                              fecha_hora, duracion_min, motivo, notas, estado)
         VALUES (?,?,?,?,?,?,?,?,?,'pendiente')`,
        [ctx.tenantId, body.veterinario_id, body.paciente_id ?? null, body.propietario_id ?? null,
         body.sucursal_id ?? null, body.fecha_hora, body.duracion_min, body.motivo ?? null, body.notas ?? null]
      );
      const id = Number(result.insertId);

      await appendAudit(ctx.tenantPool, {
        tenant_id: ctx.tenantId, actor_user_id: ctx.userId,
        action: "create", resource: "turnos", resource_id: String(id),
        after_json: body, ip: req.ip,
        user_agent: String(req.headers["user-agent"] ?? ""), request_id: (req as any).id,
      });
      res.status(201).json({ data: { id }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  /** PATCH /api/v1/turnos/:id */
  router.patch("/:id", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      const id = Number(req.params.id);
      const body = TurnoIn.partial().parse(req.body ?? {});

      const [rows] = await ctx.tenantPool.query<any[]>(
        "SELECT * FROM turnos WHERE id=? AND tenant_id=? LIMIT 1", [id, ctx.tenantId]
      );
      if (!rows?.length) throw new AppError("NOT_FOUND", "Turno no encontrado");
      if (rows[0].estado === "cancelado") throw new AppError("CONFLICT", "No se puede modificar un turno cancelado");

      const allowed = ["veterinario_id","paciente_id","propietario_id","sucursal_id","fecha_hora","duracion_min","motivo","notas"];
      const fields: string[] = [];
      const values: any[] = [];
      for (const [k, v] of Object.entries(body)) {
        if (allowed.includes(k) && v !== undefined) { fields.push(`${k}=?`); values.push(v); }
      }
      if (!fields.length) throw new AppError("VALIDATION_ERROR", "Nada para actualizar");
      fields.push("updated_at=NOW()");
      values.push(id, ctx.tenantId);

      await ctx.tenantPool.query(`UPDATE turnos SET ${fields.join(",")} WHERE id=? AND tenant_id=?`, values);
      await appendAudit(ctx.tenantPool, {
        tenant_id: ctx.tenantId, actor_user_id: ctx.userId,
        action: "update", resource: "turnos", resource_id: String(id),
        before_json: rows[0], after_json: body,
        ip: req.ip, user_agent: String(req.headers["user-agent"] ?? ""), request_id: (req as any).id,
      });
      res.json({ data: { ok: true }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  /** PATCH /api/v1/turnos/:id/estado */
  router.patch("/:id/estado", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      const id = Number(req.params.id);
      const { estado, notas } = TurnoEstadoIn.parse(req.body ?? {});

      const [rows] = await ctx.tenantPool.query<any[]>(
        "SELECT estado FROM turnos WHERE id=? AND tenant_id=? LIMIT 1", [id, ctx.tenantId]
      );
      if (!rows?.length) throw new AppError("NOT_FOUND", "Turno no encontrado");

      const from = rows[0].estado as string;
      if (!TURNO_TRANSITIONS[from]?.includes(estado)) {
        throw new AppError("CONFLICT", `No se puede cambiar de "${from}" a "${estado}"`);
      }

      await ctx.tenantPool.query(
        "UPDATE turnos SET estado=?, notas=COALESCE(?,notas), updated_at=NOW() WHERE id=? AND tenant_id=?",
        [estado, notas ?? null, id, ctx.tenantId]
      );
      await appendAudit(ctx.tenantPool, {
        tenant_id: ctx.tenantId, actor_user_id: ctx.userId,
        action: `turno_${estado}`, resource: "turnos", resource_id: String(id),
        before_json: { estado: from }, after_json: { estado, notas },
        ip: req.ip, user_agent: String(req.headers["user-agent"] ?? ""), request_id: (req as any).id,
      });
      res.json({ data: { ok: true, estado }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  /** DELETE /api/v1/turnos/:id — soft cancel */
  router.delete("/:id", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      if (!ctx.roles?.includes("admin") && !ctx.roles?.includes("receptionist")) {
        throw new AppError("FORBIDDEN", "Rol insuficiente");
      }
      const id = Number(req.params.id);
      await ctx.tenantPool.query(
        "UPDATE turnos SET estado='cancelado', updated_at=NOW() WHERE id=? AND tenant_id=?",
        [id, ctx.tenantId]
      );
      await appendAudit(ctx.tenantPool, {
        tenant_id: ctx.tenantId, actor_user_id: ctx.userId,
        action: "cancel", resource: "turnos", resource_id: String(id),
        ip: req.ip, user_agent: String(req.headers["user-agent"] ?? ""), request_id: (req as any).id,
      });
      res.json({ data: { ok: true }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  return router;
}
