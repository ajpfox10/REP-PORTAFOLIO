import { Router } from "express";
import { z } from "zod";
import { nanoid } from "nanoid";
import { AppError } from "../../core/errors/appError.js";
import { appendAudit } from "../../audit/auditRepo.js";

const VisitIn = z.object({
  paciente_id: z.coerce.number().int().positive(),
  veterinario_id: z.coerce.number().int().positive().optional().nullable(),
  turno_id: z.coerce.number().int().positive().optional().nullable(),
  fecha_hora: z.string().min(10), // ISO datetime
  motivo: z.string().min(1).max(500),
  anamnesis: z.string().max(5000).optional().nullable(),
  diagnostico: z.string().max(5000).optional().nullable(),
  tratamiento: z.string().max(5000).optional().nullable(),
  temperatura: z.coerce.number().min(30).max(45).optional().nullable(),
  peso_kg: z.coerce.number().min(0).max(999).optional().nullable(),
  frecuencia_cardiaca: z.coerce.number().int().min(0).max(999).optional().nullable(),
  proxima_consulta: z.string().optional().nullable(),
});

export function buildVisitsRouter() {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      const page = Math.max(Number(req.query.page ?? 1), 1);
      const limit = Math.min(Number(req.query.limit ?? 50), 200);
      const offset = (page - 1) * limit;
      const pacienteId = req.query.paciente_id ? Number(req.query.paciente_id) : null;

      const where = pacienteId ? "WHERE c.paciente_id=?" : "";
      const params: any[] = pacienteId ? [pacienteId, limit, offset] : [limit, offset];

      const [rows] = await ctx.tenantPool.query<any[]>(
        `SELECT c.id, c.paciente_id, c.veterinario_id, c.fecha_hora, c.motivo, c.diagnostico,
                c.temperatura, c.peso_kg, c.created_at,
                p.nombre as paciente_nombre, p.especie,
                v.nombre as vet_nombre, v.apellido as vet_apellido
           FROM consultas c
           JOIN pacientes p ON p.id = c.paciente_id
           LEFT JOIN veterinarios v ON v.id = c.veterinario_id
           ${where}
           ORDER BY c.fecha_hora DESC LIMIT ? OFFSET ?`,
        params
      );
      res.json({ data: rows, meta: { requestId: (req as any).id, page, limit }, errors: [] });
    } catch (e) { next(e); }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      const id = Number(req.params.id);
      const [rows] = await ctx.tenantPool.query<any[]>(
        `SELECT c.*, p.nombre as paciente_nombre, p.especie, p.raza,
                v.nombre as vet_nombre, v.apellido as vet_apellido
           FROM consultas c
           JOIN pacientes p ON p.id = c.paciente_id
           LEFT JOIN veterinarios v ON v.id = c.veterinario_id
           WHERE c.id=? LIMIT 1`,
        [id]
      );
      if (!rows?.length) throw new AppError("NOT_FOUND", "Visita not found");
      res.json({ data: rows[0], meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  router.post("/", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      const roles = ctx.roles ?? [];
      if (!roles.includes("admin") && !roles.includes("vet") && !roles.includes("staff")) {
        throw new AppError("FORBIDDEN", "Insufficient role");
      }
      const body = VisitIn.parse(req.body ?? {});
      const [result] = await ctx.tenantPool.query<any>(
        `INSERT INTO consultas
          (paciente_id, veterinario_id, turno_id, fecha, motivo, anamnesis, diagnostico, tratamiento, temperatura, peso_kg, frecuencia_cardiaca, proxima_consulta)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          body.paciente_id,
          body.veterinario_id ?? null,
          body.turno_id ?? null,
          body.fecha_hora,
          body.motivo,
          body.anamnesis ?? null,
          body.diagnostico ?? null,
          body.tratamiento ?? null,
          body.temperatura ?? null,
          body.peso_kg ?? null,
          body.frecuencia_cardiaca ?? null,
          body.proxima_consulta ?? null,
        ]
      );
      const id = Number(result.insertId);
      await appendAudit(ctx.tenantPool, {
        tenant_id: ctx.tenantId, actor_user_id: ctx.userId,
        action: "create", resource: "consultas", resource_id: String(id),
        after_json: body, ip: req.ip, user_agent: String(req.headers["user-agent"] ?? ""),
        request_id: (req as any).id,
      });
      res.status(201).json({ data: { id }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  router.patch("/:id", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      const roles = ctx.roles ?? [];
      if (!roles.includes("admin") && !roles.includes("vet")) throw new AppError("FORBIDDEN", "Insufficient role");
      const id = Number(req.params.id);
      const body = VisitIn.partial().parse(req.body ?? {});

      const [before] = await ctx.tenantPool.query<any[]>("SELECT * FROM consultas WHERE id=? LIMIT 1", [id]);
      if (!before?.length) throw new AppError("NOT_FOUND", "Visita not found");

      const fields: string[] = [];
      const values: any[] = [];
      for (const [k, v] of Object.entries(body)) {
        if (v !== undefined) { fields.push(`${k}=?`); values.push(v); }
      }
      if (!fields.length) throw new AppError("VALIDATION_ERROR", "No fields to update");
      values.push(id);

      await ctx.tenantPool.query(`UPDATE consultas SET ${fields.join(",")} WHERE id=?`, values);
      await appendAudit(ctx.tenantPool, {
        tenant_id: ctx.tenantId, actor_user_id: ctx.userId,
        action: "update", resource: "consultas", resource_id: String(id),
        before_json: before[0], after_json: body, ip: req.ip,
        user_agent: String(req.headers["user-agent"] ?? ""), request_id: (req as any).id,
      });
      res.json({ data: { ok: true }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  return router;
}
