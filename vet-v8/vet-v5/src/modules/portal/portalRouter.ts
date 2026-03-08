/**
 * Portal del Propietario — plan: pro+
 *
 * Login separado para los dueños de mascotas.
 * Reciben un JWT con rol "owner" y solo pueden ver SUS datos.
 *
 * Endpoints:
 *   POST /api/v1/portal/login
 *   GET  /api/v1/portal/me
 *   GET  /api/v1/portal/mis-mascotas
 *   GET  /api/v1/portal/mis-turnos
 *   GET  /api/v1/portal/mis-mascotas/:id/vacunas
 *   GET  /api/v1/portal/mis-mascotas/:id/historial
 */

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

export function buildPortalRouter(opts: {
  redis: Redis;
  config: AppConfig;
  jwtService: JwtService;
  featureFlags?: any;
}) {
  const router = Router();
  const rl = buildRateLimiter({ config: opts.config, redis: opts.redis });

  const PORTAL_SESSION_TTL = 60 * 60 * 24; // 24h

  function portalSessionKey(tenantId: string, propietarioId: number, sessionId: string) {
    return `portal_sess:${tenantId}:${propietarioId}:${sessionId}`;
  }

  /** POST /api/v1/portal/login */
  router.post("/login", rl.auth(), requireModule("portal_propietario", opts), async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      const { email, password } = z.object({
        email: z.string().email(),
        password: z.string().min(1),
      }).parse(req.body ?? {});

      const [rows] = await ctx.tenantPool.query<any[]>(
        `SELECT id, email, password_hash, nombre, apellido, telefono FROM propietarios
         WHERE email=? AND tenant_id=? AND is_active=1 LIMIT 1`,
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

  // ── All routes below require portal session ────────────────────────────────

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
      const ctx = (req as any).ctx;
      const propId = ctx.propietarioId ?? Number(ctx.userId);
      const [rows] = await ctx.tenantPool.query<any[]>(
        "SELECT id, nombre, apellido, email, telefono, ciudad FROM propietarios WHERE id=? AND tenant_id=? LIMIT 1",
        [propId, ctx.tenantId]
      );
      if (!rows?.length) throw new AppError("NOT_FOUND", "Propietario no encontrado");
      res.json({ data: rows[0], meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  /** GET /api/v1/portal/mis-mascotas */
  router.get("/mis-mascotas", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
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
      const ctx = (req as any).ctx;
      const propId = Number(ctx.userId);
      const [rows] = await ctx.tenantPool.query<any[]>(
        `SELECT t.id, t.fecha_hora, t.duracion_min, t.motivo, t.estado,
                v.nombre as vet_nombre, v.apellido as vet_apellido,
                p.nombre as paciente, p.especie
         FROM turnos t
         LEFT JOIN veterinarios v ON v.id=t.veterinario_id
         LEFT JOIN pacientes p ON p.id=t.paciente_id
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
      const ctx = (req as any).ctx;
      const propId = Number(ctx.userId);
      const pacienteId = Number(req.params.id);

      // Verify ownership
      const [own] = await ctx.tenantPool.query<any[]>(
        "SELECT id FROM pacientes WHERE id=? AND propietario_id=? AND tenant_id=? LIMIT 1",
        [pacienteId, propId, ctx.tenantId]
      );
      if (!own?.length) throw new AppError("FORBIDDEN", "No tienes acceso a este paciente");

      const [rows] = await ctx.tenantPool.query<any[]>(
        "SELECT nombre, fecha_aplicacion, fecha_vencimiento, proxima_dosis, laboratorio FROM vacunas WHERE paciente_id=? ORDER BY fecha_aplicacion DESC",
        [pacienteId]
      );
      res.json({ data: rows, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  /** GET /api/v1/portal/mis-mascotas/:id/historial */
  router.get("/mis-mascotas/:id/historial", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      const propId = Number(ctx.userId);
      const pacienteId = Number(req.params.id);

      const [own] = await ctx.tenantPool.query<any[]>(
        "SELECT id FROM pacientes WHERE id=? AND propietario_id=? AND tenant_id=? LIMIT 1",
        [pacienteId, propId, ctx.tenantId]
      );
      if (!own?.length) throw new AppError("FORBIDDEN", "No tienes acceso a este paciente");

      // Only return non-sensitive clinical data for the owner
      const [rows] = await ctx.tenantPool.query<any[]>(
        `SELECT c.id, c.fecha, c.motivo, c.diagnostico, c.tratamiento, c.proxima_consulta,
                v.nombre as vet_nombre, v.apellido as vet_apellido
         FROM consultas c
         LEFT JOIN veterinarios v ON v.id=c.veterinario_id
         WHERE c.paciente_id=? AND c.tenant_id=?
         ORDER BY c.fecha DESC LIMIT 30`,
        [pacienteId, ctx.tenantId]
      );
      res.json({ data: rows, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  /** POST /api/v1/portal/register — self-registration for owners */
  router.post("/register", rl.auth(), async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;

      // Check if plan allows portal
      await requireModule("portal_propietario", opts)(req as any, res, next);

      const body = z.object({
        nombre: z.string().min(1).max(128),
        apellido: z.string().min(1).max(128),
        email: z.string().email(),
        password: z.string().min(8).max(128),
        telefono: z.string().max(32).optional(),
      }).parse(req.body ?? {});

      // Verify email not already registered
      const [existing] = await ctx.tenantPool.query<any[]>(
        "SELECT id FROM propietarios WHERE email=? AND tenant_id=? LIMIT 1",
        [body.email.toLowerCase().trim(), ctx.tenantId]
      );

      if (existing?.length) {
        // Don't reveal if email exists — just say "check email for next steps"
        return res.json({ data: { ok: true }, meta: { requestId: (req as any).id }, errors: [] });
      }

      const hash = await bcrypt.hash(body.password, 12);
      const [result] = await ctx.tenantPool.query<any>(
        `INSERT INTO propietarios (tenant_id, nombre, apellido, email, password_hash, telefono)
         VALUES (?,?,?,?,?,?)`,
        [ctx.tenantId, body.nombre, body.apellido, body.email.toLowerCase().trim(), hash, body.telefono ?? null]
      );

      // Send welcome email
      const q = new Queue("jobs", { connection: opts.redis });
      await q.add("send-email", {
        to: body.email,
        subject: "Bienvenido al portal — VetPro",
        body: `Hola ${body.nombre}, ya podés acceder al portal para ver los turnos y la historia clínica de tus mascotas.`,
        tenantId: ctx.tenantId,
      });

      return res.status(201).json({ data: { id: Number(result.insertId) }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  return router;
}
