import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../core/errors/appError.js";
import { appendAudit } from "../../audit/auditRepo.js";

// ── Prescripciones ─────────────────────────────────────────────────────────

const PrescripcionIn = z.object({
  consulta_id: z.coerce.number().int().positive(),
  paciente_id: z.coerce.number().int().positive(),
  veterinario_id: z.coerce.number().int().positive().optional().nullable(),
  medicamento: z.string().min(1).max(255),
  dosis: z.string().max(128).optional().nullable(),
  frecuencia: z.string().max(128).optional().nullable(),
  duracion: z.string().max(128).optional().nullable(),
  via: z.string().max(64).optional().nullable(),
  instrucciones: z.string().max(2000).optional().nullable(),
});

export function buildPrescripcionesRouter() {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      const consultaId = req.query.consulta_id ? Number(req.query.consulta_id) : null;
      const pacienteId = req.query.paciente_id ? Number(req.query.paciente_id) : null;

      const conditions = ["pr.tenant_id=?"];
      const params: any[] = [ctx.tenantId];
      if (consultaId) { conditions.push("pr.consulta_id=?"); params.push(consultaId); }
      if (pacienteId) { conditions.push("pr.paciente_id=?"); params.push(pacienteId); }
      params.push(100);

      const [rows] = await ctx.tenantPool.query<any[]>(
        `SELECT pr.*, p.nombre as paciente_nombre, v.nombre as vet_nombre, v.apellido as vet_apellido
         FROM prescripciones pr
         JOIN pacientes p ON p.id=pr.paciente_id
         LEFT JOIN veterinarios v ON v.id=pr.veterinario_id
         WHERE ${conditions.join(" AND ")}
         ORDER BY pr.created_at DESC LIMIT ?`,
        params
      );
      res.json({ data: rows, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  router.post("/", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      if (!ctx.roles?.includes("admin") && !ctx.roles?.includes("vet")) {
        throw new AppError("FORBIDDEN", "Solo veterinarios pueden prescribir");
      }
      const body = PrescripcionIn.parse(req.body ?? {});
      const [result] = await ctx.tenantPool.query<any>(
        `INSERT INTO prescripciones (tenant_id, consulta_id, paciente_id, veterinario_id, medicamento, dosis, frecuencia, duracion, via, instrucciones)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [ctx.tenantId, body.consulta_id, body.paciente_id, body.veterinario_id ?? ctx.veterinarioId ?? null,
         body.medicamento, body.dosis ?? null, body.frecuencia ?? null, body.duracion ?? null, body.via ?? null, body.instrucciones ?? null]
      );
      const id = Number(result.insertId);
      await appendAudit(ctx.tenantPool, {
        tenant_id: ctx.tenantId, actor_user_id: ctx.userId,
        action: "create", resource: "prescripciones", resource_id: String(id),
        after_json: body, ip: req.ip, user_agent: String(req.headers["user-agent"] ?? ""),
        request_id: (req as any).id,
      });
      res.status(201).json({ data: { id }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  router.delete("/:id", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      if (!ctx.roles?.includes("admin") && !ctx.roles?.includes("vet")) {
        throw new AppError("FORBIDDEN", "Rol insuficiente");
      }
      const id = Number(req.params.id);
      await ctx.tenantPool.query("DELETE FROM prescripciones WHERE id=? AND tenant_id=?", [id, ctx.tenantId]);
      await appendAudit(ctx.tenantPool, {
        tenant_id: ctx.tenantId, actor_user_id: ctx.userId,
        action: "delete", resource: "prescripciones", resource_id: String(id),
        ip: req.ip, user_agent: String(req.headers["user-agent"] ?? ""), request_id: (req as any).id,
      });
      res.json({ data: { ok: true }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  return router;
}

// ── Internaciones ──────────────────────────────────────────────────────────

const InternacionIn = z.object({
  paciente_id: z.coerce.number().int().positive(),
  veterinario_id: z.coerce.number().int().positive().optional().nullable(),
  sucursal_id: z.coerce.number().int().positive().optional().nullable(),
  consulta_id: z.coerce.number().int().positive().optional().nullable(),
  fecha_ingreso: z.string().min(16).optional(),
  motivo: z.string().max(2000).optional().nullable(),
  tratamiento: z.string().max(2000).optional().nullable(),
  jaula_num: z.string().max(16).optional().nullable(),
});

export function buildInternacionesRouter() {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      const estado = req.query.estado ? String(req.query.estado) : "internado";
      const [rows] = await ctx.tenantPool.query<any[]>(
        `SELECT i.*, p.nombre as paciente_nombre, p.especie,
                v.nombre as vet_nombre, v.apellido as vet_apellido,
                s.nombre as sucursal_nombre
         FROM internaciones i
         JOIN pacientes p ON p.id=i.paciente_id
         LEFT JOIN veterinarios v ON v.id=i.veterinario_id
         LEFT JOIN sucursales s ON s.id=i.sucursal_id
         WHERE i.tenant_id=? AND i.estado=?
         ORDER BY i.fecha_ingreso DESC LIMIT 200`,
        [ctx.tenantId, estado]
      );
      res.json({ data: rows, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  router.post("/", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      if (!ctx.roles?.includes("admin") && !ctx.roles?.includes("vet")) {
        throw new AppError("FORBIDDEN", "Rol insuficiente");
      }
      const body = InternacionIn.parse(req.body ?? {});
      const [result] = await ctx.tenantPool.query<any>(
        `INSERT INTO internaciones (tenant_id, paciente_id, veterinario_id, sucursal_id, consulta_id, fecha_ingreso, motivo, tratamiento, jaula_num)
         VALUES (?,?,?,?,?,COALESCE(?,NOW()),?,?,?)`,
        [ctx.tenantId, body.paciente_id, body.veterinario_id ?? null, body.sucursal_id ?? null,
         body.consulta_id ?? null, body.fecha_ingreso ?? null, body.motivo ?? null, body.tratamiento ?? null, body.jaula_num ?? null]
      );
      const id = Number(result.insertId);
      await appendAudit(ctx.tenantPool, {
        tenant_id: ctx.tenantId, actor_user_id: ctx.userId,
        action: "internacion_ingreso", resource: "internaciones", resource_id: String(id),
        after_json: body, ip: req.ip, user_agent: String(req.headers["user-agent"] ?? ""),
        request_id: (req as any).id,
      });
      res.status(201).json({ data: { id }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  router.patch("/:id/alta", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      if (!ctx.roles?.includes("admin") && !ctx.roles?.includes("vet")) {
        throw new AppError("FORBIDDEN", "Rol insuficiente");
      }
      const id = Number(req.params.id);
      const { estado = "alta", notas } = req.body ?? {};
      if (!["alta", "fallecido"].includes(estado)) throw new AppError("VALIDATION_ERROR", "estado debe ser alta o fallecido");

      await ctx.tenantPool.query(
        "UPDATE internaciones SET estado=?, fecha_egreso=NOW(), tratamiento=COALESCE(?,tratamiento), updated_at=NOW() WHERE id=? AND tenant_id=?",
        [estado, notas ?? null, id, ctx.tenantId]
      );
      await appendAudit(ctx.tenantPool, {
        tenant_id: ctx.tenantId, actor_user_id: ctx.userId,
        action: `internacion_${estado}`, resource: "internaciones", resource_id: String(id),
        after_json: { estado }, ip: req.ip, user_agent: String(req.headers["user-agent"] ?? ""),
        request_id: (req as any).id,
      });
      res.json({ data: { ok: true }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  return router;
}

// ── Sucursales ─────────────────────────────────────────────────────────────

const SucursalIn = z.object({
  nombre: z.string().min(1).max(128),
  direccion: z.string().max(255).optional().nullable(),
  ciudad: z.string().max(128).optional().nullable(),
  provincia: z.string().max(64).optional().nullable(),
  telefono: z.string().max(32).optional().nullable(),
  email: z.string().email().optional().nullable(),
});

export function buildSucursalesRouter() {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      const [rows] = await ctx.tenantPool.query<any[]>(
        "SELECT * FROM sucursales WHERE tenant_id=? AND is_active=1 ORDER BY nombre", [ctx.tenantId]
      );
      res.json({ data: rows, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  router.post("/", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      if (!ctx.roles?.includes("admin")) throw new AppError("FORBIDDEN", "Solo admins");
      const body = SucursalIn.parse(req.body ?? {});
      const [result] = await ctx.tenantPool.query<any>(
        `INSERT INTO sucursales (tenant_id, nombre, direccion, ciudad, provincia, telefono, email)
         VALUES (?,?,?,?,?,?,?)`,
        [ctx.tenantId, body.nombre, body.direccion ?? null, body.ciudad ?? null,
         body.provincia ?? null, body.telefono ?? null, body.email ?? null]
      );
      const id = Number(result.insertId);
      await appendAudit(ctx.tenantPool, {
        tenant_id: ctx.tenantId, actor_user_id: ctx.userId,
        action: "create", resource: "sucursales", resource_id: String(id),
        after_json: body, ip: req.ip, user_agent: String(req.headers["user-agent"] ?? ""),
        request_id: (req as any).id,
      });
      res.status(201).json({ data: { id }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  router.patch("/:id", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      if (!ctx.roles?.includes("admin")) throw new AppError("FORBIDDEN", "Solo admins");
      const id = Number(req.params.id);
      const body = SucursalIn.partial().parse(req.body ?? {});
      const fields: string[] = [];
      const values: any[] = [];
      for (const [k, v] of Object.entries(body)) {
        if (v !== undefined) { fields.push(`${k}=?`); values.push(v); }
      }
      if (!fields.length) throw new AppError("VALIDATION_ERROR", "Nada que actualizar");
      fields.push("updated_at=NOW()");
      values.push(id, ctx.tenantId);
      await ctx.tenantPool.query(`UPDATE sucursales SET ${fields.join(",")} WHERE id=? AND tenant_id=?`, values);
      res.json({ data: { ok: true }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  router.delete("/:id", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      if (!ctx.roles?.includes("admin")) throw new AppError("FORBIDDEN", "Solo admins");
      const id = Number(req.params.id);
      await ctx.tenantPool.query(
        "UPDATE sucursales SET is_active=0, updated_at=NOW() WHERE id=? AND tenant_id=?", [id, ctx.tenantId]
      );
      res.json({ data: { ok: true }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  return router;
}

// ── Veterinarios ───────────────────────────────────────────────────────────

const VetIn = z.object({
  nombre: z.string().min(1).max(128),
  apellido: z.string().min(1).max(128),
  matricula: z.string().max(64).optional().nullable(),
  especialidad: z.string().max(128).optional().nullable(),
  email: z.string().email().optional().nullable(),
  telefono: z.string().max(32).optional().nullable(),
  color_agenda: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().nullable(),
  sucursal_id: z.coerce.number().int().positive().optional().nullable(),
});

export function buildVeterinariosRouter() {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      const sucursalId = req.query.sucursal_id ? Number(req.query.sucursal_id) : null;
      let sql = `SELECT v.*, s.nombre as sucursal_nombre FROM veterinarios v
                 LEFT JOIN sucursales s ON s.id=v.sucursal_id
                 WHERE v.tenant_id=? AND v.is_active=1`;
      const params: any[] = [ctx.tenantId];
      if (sucursalId) { sql += " AND v.sucursal_id=?"; params.push(sucursalId); }
      sql += " ORDER BY v.apellido, v.nombre";
      const [rows] = await ctx.tenantPool.query<any[]>(sql, params);
      res.json({ data: rows, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  router.post("/", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      if (!ctx.roles?.includes("admin")) throw new AppError("FORBIDDEN", "Solo admins");
      const body = VetIn.parse(req.body ?? {});
      const [result] = await ctx.tenantPool.query<any>(
        `INSERT INTO veterinarios (tenant_id, nombre, apellido, matricula, especialidad, email, telefono, color_agenda, sucursal_id)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [ctx.tenantId, body.nombre, body.apellido, body.matricula ?? null, body.especialidad ?? null,
         body.email ?? null, body.telefono ?? null, body.color_agenda ?? null, body.sucursal_id ?? null]
      );
      const id = Number(result.insertId);
      await appendAudit(ctx.tenantPool, {
        tenant_id: ctx.tenantId, actor_user_id: ctx.userId,
        action: "create", resource: "veterinarios", resource_id: String(id),
        after_json: body, ip: req.ip, user_agent: String(req.headers["user-agent"] ?? ""),
        request_id: (req as any).id,
      });
      res.status(201).json({ data: { id }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  router.patch("/:id", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      if (!ctx.roles?.includes("admin")) throw new AppError("FORBIDDEN", "Solo admins");
      const id = Number(req.params.id);
      const body = VetIn.partial().parse(req.body ?? {});
      const allowed = ["nombre","apellido","matricula","especialidad","email","telefono","color_agenda","sucursal_id"];
      const fields: string[] = [];
      const values: any[] = [];
      for (const [k, v] of Object.entries(body)) {
        if (allowed.includes(k) && v !== undefined) { fields.push(`${k}=?`); values.push(v); }
      }
      if (!fields.length) throw new AppError("VALIDATION_ERROR", "Nada que actualizar");
      fields.push("updated_at=NOW()");
      values.push(id, ctx.tenantId);
      await ctx.tenantPool.query(`UPDATE veterinarios SET ${fields.join(",")} WHERE id=? AND tenant_id=?`, values);
      res.json({ data: { ok: true }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  router.delete("/:id", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      if (!ctx.roles?.includes("admin")) throw new AppError("FORBIDDEN", "Solo admins");
      const id = Number(req.params.id);
      await ctx.tenantPool.query(
        "UPDATE veterinarios SET is_active=0, updated_at=NOW() WHERE id=? AND tenant_id=?", [id, ctx.tenantId]
      );
      res.json({ data: { ok: true }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  return router;
}
