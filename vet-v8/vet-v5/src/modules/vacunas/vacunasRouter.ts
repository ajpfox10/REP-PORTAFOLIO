import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../core/errors/appError.js";
import { appendAudit } from "../../audit/auditRepo.js";

const VacunaIn = z.object({
  paciente_id: z.coerce.number().int().positive(),
  veterinario_id: z.coerce.number().int().positive().optional().nullable(),
  nombre: z.string().min(1).max(128),
  laboratorio: z.string().max(128).optional().nullable(),
  lote: z.string().max(64).optional().nullable(),
  fecha_aplicacion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fecha_vencimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  proxima_dosis: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notas: z.string().max(1000).optional().nullable(),
});

const DespIn = z.object({
  paciente_id: z.coerce.number().int().positive(),
  veterinario_id: z.coerce.number().int().positive().optional().nullable(),
  tipo: z.enum(["interna", "externa", "combinada"]).default("interna"),
  producto: z.string().min(1).max(128),
  fecha_aplicacion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  proxima_dosis: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

export function buildVacunasRouter() {
  const router = Router();

  // ── Vacunas ────────────────────────────────────────────────────────────────

  router.get("/", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      const pacienteId = req.query.paciente_id ? Number(req.query.paciente_id) : null;
      const proximas = req.query.proximas === "true"; // upcoming reminders

      let sql = `SELECT v.*, p.nombre as paciente_nombre, p.especie,
                        vt.nombre as vet_nombre, vt.apellido as vet_apellido
                 FROM vacunas v
                 JOIN pacientes p ON p.id = v.paciente_id
                 LEFT JOIN veterinarios vt ON vt.id = v.veterinario_id
                 WHERE v.tenant_id=?`;
      const params: any[] = [ctx.tenantId];

      if (pacienteId) { sql += " AND v.paciente_id=?"; params.push(pacienteId); }
      if (proximas) {
        sql += " AND v.proxima_dosis IS NOT NULL AND v.proxima_dosis BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)";
      }
      sql += " ORDER BY v.fecha_aplicacion DESC LIMIT 200";

      const [rows] = await ctx.tenantPool.query<any[]>(sql, params);
      res.json({ data: rows, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  router.post("/", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      if (!ctx.roles?.includes("admin") && !ctx.roles?.includes("vet") && !ctx.roles?.includes("staff")) {
        throw new AppError("FORBIDDEN", "Rol insuficiente");
      }
      const body = VacunaIn.parse(req.body ?? {});
      const [result] = await ctx.tenantPool.query<any>(
        `INSERT INTO vacunas (tenant_id, paciente_id, veterinario_id, nombre, laboratorio, lote, fecha_aplicacion, fecha_vencimiento, proxima_dosis, notas)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [ctx.tenantId, body.paciente_id, body.veterinario_id ?? null, body.nombre, body.laboratorio ?? null,
         body.lote ?? null, body.fecha_aplicacion, body.fecha_vencimiento ?? null, body.proxima_dosis ?? null, body.notas ?? null]
      );
      const id = Number(result.insertId);
      await appendAudit(ctx.tenantPool, {
        tenant_id: ctx.tenantId, actor_user_id: ctx.userId,
        action: "create", resource: "vacunas", resource_id: String(id),
        after_json: body, ip: req.ip, user_agent: String(req.headers["user-agent"] ?? ""),
        request_id: (req as any).id,
      });
      res.status(201).json({ data: { id }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  router.patch("/:id", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      const id = Number(req.params.id);
      const body = VacunaIn.partial().parse(req.body ?? {});
      const [before] = await ctx.tenantPool.query<any[]>(
        "SELECT * FROM vacunas WHERE id=? AND tenant_id=? LIMIT 1", [id, ctx.tenantId]
      );
      if (!before?.length) throw new AppError("NOT_FOUND", "Vacuna no encontrada");

      const allowed = ["nombre","laboratorio","lote","fecha_aplicacion","fecha_vencimiento","proxima_dosis","notas","veterinario_id"];
      const fields: string[] = [];
      const values: any[] = [];
      for (const [k, v] of Object.entries(body)) {
        if (allowed.includes(k) && v !== undefined) { fields.push(`${k}=?`); values.push(v); }
      }
      if (!fields.length) throw new AppError("VALIDATION_ERROR", "Nada que actualizar");
      values.push(id, ctx.tenantId);
      await ctx.tenantPool.query(`UPDATE vacunas SET ${fields.join(",")} WHERE id=? AND tenant_id=?`, values);
      await appendAudit(ctx.tenantPool, {
        tenant_id: ctx.tenantId, actor_user_id: ctx.userId,
        action: "update", resource: "vacunas", resource_id: String(id),
        before_json: before[0], after_json: body, ip: req.ip,
        user_agent: String(req.headers["user-agent"] ?? ""), request_id: (req as any).id,
      });
      res.json({ data: { ok: true }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  // ── Desparasitaciones ──────────────────────────────────────────────────────

  router.get("/desparasitaciones", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      const pacienteId = req.query.paciente_id ? Number(req.query.paciente_id) : null;

      let sql = `SELECT d.*, p.nombre as paciente_nombre FROM desparasitaciones d
                 JOIN pacientes p ON p.id=d.paciente_id WHERE d.tenant_id=?`;
      const params: any[] = [ctx.tenantId];
      if (pacienteId) { sql += " AND d.paciente_id=?"; params.push(pacienteId); }
      sql += " ORDER BY d.fecha_aplicacion DESC LIMIT 200";

      const [rows] = await ctx.tenantPool.query<any[]>(sql, params);
      res.json({ data: rows, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  router.post("/desparasitaciones", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      if (!ctx.roles?.includes("admin") && !ctx.roles?.includes("vet") && !ctx.roles?.includes("staff")) {
        throw new AppError("FORBIDDEN", "Rol insuficiente");
      }
      const body = DespIn.parse(req.body ?? {});
      const [result] = await ctx.tenantPool.query<any>(
        `INSERT INTO desparasitaciones (tenant_id, paciente_id, veterinario_id, tipo, producto, fecha_aplicacion, proxima_dosis)
         VALUES (?,?,?,?,?,?,?)`,
        [ctx.tenantId, body.paciente_id, body.veterinario_id ?? null, body.tipo, body.producto, body.fecha_aplicacion, body.proxima_dosis ?? null]
      );
      const id = Number(result.insertId);
      await appendAudit(ctx.tenantPool, {
        tenant_id: ctx.tenantId, actor_user_id: ctx.userId,
        action: "create", resource: "desparasitaciones", resource_id: String(id),
        after_json: body, ip: req.ip, user_agent: String(req.headers["user-agent"] ?? ""),
        request_id: (req as any).id,
      });
      res.status(201).json({ data: { id }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  return router;
}
