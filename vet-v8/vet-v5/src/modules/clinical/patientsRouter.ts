import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../core/errors/appError.js";
import { appendAudit } from "../../audit/auditRepo.js";

// Schema matches the actual pacientes table (animals, not humans)
const PacienteIn = z.object({
  nombre: z.string().min(1).max(128),
  especie: z.string().min(1).max(64),
  raza: z.string().max(128).optional().nullable(),
  fecha_nacimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  sexo: z.enum(["M", "F", "desconocido"]).optional().default("desconocido"),
  peso_kg: z.coerce.number().min(0).max(999).optional().nullable(),
  microchip: z.string().max(64).optional().nullable(),
  alergias: z.string().max(1000).optional().nullable(),
  observaciones: z.string().max(2000).optional().nullable(),
  propietario_id: z.coerce.number().int().positive().optional().nullable(),
  owner_user_id: z.string().optional().nullable(),
  sucursal_id: z.coerce.number().int().positive().optional().nullable(),
});

export function buildPatientsRouter() {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      const page = Math.max(Number(req.query.page ?? 1), 1);
      const limit = Math.min(Number(req.query.limit ?? 50), 200);
      const offset = (page - 1) * limit;
      const search = req.query.q ? `%${String(req.query.q).trim()}%` : null;
      const especie = req.query.especie ? String(req.query.especie) : null;

      const conditions: string[] = ["p.is_active=1"];
      const params: any[] = [];

      if (search) { conditions.push("(p.nombre LIKE ? OR p.microchip LIKE ?)"); params.push(search, search); }
      if (especie) { conditions.push("p.especie=?"); params.push(especie); }

      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      params.push(limit, offset);

      const [rows] = await ctx.tenantPool.query<any[]>(
        `SELECT p.id, p.nombre, p.especie, p.raza, p.sexo, p.fecha_nacimiento, p.peso_kg,
                p.microchip, p.created_at, p.updated_at,
                pr.nombre as propietario_nombre, pr.apellido as propietario_apellido, pr.email as propietario_email
         FROM pacientes p
         LEFT JOIN propietarios pr ON pr.id = p.propietario_id
         ${where}
         ORDER BY p.nombre ASC LIMIT ? OFFSET ?`,
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
        `SELECT p.*, pr.nombre as propietario_nombre, pr.apellido as propietario_apellido,
                pr.email as propietario_email, pr.telefono as propietario_telefono
         FROM pacientes p
         LEFT JOIN propietarios pr ON pr.id = p.propietario_id
         WHERE p.id=? AND p.is_active=1 LIMIT 1`,
        [id]
      );
      if (!rows?.length) throw new AppError("NOT_FOUND", "Paciente not found");
      res.json({ data: rows[0], meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  router.post("/", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      const roles = ctx.roles ?? [];
      if (!roles.includes("admin") && !roles.includes("vet") && !roles.includes("receptionist") && !roles.includes("staff")) {
        throw new AppError("FORBIDDEN", "Insufficient role");
      }
      const body = PacienteIn.parse(req.body ?? {});
      const [result] = await ctx.tenantPool.query<any>(
        `INSERT INTO pacientes (tenant_id, nombre, especie, raza, fecha_nacimiento, sexo, peso_kg, microchip, alergias, observaciones, propietario_id, owner_user_id, sucursal_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [ctx.tenantId, body.nombre, body.especie, body.raza ?? null, body.fecha_nacimiento ?? null,
         body.sexo, body.peso_kg ?? null, body.microchip ?? null, body.alergias ?? null,
         body.observaciones ?? null, body.propietario_id ?? null, body.owner_user_id ?? null, body.sucursal_id ?? null]
      );
      const id = Number(result.insertId);
      await appendAudit(ctx.tenantPool, {
        tenant_id: ctx.tenantId, actor_user_id: ctx.userId,
        action: "create", resource: "pacientes", resource_id: String(id),
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
      if (!roles.includes("admin") && !roles.includes("vet") && !roles.includes("receptionist") && !roles.includes("staff")) {
        throw new AppError("FORBIDDEN", "Insufficient role");
      }
      const id = Number(req.params.id);
      const body = PacienteIn.partial().parse(req.body ?? {});

      const [before] = await ctx.tenantPool.query<any[]>("SELECT * FROM pacientes WHERE id=? AND is_active=1 LIMIT 1", [id]);
      if (!before?.length) throw new AppError("NOT_FOUND", "Paciente not found");

      const allowed = ["nombre","especie","raza","fecha_nacimiento","sexo","peso_kg","microchip","alergias","observaciones","propietario_id","sucursal_id"];
      const fields: string[] = [];
      const values: any[] = [];
      for (const [k, v] of Object.entries(body)) {
        if (allowed.includes(k) && v !== undefined) { fields.push(`${k}=?`); values.push(v); }
      }
      if (!fields.length) throw new AppError("VALIDATION_ERROR", "No valid fields to update");
      fields.push("updated_at=NOW()");
      values.push(id);

      await ctx.tenantPool.query(`UPDATE pacientes SET ${fields.join(",")} WHERE id=?`, values);
      await appendAudit(ctx.tenantPool, {
        tenant_id: ctx.tenantId, actor_user_id: ctx.userId,
        action: "update", resource: "pacientes", resource_id: String(id),
        before_json: before[0], after_json: body, ip: req.ip,
        user_agent: String(req.headers["user-agent"] ?? ""), request_id: (req as any).id,
      });
      res.json({ data: { ok: true }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  router.delete("/:id", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      if (!ctx.roles?.includes("admin")) throw new AppError("FORBIDDEN", "Admin only");
      const id = Number(req.params.id);
      // Soft delete
      await ctx.tenantPool.query("UPDATE pacientes SET is_active=0, updated_at=NOW() WHERE id=?", [id]);
      await appendAudit(ctx.tenantPool, {
        tenant_id: ctx.tenantId, actor_user_id: ctx.userId,
        action: "soft_delete", resource: "pacientes", resource_id: String(id),
        ip: req.ip, user_agent: String(req.headers["user-agent"] ?? ""), request_id: (req as any).id,
      });
      res.json({ data: { ok: true }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  return router;
}
