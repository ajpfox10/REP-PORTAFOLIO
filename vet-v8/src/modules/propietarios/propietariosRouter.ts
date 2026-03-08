import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../core/errors/appError.js";
import { appendAudit } from "../../audit/auditRepo.js";
import { getCtx, getRequestId, ok } from "../../core/http/requestCtx.js";

const PropietarioIn = z.object({
  nombre: z.string().min(1).max(128),
  apellido: z.string().min(1).max(128),
  email: z.string().email().optional().nullable(),
  telefono: z.string().min(3).max(32).optional().nullable(),
  direccion: z.string().max(255).optional().nullable(),
  ciudad: z.string().max(128).optional().nullable(),
  dni: z.string().max(32).optional().nullable(),
  notas: z.string().max(2000).optional().nullable(),
  sucursal_id: z.coerce.number().int().positive().optional().nullable(),
});

export function buildPropietariosRouter() {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      const page = Math.max(Number(req.query.page ?? 1), 1);
      const limit = Math.min(Number(req.query.limit ?? 50), 200);
      const offset = (page - 1) * limit;
      const q = req.query.q ? `%${String(req.query.q).trim()}%` : null;

      const conditions = ["pr.tenant_id=?", "pr.is_active=1"];
      const params: any[] = [ctx.tenantId];
      if (q) { conditions.push("(pr.nombre LIKE ? OR pr.apellido LIKE ? OR pr.email LIKE ? OR pr.dni LIKE ?)"); params.push(q,q,q,q); }

      params.push(limit, offset);

      const [rows] = await ctx.tenantPool.query<any[]>(
        `SELECT pr.id, pr.nombre, pr.apellido, pr.email, pr.telefono, pr.ciudad, pr.dni, pr.created_at,
                COUNT(p.id) as total_mascotas
         FROM propietarios pr
         LEFT JOIN pacientes p ON p.propietario_id=pr.id AND p.is_active=1
         WHERE ${conditions.join(" AND ")}
         GROUP BY pr.id
         ORDER BY pr.apellido, pr.nombre ASC LIMIT ? OFFSET ?`,
        params
      );
      res.json({ data: rows, meta: { requestId: getRequestId(req), page, limit }, errors: [] });
    } catch (e) { next(e); }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      const id = Number(req.params.id);
      const [rows] = await ctx.tenantPool.query<any[]>(
        "SELECT * FROM propietarios WHERE id=? AND tenant_id=? AND is_active=1 LIMIT 1", [id, ctx.tenantId]
      );
      if (!rows?.length) throw new AppError("NOT_FOUND", "Propietario no encontrado");

      // Load their pets
      const [mascotas] = await ctx.tenantPool.query<any[]>(
        "SELECT id, nombre, especie, raza, sexo, fecha_nacimiento, microchip FROM pacientes WHERE propietario_id=? AND is_active=1",
        [id]
      );
      res.json({ data: { ...rows[0], mascotas }, meta: { requestId: getRequestId(req) }, errors: [] });
    } catch (e) { next(e); }
  });

  router.post("/", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      const roles = ctx.roles ?? [];
      if (!roles.includes("admin") && !roles.includes("receptionist") && !roles.includes("staff")) {
        throw new AppError("FORBIDDEN", "Rol insuficiente");
      }
      const body = PropietarioIn.parse(req.body ?? {});
      const [result] = await ctx.tenantPool.query<any>(
        `INSERT INTO propietarios (tenant_id, nombre, apellido, email, telefono, direccion, ciudad, dni, notas, sucursal_id)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [ctx.tenantId, body.nombre, body.apellido, body.email ?? null, body.telefono ?? null,
         body.direccion ?? null, body.ciudad ?? null, body.dni ?? null, body.notas ?? null, body.sucursal_id ?? null]
      );
      const id = Number(result.insertId);
      await appendAudit(ctx.tenantPool, {
        tenant_id: ctx.tenantId, actor_user_id: ctx.userId,
        action: "create", resource: "propietarios", resource_id: String(id),
        after_json: body, ip: req.ip, user_agent: String(req.headers["user-agent"] ?? ""),
        request_id: getRequestId(req),
      });
      res.status(201).json({ data: { id }, meta: { requestId: getRequestId(req) }, errors: [] });
    } catch (e) { next(e); }
  });

  router.patch("/:id", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      const id = Number(req.params.id);
      const body = PropietarioIn.partial().parse(req.body ?? {});
      const [before] = await ctx.tenantPool.query<any[]>(
        "SELECT * FROM propietarios WHERE id=? AND tenant_id=? LIMIT 1", [id, ctx.tenantId]
      );
      if (!before?.length) throw new AppError("NOT_FOUND", "Propietario no encontrado");

      const allowed = ["nombre","apellido","email","telefono","direccion","ciudad","dni","notas","sucursal_id"];
      const fields: string[] = [];
      const values: any[] = [];
      for (const [k, v] of Object.entries(body)) {
        if (allowed.includes(k) && v !== undefined) { fields.push(`${k}=?`); values.push(v); }
      }
      if (!fields.length) throw new AppError("VALIDATION_ERROR", "Nada para actualizar");
      fields.push("updated_at=NOW()");
      values.push(id, ctx.tenantId);

      await ctx.tenantPool.query(`UPDATE propietarios SET ${fields.join(",")} WHERE id=? AND tenant_id=?`, values);
      await appendAudit(ctx.tenantPool, {
        tenant_id: ctx.tenantId, actor_user_id: ctx.userId,
        action: "update", resource: "propietarios", resource_id: String(id),
        before_json: before[0], after_json: body, ip: req.ip,
        user_agent: String(req.headers["user-agent"] ?? ""), request_id: getRequestId(req),
      });
      res.json({ data: { ok: true }, meta: { requestId: getRequestId(req) }, errors: [] });
    } catch (e) { next(e); }
  });

  router.delete("/:id", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      if (!ctx.roles?.includes("admin")) throw new AppError("FORBIDDEN", "Solo admins");
      const id = Number(req.params.id);
      await ctx.tenantPool.query(
        "UPDATE propietarios SET is_active=0, updated_at=NOW() WHERE id=? AND tenant_id=?", [id, ctx.tenantId]
      );
      await appendAudit(ctx.tenantPool, {
        tenant_id: ctx.tenantId, actor_user_id: ctx.userId,
        action: "soft_delete", resource: "propietarios", resource_id: String(id),
        ip: req.ip, user_agent: String(req.headers["user-agent"] ?? ""), request_id: getRequestId(req),
      });
      res.json({ data: { ok: true }, meta: { requestId: getRequestId(req) }, errors: [] });
    } catch (e) { next(e); }
  });

  return router;
}
