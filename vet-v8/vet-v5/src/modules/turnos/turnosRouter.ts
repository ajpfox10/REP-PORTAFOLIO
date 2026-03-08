import { Router } from "express";
import { z } from "zod";
import { nanoid } from "nanoid";
import { AppError } from "../../core/errors/appError.js";
import { appendAudit } from "../../audit/auditRepo.js";

const TurnoIn = z.object({
  veterinario_id: z.coerce.number().int().positive(),
  paciente_id: z.coerce.number().int().positive().optional().nullable(),
  propietario_id: z.coerce.number().int().positive().optional().nullable(),
  sucursal_id: z.coerce.number().int().positive().optional().nullable(),
  fecha_hora: z.string().min(16), // "YYYY-MM-DD HH:MM"
  duracion_min: z.coerce.number().int().min(5).max(480).default(30),
  motivo: z.string().min(1).max(255).optional().nullable(),
  notas: z.string().max(2000).optional().nullable(),
});

const TurnoEstadoIn = z.object({
  estado: z.enum(["pendiente", "confirmado", "cancelado", "completado", "no_show"]),
  notas: z.string().max(500).optional().nullable(),
});

export function buildTurnosRouter() {
  const router = Router();

  /** GET /api/v1/turnos?fecha_desde=&fecha_hasta=&veterinario_id=&estado= */
  router.get("/", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      const { fecha_desde, fecha_hasta, veterinario_id, estado, paciente_id } = req.query;
      const page = Math.max(Number(req.query.page ?? 1), 1);
      const limit = Math.min(Number(req.query.limit ?? 50), 200);
      const offset = (page - 1) * limit;

      const conditions: string[] = ["t.tenant_id=?"];
      const params: any[] = [ctx.tenantId];

      if (fecha_desde) { conditions.push("t.fecha_hora >= ?"); params.push(String(fecha_desde)); }
      if (fecha_hasta) { conditions.push("t.fecha_hora <= ?"); params.push(String(fecha_hasta)); }
      if (veterinario_id) { conditions.push("t.veterinario_id=?"); params.push(Number(veterinario_id)); }
      if (estado) { conditions.push("t.estado=?"); params.push(String(estado)); }
      if (paciente_id) { conditions.push("t.paciente_id=?"); params.push(Number(paciente_id)); }

      // ABAC: vets only see their own
      if (ctx.roles?.includes("vet") && ctx.veterinarioId && !ctx.roles.includes("admin")) {
        conditions.push("t.veterinario_id=?");
        params.push(ctx.veterinarioId);
      }

      params.push(limit, offset);

      const [rows] = await ctx.tenantPool.query<any[]>(
        `SELECT t.id, t.fecha_hora, t.duracion_min, t.motivo, t.estado, t.notas,
                t.recordatorio_env, t.created_at,
                v.nombre as vet_nombre, v.apellido as vet_apellido, v.color_agenda,
                p.nombre as paciente_nombre, p.especie, p.raza,
                pr.nombre as propietario_nombre, pr.apellido as propietario_apellido,
                pr.telefono as propietario_telefono, pr.email as propietario_email,
                s.nombre as sucursal_nombre
         FROM turnos t
         LEFT JOIN veterinarios v ON v.id = t.veterinario_id
         LEFT JOIN pacientes p ON p.id = t.paciente_id
         LEFT JOIN propietarios pr ON pr.id = t.propietario_id
         LEFT JOIN sucursales s ON s.id = t.sucursal_id
         WHERE ${conditions.join(" AND ")}
         ORDER BY t.fecha_hora ASC LIMIT ? OFFSET ?`,
        params
      );

      const [countRows] = await ctx.tenantPool.query<any[]>(
        `SELECT COUNT(*) as total FROM turnos t WHERE ${conditions.slice(0, -2).join(" AND ")}`,
        params.slice(0, -2)
      );

      res.json({
        data: rows,
        meta: { requestId: (req as any).id, page, limit, total: Number(countRows[0]?.total ?? 0) },
        errors: [],
      });
    } catch (e) { next(e); }
  });

  /** GET /api/v1/turnos/:id */
  router.get("/:id", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      const id = Number(req.params.id);
      const [rows] = await ctx.tenantPool.query<any[]>(
        `SELECT t.*, 
                v.nombre as vet_nombre, v.apellido as vet_apellido,
                p.nombre as paciente_nombre, p.especie,
                pr.nombre as propietario_nombre, pr.apellido as propietario_apellido, pr.telefono as propietario_telefono
         FROM turnos t
         LEFT JOIN veterinarios v ON v.id=t.veterinario_id
         LEFT JOIN pacientes p ON p.id=t.paciente_id
         LEFT JOIN propietarios pr ON pr.id=t.propietario_id
         WHERE t.id=? AND t.tenant_id=? LIMIT 1`,
        [id, ctx.tenantId]
      );
      if (!rows?.length) throw new AppError("NOT_FOUND", "Turno no encontrado");
      res.json({ data: rows[0], meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  /** POST /api/v1/turnos — book a new appointment */
  router.post("/", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      const roles = ctx.roles ?? [];
      if (!roles.includes("admin") && !roles.includes("receptionist") && !roles.includes("vet") && !roles.includes("staff")) {
        throw new AppError("FORBIDDEN", "Rol insuficiente");
      }

      const body = TurnoIn.parse(req.body ?? {});

      // Conflict check: vet already has a turno overlapping this slot
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
        after_json: body, ip: req.ip, user_agent: String(req.headers["user-agent"] ?? ""),
        request_id: (req as any).id,
      });

      res.status(201).json({ data: { id }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  /** PATCH /api/v1/turnos/:id — update details */
  router.patch("/:id", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
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
        before_json: rows[0], after_json: body, ip: req.ip,
        user_agent: String(req.headers["user-agent"] ?? ""), request_id: (req as any).id,
      });
      res.json({ data: { ok: true }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  /** PATCH /api/v1/turnos/:id/estado — change appointment status */
  router.patch("/:id/estado", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      const id = Number(req.params.id);
      const { estado, notas } = TurnoEstadoIn.parse(req.body ?? {});

      const [rows] = await ctx.tenantPool.query<any[]>(
        "SELECT estado FROM turnos WHERE id=? AND tenant_id=? LIMIT 1", [id, ctx.tenantId]
      );
      if (!rows?.length) throw new AppError("NOT_FOUND", "Turno no encontrado");

      // State machine validation
      const from = rows[0].estado as string;
      const validTransitions: Record<string, string[]> = {
        pendiente:   ["confirmado", "cancelado"],
        confirmado:  ["completado", "cancelado", "no_show"],
        cancelado:   [],
        completado:  [],
        no_show:     [],
      };
      if (!validTransitions[from]?.includes(estado)) {
        throw new AppError("CONFLICT", `No se puede cambiar estado de "${from}" a "${estado}"`);
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

  /** DELETE /api/v1/turnos/:id — admin soft cancel */
  router.delete("/:id", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
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

  /** GET /api/v1/turnos/today — quick view for today's agenda */
  router.get("/hoy/agenda", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      const [rows] = await ctx.tenantPool.query<any[]>(
        `SELECT t.id, t.fecha_hora, t.duracion_min, t.motivo, t.estado,
                v.nombre as vet_nombre, v.apellido as vet_apellido, v.color_agenda,
                p.nombre as paciente_nombre, p.especie,
                pr.nombre as propietario_nombre, pr.telefono as propietario_telefono
         FROM turnos t
         LEFT JOIN veterinarios v ON v.id = t.veterinario_id
         LEFT JOIN pacientes p ON p.id = t.paciente_id
         LEFT JOIN propietarios pr ON pr.id = t.propietario_id
         WHERE t.tenant_id=? AND DATE(t.fecha_hora)=CURDATE()
           AND t.estado NOT IN ('cancelado')
         ORDER BY t.fecha_hora ASC`,
        [ctx.tenantId]
      );
      res.json({ data: rows, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  return router;
}
