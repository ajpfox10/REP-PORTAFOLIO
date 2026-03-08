/**
 * pacientesRouter — v11  (Punto 3)
 *
 * CRUD completo de pacientes con:
 *   - RLS aplicado en todas las queries
 *   - Búsqueda por nombre (FULLTEXT), microchip, especie, raza
 *   - Historial clínico paginado (consultas + vacunas + desparasitaciones)
 *   - Exportación de ficha resumen en JSON (para PDF en punto 9)
 *   - Validación de campos obligatorios
 *   - Registro de peso como observación con timestamp
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { getCtx, requireRole, ok } from "../../core/context.js";
import { AppError } from "../../core/errors/appError.js";
import { buildRlsFilterStrict } from "../../security/rls/rls.js";

export function buildPacientesRouter(): Router {
  const r = Router();

  // ── GET / — lista con búsqueda y paginación ─────────────────────────────
  r.get("/", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getCtx(req);
      const { where, params } = buildRlsFilterStrict(ctx, "pacientes");

      const page  = Math.max(1, parseInt(String(req.query.page  ?? "1")));
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "50"))));
      const offset = (page - 1) * limit;

      // Filtros opcionales
      const conditions: string[] = [where];
      const queryParams: any[] = [...params];

      if (req.query.q) {
        conditions.push("MATCH(p.nombre, p.raza) AGAINST(? IN BOOLEAN MODE)");
        queryParams.push(String(req.query.q) + "*");
      }
      if (req.query.especie) {
        conditions.push("p.especie = ?");
        queryParams.push(req.query.especie);
      }
      if (req.query.microchip) {
        conditions.push("p.microchip = ?");
        queryParams.push(req.query.microchip);
      }
      if (req.query.propietario_id) {
        conditions.push("p.propietario_id = ?");
        queryParams.push(req.query.propietario_id);
      }
      if (req.query.activo !== "false") {
        conditions.push("p.is_active = 1");
      }

      const whereClause = conditions.join(" AND ");

      const [[{ total }]] = await ctx.tenantPool.query<any[]>(
        `SELECT COUNT(*) AS total FROM pacientes p WHERE ${whereClause}`,
        queryParams
      );

      const [rows] = await ctx.tenantPool.query<any[]>(
        `SELECT
           p.id, p.nombre, p.especie, p.raza, p.sexo, p.color,
           p.fecha_nacimiento, p.castrado, p.peso_kg, p.microchip,
           p.pasaporte_num, p.foto_url, p.alergias, p.observaciones,
           p.is_active, p.created_at, p.updated_at,
           prop.id AS propietario_id,
           CONCAT(prop.nombre, ' ', prop.apellido) AS propietario_nombre,
           prop.telefono AS propietario_telefono,
           prop.email AS propietario_email,
           suc.nombre AS sucursal_nombre
         FROM pacientes p
         LEFT JOIN propietarios prop ON prop.id = p.propietario_id
         LEFT JOIN sucursales suc ON suc.id = p.sucursal_id
         WHERE ${whereClause}
         ORDER BY p.nombre ASC
         LIMIT ? OFFSET ?`,
        [...queryParams, limit, offset]
      );

      res.json(ok(rows, { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) }));
    } catch (e) { next(e); }
  });

  // ── GET /:id — detalle del paciente ────────────────────────────────────
  r.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getCtx(req);
      const id = parseInt(req.params.id);
      if (!id || isNaN(id)) throw new AppError("VALIDATION_ERROR", "ID de paciente inválido");

      const [rows] = await ctx.tenantPool.query<any[]>(
        `SELECT
           p.*,
           prop.id AS propietario_id,
           CONCAT(prop.nombre, ' ', prop.apellido) AS propietario_nombre,
           prop.telefono AS propietario_telefono,
           prop.email AS propietario_email,
           prop.direccion AS propietario_direccion,
           suc.nombre AS sucursal_nombre
         FROM pacientes p
         LEFT JOIN propietarios prop ON prop.id = p.propietario_id
         LEFT JOIN sucursales suc ON suc.id = p.sucursal_id
         WHERE p.id = ? AND p.tenant_id = ? AND p.is_active = 1`,
        [id, ctx.tenantId]
      );

      if (!rows[0]) throw new AppError("NOT_FOUND", "Paciente no encontrado");
      res.json(ok(rows[0]));
    } catch (e) { next(e); }
  });

  // ── POST / — crear paciente ─────────────────────────────────────────────
  r.post("/", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getCtx(req);
      requireRole(ctx, "admin", "vet", "staff");

      const { nombre, especie, raza, sexo, color, fecha_nacimiento, castrado,
              peso_kg, microchip, pasaporte_num, alergias, observaciones,
              foto_url, propietario_id, sucursal_id } = req.body;

      if (!nombre?.trim()) throw new AppError("VALIDATION_ERROR", "nombre es obligatorio");
      if (!especie?.trim()) throw new AppError("VALIDATION_ERROR", "especie es obligatoria");

      const validSexo = ["M", "F", "desconocido"];
      const sexoFinal = validSexo.includes(sexo) ? sexo : "desconocido";

      const [result] = await ctx.tenantPool.query<any>(
        `INSERT INTO pacientes
           (tenant_id, sucursal_id, propietario_id, nombre, especie, raza, color,
            fecha_nacimiento, sexo, castrado, peso_kg, microchip, pasaporte_num,
            alergias, observaciones, foto_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [ctx.tenantId, sucursal_id ?? ctx.sucursalId ?? null, propietario_id ?? null,
         nombre.trim(), especie.trim(), raza?.trim() ?? null, color?.trim() ?? null,
         fecha_nacimiento ?? null, sexoFinal, castrado ?? null,
         peso_kg ?? null, microchip?.trim() ?? null, pasaporte_num?.trim() ?? null,
         alergias?.trim() ?? null, observaciones?.trim() ?? null, foto_url?.trim() ?? null]
      );

      res.status(201).json(ok({ id: result.insertId, nombre, especie }));
    } catch (e) { next(e); }
  });

  // ── PATCH /:id — actualizar paciente ────────────────────────────────────
  r.patch("/:id", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getCtx(req);
      requireRole(ctx, "admin", "vet", "staff");

      const id = parseInt(req.params.id);
      if (!id || isNaN(id)) throw new AppError("VALIDATION_ERROR", "ID inválido");

      // Verificar que existe y pertenece al tenant
      const [existing] = await ctx.tenantPool.query<any[]>(
        "SELECT id FROM pacientes WHERE id=? AND tenant_id=? AND is_active=1",
        [id, ctx.tenantId]
      );
      if (!existing[0]) throw new AppError("NOT_FOUND", "Paciente no encontrado");

      const allowed = ["nombre","especie","raza","sexo","color","fecha_nacimiento",
                       "castrado","peso_kg","microchip","pasaporte_num","alergias",
                       "observaciones","foto_url","propietario_id","sucursal_id"];
      const updates: string[] = [];
      const vals: any[] = [];

      for (const key of allowed) {
        if (key in req.body) {
          updates.push(`${key} = ?`);
          vals.push(req.body[key]);
        }
      }

      if (!updates.length) throw new AppError("VALIDATION_ERROR", "No hay campos a actualizar");

      vals.push(id, ctx.tenantId);
      await ctx.tenantPool.query(
        `UPDATE pacientes SET ${updates.join(", ")} WHERE id=? AND tenant_id=?`,
        vals
      );

      res.json(ok({ id, updated: true }));
    } catch (e) { next(e); }
  });

  // ── DELETE /:id — baja lógica ───────────────────────────────────────────
  r.delete("/:id", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getCtx(req);
      requireRole(ctx, "admin", "vet");

      const id = parseInt(req.params.id);
      if (!id || isNaN(id)) throw new AppError("VALIDATION_ERROR", "ID inválido");

      await ctx.tenantPool.query(
        "UPDATE pacientes SET is_active=0 WHERE id=? AND tenant_id=?",
        [id, ctx.tenantId]
      );

      res.json(ok({ id, deleted: true }));
    } catch (e) { next(e); }
  });

  // ── GET /:id/historial — historial clínico paginado ─────────────────────
  r.get("/:id/historial", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getCtx(req);
      const id = parseInt(req.params.id);
      if (!id || isNaN(id)) throw new AppError("VALIDATION_ERROR", "ID inválido");

      const page  = Math.max(1, parseInt(String(req.query.page  ?? "1")));
      const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? "20"))));
      const offset = (page - 1) * limit;

      // Verificar pertenencia al tenant
      const [pac] = await ctx.tenantPool.query<any[]>(
        "SELECT id, nombre, especie FROM pacientes WHERE id=? AND tenant_id=? AND is_active=1",
        [id, ctx.tenantId]
      );
      if (!pac[0]) throw new AppError("NOT_FOUND", "Paciente no encontrado");

      // Consultas (SOAP)
      const [consultas] = await ctx.tenantPool.query<any[]>(
        `SELECT
           c.id, c.fecha, c.motivo, c.diagnostico, c.tratamiento,
           c.temperatura, c.peso_kg, c.frecuencia_cardiaca,
           c.proxima_consulta, c.requiere_internacion,
           CONCAT(v.nombre, ' ', v.apellido) AS veterinario_nombre
         FROM consultas c
         LEFT JOIN veterinarios v ON v.id = c.veterinario_id
         WHERE c.paciente_id=? AND c.tenant_id=? AND c.is_active=1
         ORDER BY c.fecha DESC
         LIMIT ? OFFSET ?`,
        [id, ctx.tenantId, limit, offset]
      );

      // Vacunas
      const [vacunas] = await ctx.tenantPool.query<any[]>(
        `SELECT id, nombre_vacuna, fecha_aplicacion, proxima_dosis, lote, laboratorio
         FROM vacunas WHERE paciente_id=? AND tenant_id=?
         ORDER BY fecha_aplicacion DESC LIMIT 20`,
        [id, ctx.tenantId]
      );

      // Desparasitaciones
      const [desparasitaciones] = await ctx.tenantPool.query<any[]>(
        `SELECT id, producto, dosis_mg, fecha_aplicacion, proxima_dosis, via
         FROM desparasitaciones WHERE paciente_id=? AND tenant_id=?
         ORDER BY fecha_aplicacion DESC LIMIT 20`,
        [id, ctx.tenantId]
      );

      // Prescripciones recientes
      const [prescripciones] = await ctx.tenantPool.query<any[]>(
        `SELECT p.id, p.medicamento, p.dosis, p.frecuencia, p.duracion_dias, p.fecha, p.instrucciones
         FROM prescripciones p
         WHERE p.paciente_id=? AND p.tenant_id=?
         ORDER BY p.fecha DESC LIMIT 10`,
        [id, ctx.tenantId]
      );

      const [[{ total }]] = await ctx.tenantPool.query<any[]>(
        "SELECT COUNT(*) AS total FROM consultas WHERE paciente_id=? AND tenant_id=? AND is_active=1",
        [id, ctx.tenantId]
      );

      res.json(ok({
        paciente: pac[0],
        consultas,
        vacunas,
        desparasitaciones,
        prescripciones,
      }, { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) }));
    } catch (e) { next(e); }
  });

  // ── GET /:id/ficha — ficha completa para PDF ────────────────────────────
  r.get("/:id/ficha", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getCtx(req);
      const id = parseInt(req.params.id);
      if (!id || isNaN(id)) throw new AppError("VALIDATION_ERROR", "ID inválido");

      const [pac] = await ctx.tenantPool.query<any[]>(
        `SELECT p.*, CONCAT(prop.nombre,' ',prop.apellido) AS propietario_nombre,
                prop.telefono AS propietario_telefono, prop.email AS propietario_email,
                prop.direccion AS propietario_direccion
         FROM pacientes p
         LEFT JOIN propietarios prop ON prop.id = p.propietario_id
         WHERE p.id=? AND p.tenant_id=? AND p.is_active=1`,
        [id, ctx.tenantId]
      );
      if (!pac[0]) throw new AppError("NOT_FOUND", "Paciente no encontrado");

      const [consultas] = await ctx.tenantPool.query<any[]>(
        `SELECT c.*, CONCAT(v.nombre,' ',v.apellido) AS veterinario_nombre
         FROM consultas c LEFT JOIN veterinarios v ON v.id=c.veterinario_id
         WHERE c.paciente_id=? AND c.tenant_id=? AND c.is_active=1
         ORDER BY c.fecha DESC LIMIT 10`,
        [id, ctx.tenantId]
      );

      const [vacunas]          = await ctx.tenantPool.query<any[]>(
        "SELECT * FROM vacunas WHERE paciente_id=? AND tenant_id=? ORDER BY fecha_aplicacion DESC",
        [id, ctx.tenantId]
      );
      const [desparasitaciones] = await ctx.tenantPool.query<any[]>(
        "SELECT * FROM desparasitaciones WHERE paciente_id=? AND tenant_id=? ORDER BY fecha_aplicacion DESC",
        [id, ctx.tenantId]
      );
      const [prescripciones]   = await ctx.tenantPool.query<any[]>(
        "SELECT p.*, CONCAT(v.nombre,' ',v.apellido) AS veterinario_nombre FROM prescripciones p LEFT JOIN veterinarios v ON v.id=p.veterinario_id WHERE p.paciente_id=? AND p.tenant_id=? ORDER BY p.fecha DESC",
        [id, ctx.tenantId]
      );

      res.json(ok({
        paciente: pac[0],
        consultas,
        vacunas,
        desparasitaciones,
        prescripciones,
        generado_at: new Date().toISOString(),
      }));
    } catch (e) { next(e); }
  });

  // ── POST /:id/peso — registro rápido de peso ────────────────────────────
  r.post("/:id/peso", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getCtx(req);
      requireRole(ctx, "admin", "vet", "staff");

      const id = parseInt(req.params.id);
      if (!id || isNaN(id)) throw new AppError("VALIDATION_ERROR", "ID inválido");
      const { peso_kg } = req.body;
      if (!peso_kg || isNaN(parseFloat(peso_kg))) throw new AppError("VALIDATION_ERROR", "peso_kg requerido");

      await ctx.tenantPool.query(
        "UPDATE pacientes SET peso_kg=? WHERE id=? AND tenant_id=?",
        [parseFloat(peso_kg), id, ctx.tenantId]
      );

      res.json(ok({ id, peso_kg: parseFloat(peso_kg), registrado_at: new Date().toISOString() }));
    } catch (e) { next(e); }
  });

  return r;
}
