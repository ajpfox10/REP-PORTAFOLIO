import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../core/errors/appError.js";
import { appendAudit } from "../../audit/auditRepo.js";
import { getCtx, getRequestId, ok } from "../../core/http/requestCtx.js";

const VisitIn = z.object({
  paciente_id: z.coerce.number().int().positive(),
  veterinario_id: z.coerce.number().int().positive().optional().nullable(),
  turno_id: z.coerce.number().int().positive().optional().nullable(),
  fecha_hora: z.string().min(10),
  motivo: z.string().min(1).max(500),
  anamnesis: z.string().max(5000).optional().nullable(),
  examen_fisico: z.string().max(5000).optional().nullable(),
  diagnostico: z.string().max(5000).optional().nullable(),
  tratamiento: z.string().max(5000).optional().nullable(),
  temperatura: z.coerce.number().min(30).max(45).optional().nullable(),
  peso_kg: z.coerce.number().min(0).max(999).optional().nullable(),
  frecuencia_cardiaca: z.coerce.number().int().min(0).max(999).optional().nullable(),
  frecuencia_respiratoria: z.coerce.number().int().min(0).max(500).optional().nullable(),
  proxima_consulta: z.string().optional().nullable(),
});

const UPDATABLE = [
  "veterinario_id","turno_id","fecha_hora","motivo","anamnesis","examen_fisico",
  "diagnostico","tratamiento","temperatura","peso_kg","frecuencia_cardiaca",
  "frecuencia_respiratoria","proxima_consulta",
];

export function buildVisitsRouter() {
  const router = Router();

  /** GET /api/v1/clinical/visits?paciente_id=&page=&limit= */
  router.get("/", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      const rid = getRequestId(req);
      const page   = Math.max(Number(req.query.page ?? 1), 1);
      const limit  = Math.min(Number(req.query.limit ?? 50), 200);
      const offset = (page - 1) * limit;
      const pacienteId = req.query.paciente_id ? Number(req.query.paciente_id) : null;

      // FIX: siempre filtrar por tenant_id
      const conditions = ["c.tenant_id=?", "c.is_active=1"];
      const filterParams: any[] = [ctx.tenantId];
      if (pacienteId) { conditions.push("c.paciente_id=?"); filterParams.push(pacienteId); }

      // ABAC: vets solo ven sus propias consultas (a menos que sean admin)
      if (ctx.roles?.includes("vet") && ctx.veterinarioId && !ctx.roles.includes("admin")) {
        conditions.push("c.veterinario_id=?");
        filterParams.push(ctx.veterinarioId);
      }

      const whereClause = conditions.join(" AND ");

      // FIX: count separado de la paginación
      const [[countRow]] = await ctx.tenantPool.query<any[]>(
        `SELECT COUNT(*) as total FROM consultas c WHERE ${whereClause}`,
        filterParams
      );

      const [rows] = await ctx.tenantPool.query<any[]>(
        `SELECT c.id, c.paciente_id, c.veterinario_id, c.fecha, c.motivo, c.diagnostico,
                c.temperatura, c.peso_kg, c.frecuencia_cardiaca, c.proxima_consulta, c.created_at,
                p.nombre as paciente_nombre, p.especie,
                v.nombre as vet_nombre, v.apellido as vet_apellido
         FROM consultas c
         JOIN pacientes p    ON p.id = c.paciente_id
         LEFT JOIN veterinarios v ON v.id = c.veterinario_id
         WHERE ${whereClause}
         ORDER BY c.fecha DESC LIMIT ? OFFSET ?`,
        [...filterParams, limit, offset]
      );

      res.json(ok(rows, rid, { page, limit, total: Number(countRow?.total ?? 0) }));
    } catch (e) { next(e); }
  });

  /** GET /api/v1/clinical/visits/:id */
  router.get("/:id", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      const rid = getRequestId(req);
      const id = Number(req.params.id);

      // FIX: tenant_id en el WHERE
      const [rows] = await ctx.tenantPool.query<any[]>(
        `SELECT c.*,
                p.nombre as paciente_nombre, p.especie, p.raza,
                v.nombre as vet_nombre, v.apellido as vet_apellido
         FROM consultas c
         JOIN pacientes p    ON p.id = c.paciente_id
         LEFT JOIN veterinarios v ON v.id = c.veterinario_id
         WHERE c.id=? AND c.tenant_id=? AND c.is_active=1 LIMIT 1`,
        [id, ctx.tenantId]
      );
      if (!rows?.length) throw new AppError("NOT_FOUND", "Consulta no encontrada");
      res.json(ok(rows[0], rid));
    } catch (e) { next(e); }
  });

  /** POST /api/v1/clinical/visits */
  router.post("/", async (req, res, next) => {
    try {
      const ctx  = getCtx(req);
      const rid  = getRequestId(req);
      const roles = ctx.roles ?? [];
      if (!roles.includes("admin") && !roles.includes("vet") && !roles.includes("staff")) {
        throw new AppError("FORBIDDEN", "Rol insuficiente");
      }
      const body = VisitIn.parse(req.body ?? {});

      // Verificar que el paciente pertenece al tenant
      const [pac] = await ctx.tenantPool.query<any[]>(
        "SELECT id FROM pacientes WHERE id=? AND tenant_id=? AND is_active=1 LIMIT 1",
        [body.paciente_id, ctx.tenantId]
      );
      if (!pac?.length) throw new AppError("NOT_FOUND", "Paciente no encontrado");

      const [result] = await ctx.tenantPool.query<any>(
        `INSERT INTO consultas
          (tenant_id, paciente_id, veterinario_id, turno_id, fecha, motivo,
           anamnesis, examen_fisico, diagnostico, tratamiento,
           temperatura, peso_kg, frecuencia_cardiaca, frecuencia_respiratoria, proxima_consulta)
         VALUES (?,?,?,?,COALESCE(?,NOW()),?,?,?,?,?,?,?,?,?,?)`,
        [
          ctx.tenantId,
          body.paciente_id,
          body.veterinario_id ?? ctx.veterinarioId ?? null,
          body.turno_id ?? null,
          body.fecha_hora ?? null,
          body.motivo,
          body.anamnesis ?? null,
          body.examen_fisico ?? null,
          body.diagnostico ?? null,
          body.tratamiento ?? null,
          body.temperatura ?? null,
          body.peso_kg ?? null,
          body.frecuencia_cardiaca ?? null,
          body.frecuencia_respiratoria ?? null,
          body.proxima_consulta ?? null,
        ]
      );
      const id = Number(result.insertId);

      // Al cerrar consulta, actualizar peso del paciente si se registró
      if (body.peso_kg) {
        await ctx.tenantPool.query(
          "UPDATE pacientes SET peso_kg=?, updated_at=NOW() WHERE id=? AND tenant_id=?",
          [body.peso_kg, body.paciente_id, ctx.tenantId]
        );
      }

      // Si viene de un turno, marcarlo como completado
      if (body.turno_id) {
        await ctx.tenantPool.query(
          "UPDATE turnos SET estado='completado', updated_at=NOW() WHERE id=? AND tenant_id=? AND estado IN ('pendiente','confirmado')",
          [body.turno_id, ctx.tenantId]
        );
      }

      await appendAudit(ctx.tenantPool, {
        tenant_id: ctx.tenantId, actor_user_id: ctx.userId ?? "",
        action: "create", resource: "consultas", resource_id: String(id),
        after_json: body, ip: req.ip ?? "",
        user_agent: String(req.headers["user-agent"] ?? ""), request_id: rid,
      });
      res.status(201).json(ok({ id }, rid));
    } catch (e) { next(e); }
  });

  /** PATCH /api/v1/clinical/visits/:id */
  router.patch("/:id", async (req, res, next) => {
    try {
      const ctx   = getCtx(req);
      const rid   = getRequestId(req);
      const roles = ctx.roles ?? [];
      if (!roles.includes("admin") && !roles.includes("vet")) {
        throw new AppError("FORBIDDEN", "Rol insuficiente");
      }
      const id   = Number(req.params.id);
      const body = VisitIn.partial().parse(req.body ?? {});

      // FIX: tenant_id en el SELECT y UPDATE
      const [before] = await ctx.tenantPool.query<any[]>(
        "SELECT * FROM consultas WHERE id=? AND tenant_id=? AND is_active=1 LIMIT 1",
        [id, ctx.tenantId]
      );
      if (!before?.length) throw new AppError("NOT_FOUND", "Consulta no encontrada");

      const fields: string[] = [];
      const values: any[]   = [];
      for (const [k, v] of Object.entries(body)) {
        if (UPDATABLE.includes(k) && v !== undefined) { fields.push(`${k}=?`); values.push(v); }
      }
      if (!fields.length) throw new AppError("VALIDATION_ERROR", "Nada que actualizar");
      fields.push("updated_at=NOW()");
      values.push(id, ctx.tenantId);

      // FIX: tenant_id en el UPDATE
      await ctx.tenantPool.query(
        `UPDATE consultas SET ${fields.join(",")} WHERE id=? AND tenant_id=?`,
        values
      );

      // Sincronizar peso si cambió
      if (body.peso_kg !== undefined) {
        await ctx.tenantPool.query(
          "UPDATE pacientes SET peso_kg=?, updated_at=NOW() WHERE id=? AND tenant_id=?",
          [body.peso_kg, before[0].paciente_id, ctx.tenantId]
        );
      }

      await appendAudit(ctx.tenantPool, {
        tenant_id: ctx.tenantId, actor_user_id: ctx.userId ?? "",
        action: "update", resource: "consultas", resource_id: String(id),
        before_json: before[0], after_json: body,
        ip: req.ip ?? "", user_agent: String(req.headers["user-agent"] ?? ""), request_id: rid,
      });
      res.json(ok({ ok: true }, rid));
    } catch (e) { next(e); }
  });

  /** DELETE /api/v1/clinical/visits/:id — soft delete */
  router.delete("/:id", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      const rid = getRequestId(req);
      if (!ctx.roles?.includes("admin") && !ctx.roles?.includes("vet")) {
        throw new AppError("FORBIDDEN", "Rol insuficiente");
      }
      const id = Number(req.params.id);
      const [rows] = await ctx.tenantPool.query<any[]>(
        "SELECT id FROM consultas WHERE id=? AND tenant_id=? AND is_active=1 LIMIT 1",
        [id, ctx.tenantId]
      );
      if (!rows?.length) throw new AppError("NOT_FOUND", "Consulta no encontrada");
      await ctx.tenantPool.query(
        "UPDATE consultas SET is_active=0, updated_at=NOW() WHERE id=? AND tenant_id=?",
        [id, ctx.tenantId]
      );
      await appendAudit(ctx.tenantPool, {
        tenant_id: ctx.tenantId, actor_user_id: ctx.userId ?? "",
        action: "soft_delete", resource: "consultas", resource_id: String(id),
        ip: req.ip ?? "", user_agent: String(req.headers["user-agent"] ?? ""), request_id: rid,
      });
      res.json(ok({ ok: true }, rid));
    } catch (e) { next(e); }
  });

  return router;
}
