import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import type Redis from "ioredis";
import { AppError } from "../../core/errors/appError.js";
import { requireModule } from "../../infra/plan-limits/planGuard.js";
import type { JwtService } from "../../security/auth/jwtService.js";
import type { AppConfig } from "../../config/types.js";
import { buildRateLimiter } from "../../infra/rate-limit/rateLimiter.js";
import { Queue } from "bullmq";
import { getCtx, getRequestId, ok } from "../../core/http/requestCtx.js";

export function buildPortalRouter(opts: {
  redis: Redis;
  config: AppConfig;
  jwtService: JwtService;
  featureFlags?: any;
}) {
  const router = Router();
  const rl = buildRateLimiter({ config: opts.config, redis: opts.redis });
  const PORTAL_SESSION_TTL = 60 * 60 * 24;

  function portalSessionKey(tenantId: string, propietarioId: number, sessionId: string) {
    return `portal_sess:${tenantId}:${propietarioId}:${sessionId}`;
  }

  // ── Rutas públicas del portal (no requieren JWT de clínica) ──────────────

  /** POST /api/v1/portal/login */
  router.post("/login", rl.auth(), requireModule("portal_propietario", opts), async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      const { email, password } = z.object({
        email: z.string().email(),
        password: z.string().min(1),
      }).parse(req.body ?? {});

      const [rows] = await ctx.tenantPool.query<any[]>(
        `SELECT id, email, password_hash, nombre, apellido, telefono
         FROM propietarios WHERE email=? AND tenant_id=? AND is_active=1 LIMIT 1`,
        [email.toLowerCase().trim(), ctx.tenantId]
      );
      const propietario = rows?.[0];
      if (!propietario?.password_hash) {
        throw new AppError("AUTH_REQUIRED", "Email o contraseña incorrectos");
      }

      const valid = await bcrypt.compare(password, String(propietario.password_hash));
      if (!valid) throw new AppError("AUTH_REQUIRED", "Email o contraseña incorrectos");

      const sessionId = nanoid();
      await opts.redis.set(
        portalSessionKey(ctx.tenantId, propietario.id, sessionId),
        "1", "EX", PORTAL_SESSION_TTL
      );

      const token = await opts.jwtService.signAccess({
        sid: sessionId,
        sub: String(propietario.id),
        tid: ctx.tenantId,
        roles: ["owner"],
        extra: { propietarioId: propietario.id, portal: true },
        tokenVersion: 0,
        sucursalId: null,
        veterinarioId: null,
      });

      return res.json({
        data: {
          token,
          propietario: {
            id: propietario.id,
            nombre: propietario.nombre,
            apellido: propietario.apellido,
            email: propietario.email,
          },
        },
        meta: { requestId: (req as any).id },
        errors: [],
      });
    } catch (e) { next(e); }
  });

  /**
   * POST /api/v1/portal/register
   * FIX: requireModule aplicado como middleware de ruta, no llamado manualmente
   */
  router.post(
    "/register",
    rl.auth(),
    requireModule("portal_propietario", opts),  // FIX: como middleware, no await
    async (req, res, next) => {
      try {
        const ctx = getCtx(req);
        const body = z.object({
          nombre: z.string().min(1).max(128),
          apellido: z.string().min(1).max(128),
          email: z.string().email(),
          password: z.string().min(8).max(128),
          telefono: z.string().max(32).optional(),
        }).parse(req.body ?? {});

        // No revelar si el email ya existe
        const [existing] = await ctx.tenantPool.query<any[]>(
          "SELECT id FROM propietarios WHERE email=? AND tenant_id=? LIMIT 1",
          [body.email.toLowerCase().trim(), ctx.tenantId]
        );
        if (existing?.length) {
          return res.json({ data: { ok: true }, meta: { requestId: (req as any).id }, errors: [] });
        }

        const hash = await bcrypt.hash(body.password, 12);
        const [result] = await ctx.tenantPool.query<any>(
          `INSERT INTO propietarios (tenant_id, nombre, apellido, email, password_hash, telefono)
           VALUES (?,?,?,?,?,?)`,
          [ctx.tenantId, body.nombre, body.apellido, body.email.toLowerCase().trim(), hash, body.telefono ?? null]
        );

        const q = new Queue("jobs", { connection: opts.redis });
        await q.add("send-email", {
          to: body.email,
          subject: "Bienvenido al portal — VetPro",
          body: `Hola ${body.nombre}, ya podés acceder al portal para ver los turnos y la historia clínica de tus mascotas.`,
          tenantId: ctx.tenantId,
        });

        return res.status(201).json({ data: { id: Number(result.insertId) }, meta: { requestId: (req as any).id }, errors: [] });
      } catch (e) { next(e); }
    }
  );

  // ── Rutas autenticadas del portal (requieren JWT con rol "owner") ─────────

  function requireOwner(req: any, _res: any, next: any) {
    if (!req.ctx?.roles?.includes("owner")) {
      return next(new AppError("FORBIDDEN", "Solo para propietarios"));
    }
    next();
  }

  router.use(requireOwner);

  /** GET /api/v1/portal/me */
  router.get("/me", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      const propId = Number(ctx.userId);
      const [rows] = await ctx.tenantPool.query<any[]>(
        "SELECT id, nombre, apellido, email, telefono, ciudad FROM propietarios WHERE id=? AND tenant_id=? LIMIT 1",
        [propId, ctx.tenantId]
      );
      if (!rows?.length) throw new AppError("NOT_FOUND", "Propietario no encontrado");
      res.json({ data: rows[0], meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  /** PATCH /api/v1/portal/me — propietario puede actualizar su propio perfil */
  router.patch("/me", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      const propId = Number(ctx.userId);
      const body = z.object({
        telefono: z.string().max(32).optional(),
        ciudad: z.string().max(128).optional(),
      }).parse(req.body ?? {});

      const fields: string[] = [];
      const values: any[] = [];
      if (body.telefono !== undefined) { fields.push("telefono=?"); values.push(body.telefono); }
      if (body.ciudad   !== undefined) { fields.push("ciudad=?");   values.push(body.ciudad); }
      if (!fields.length) throw new AppError("VALIDATION_ERROR", "Nada que actualizar");
      fields.push("updated_at=NOW()");
      values.push(propId, ctx.tenantId);

      await ctx.tenantPool.query(`UPDATE propietarios SET ${fields.join(",")} WHERE id=? AND tenant_id=?`, values);
      res.json({ data: { ok: true }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  /** GET /api/v1/portal/mis-mascotas */
  router.get("/mis-mascotas", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      const propId = Number(ctx.userId);
      const [rows] = await ctx.tenantPool.query<any[]>(
        `SELECT id, nombre, especie, raza, sexo, fecha_nacimiento, microchip, foto_url
         FROM pacientes WHERE propietario_id=? AND tenant_id=? AND is_active=1`,
        [propId, ctx.tenantId]
      );
      res.json({ data: rows, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  /** GET /api/v1/portal/mis-turnos */
  router.get("/mis-turnos", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      const propId = Number(ctx.userId);
      const [rows] = await ctx.tenantPool.query<any[]>(
        `SELECT t.id, t.fecha_hora, t.duracion_min, t.motivo, t.estado,
                v.nombre as vet_nombre, v.apellido as vet_apellido,
                p.nombre as paciente, p.especie
         FROM turnos t
         LEFT JOIN veterinarios v  ON v.id  = t.veterinario_id
         LEFT JOIN pacientes p     ON p.id  = t.paciente_id
         WHERE t.propietario_id=? AND t.tenant_id=?
           AND t.fecha_hora >= DATE_SUB(NOW(), INTERVAL 3 MONTH)
         ORDER BY t.fecha_hora DESC LIMIT 50`,
        [propId, ctx.tenantId]
      );
      res.json({ data: rows, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  /** GET /api/v1/portal/mis-mascotas/:id/vacunas */
  router.get("/mis-mascotas/:id/vacunas", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      const propId = Number(ctx.userId);
      const pacienteId = Number(req.params.id);

      const [own] = await ctx.tenantPool.query<any[]>(
        "SELECT id FROM pacientes WHERE id=? AND propietario_id=? AND tenant_id=? LIMIT 1",
        [pacienteId, propId, ctx.tenantId]
      );
      if (!own?.length) throw new AppError("FORBIDDEN", "No tenés acceso a este paciente");

      const [rows] = await ctx.tenantPool.query<any[]>(
        "SELECT nombre, fecha_aplicacion, fecha_vencimiento, proxima_dosis, laboratorio FROM vacunas WHERE paciente_id=? AND is_active=1 ORDER BY fecha_aplicacion DESC",
        [pacienteId]
      );
      res.json({ data: rows, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  /** GET /api/v1/portal/mis-mascotas/:id/historial */
  router.get("/mis-mascotas/:id/historial", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      const propId = Number(ctx.userId);
      const pacienteId = Number(req.params.id);

      const [own] = await ctx.tenantPool.query<any[]>(
        "SELECT id FROM pacientes WHERE id=? AND propietario_id=? AND tenant_id=? LIMIT 1",
        [pacienteId, propId, ctx.tenantId]
      );
      if (!own?.length) throw new AppError("FORBIDDEN", "No tenés acceso a este paciente");

      // Solo campos no sensibles para el propietario
      const [rows] = await ctx.tenantPool.query<any[]>(
        `SELECT c.id, c.fecha, c.motivo, c.diagnostico, c.tratamiento, c.proxima_consulta,
                v.nombre as vet_nombre, v.apellido as vet_apellido
         FROM consultas c
         LEFT JOIN veterinarios v ON v.id=c.veterinario_id
         WHERE c.paciente_id=? AND c.tenant_id=? AND c.is_active=1
         ORDER BY c.fecha DESC LIMIT 30`,
        [pacienteId, ctx.tenantId]
      );
      res.json({ data: rows, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });


  /** POST /api/v1/portal/turnos — propietario solicita un turno */
  router.post("/turnos", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      const propId = Number(ctx.userId);

      const body = z.object({
        veterinario_id: z.coerce.number().int().positive(),
        paciente_id:    z.coerce.number().int().positive(),
        fecha_hora:     z.string().min(16),
        duracion_min:   z.coerce.number().int().min(5).max(120).default(30),
        motivo:         z.string().min(1).max(255).optional(),
      }).parse(req.body ?? {});

      // Verificar que el paciente le pertenece
      const [own] = await ctx.tenantPool.query<any[]>(
        "SELECT id FROM pacientes WHERE id=? AND propietario_id=? AND tenant_id=? AND is_active=1 LIMIT 1",
        [body.paciente_id, propId, ctx.tenantId]
      );
      if (!own?.length) throw new AppError("FORBIDDEN", "No tenés acceso a este paciente");

      // Verificar que no hay conflicto con el veterinario
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
      if (conflicts?.length) {
        throw new AppError("CONFLICT", "El veterinario ya tiene un turno en ese horario. Por favor elegí otro.");
      }

      const [result] = await ctx.tenantPool.query<any>(
        `INSERT INTO turnos (tenant_id, veterinario_id, paciente_id, propietario_id,
                              fecha_hora, duracion_min, motivo, estado)
         VALUES (?,?,?,?,?,?,?,'pendiente')`,
        [ctx.tenantId, body.veterinario_id, body.paciente_id, propId,
         body.fecha_hora, body.duracion_min, body.motivo ?? null]
      );
      const turnoId = Number(result.insertId);

      // Encolar email de confirmación al propietario
      const q = new Queue("jobs", { connection: opts.redis });
      const [propRows] = await ctx.tenantPool.query<any[]>(
        "SELECT email, nombre FROM propietarios WHERE id=? LIMIT 1", [propId]
      );
      if (propRows?.[0]?.email) {
        const [vetRows] = await ctx.tenantPool.query<any[]>(
          "SELECT nombre, apellido FROM veterinarios WHERE id=? LIMIT 1", [body.veterinario_id]
        );
        const vet = vetRows?.[0];
        await q.add("send-email", {
          to: propRows[0].email,
          subject: "Turno solicitado — VetPro",
          body: `Hola ${propRows[0].nombre}, tu turno para el ${body.fecha_hora} con Dr. ${vet?.nombre ?? ""} ${vet?.apellido ?? ""} fue registrado correctamente. Estado: pendiente de confirmación.`,
          tenantId: ctx.tenantId,
        });
      }

      res.status(201).json({ data: { id: turnoId, estado: "pendiente" }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  /** DELETE /api/v1/portal/turnos/:id — propietario cancela su turno (solo pendiente/confirmado) */
  router.delete("/turnos/:id", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      const propId  = Number(ctx.userId);
      const turnoId = Number(req.params.id);

      const [rows] = await ctx.tenantPool.query<any[]>(
        "SELECT id, estado FROM turnos WHERE id=? AND propietario_id=? AND tenant_id=? LIMIT 1",
        [turnoId, propId, ctx.tenantId]
      );
      if (!rows?.length) throw new AppError("NOT_FOUND", "Turno no encontrado");
      if (!["pendiente","confirmado"].includes(rows[0].estado)) {
        throw new AppError("CONFLICT", "Solo podés cancelar turnos pendientes o confirmados");
      }

      await ctx.tenantPool.query(
        "UPDATE turnos SET estado='cancelado', updated_at=NOW() WHERE id=? AND tenant_id=?",
        [turnoId, ctx.tenantId]
      );

      res.json({ data: { ok: true }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  /** POST /api/v1/portal/logout — invalida sesión del portal */
  router.post("/logout", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      const propId = Number(ctx.userId);
      const sessionId = String(ctx.sessionId ?? "");
      if (sessionId) {
        await opts.redis.del(portalSessionKey(ctx.tenantId, propId, sessionId));
      }
      res.json({ data: { ok: true }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  return router;
}
