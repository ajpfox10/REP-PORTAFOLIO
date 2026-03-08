/**
 * dashboardRouter — v11  (Punto 8)
 *
 * KPIs del negocio:
 *   - Consultas por día/semana/mes
 *   - Tasa de cancelación de turnos
 *   - Revenue por sucursal
 *   - Ocupación de agenda
 *   - Top diagnósticos
 *   - Pacientes nuevos vs recurrentes
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { getCtx, requireRole, ok } from "../../core/context.js";
import { AppError } from "../../core/errors/appError.js";

export function buildDashboardRouter(_deps?: { redis?: any; featureFlags?: any }): Router {
  const r = Router();

  // ── GET /resumen — métricas generales del período ────────────────────────
  r.get("/resumen", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getCtx(req);
      requireRole(ctx, "admin", "staff", "vet");

      const { desde, hasta } = parsePeriodo(req);

      const params = [ctx.tenantId, desde, hasta];

      const [[consultas]]  = await ctx.tenantPool.query<any[]>(
        "SELECT COUNT(*) AS total FROM consultas WHERE tenant_id=? AND fecha BETWEEN ? AND ? AND is_active=1", params
      );
      const [[turnos]]     = await ctx.tenantPool.query<any[]>(
        "SELECT COUNT(*) AS total FROM turnos WHERE tenant_id=? AND fecha_hora BETWEEN ? AND ?", params
      );
      const [[cancelados]] = await ctx.tenantPool.query<any[]>(
        "SELECT COUNT(*) AS total FROM turnos WHERE tenant_id=? AND fecha_hora BETWEEN ? AND ? AND estado='cancelado'", params
      );
      const [[revenue]]    = await ctx.tenantPool.query<any[]>(
        "SELECT COALESCE(SUM(total_cents),0) AS total FROM facturas WHERE tenant_id=? AND emitida_at BETWEEN ? AND ? AND estado IN ('pagada','emitida')", params
      );
      const [[pacientesNuevos]] = await ctx.tenantPool.query<any[]>(
        "SELECT COUNT(*) AS total FROM pacientes WHERE tenant_id=? AND created_at BETWEEN ? AND ?", params
      );

      const tasaCancelacion = turnos.total > 0
        ? Math.round((cancelados.total / turnos.total) * 100)
        : 0;

      res.json(ok({
        periodo: { desde, hasta },
        consultas:         Number(consultas.total),
        turnos_totales:    Number(turnos.total),
        tasa_cancelacion:  tasaCancelacion,
        revenue_cents:     Number(revenue.total),
        pacientes_nuevos:  Number(pacientesNuevos.total),
      }));
    } catch (e) { next(e); }
  });

  // ── GET /consultas-por-dia — serie temporal ──────────────────────────────
  r.get("/consultas-por-dia", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getCtx(req);
      requireRole(ctx, "admin", "staff", "vet");

      const { desde, hasta } = parsePeriodo(req);

      const [rows] = await ctx.tenantPool.query<any[]>(
        `SELECT DATE(fecha) AS dia, COUNT(*) AS total
         FROM consultas
         WHERE tenant_id=? AND fecha BETWEEN ? AND ? AND is_active=1
         GROUP BY DATE(fecha)
         ORDER BY dia ASC`,
        [ctx.tenantId, desde, hasta]
      );

      res.json(ok(rows));
    } catch (e) { next(e); }
  });

  // ── GET /revenue-por-sucursal ────────────────────────────────────────────
  r.get("/revenue-por-sucursal", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getCtx(req);
      requireRole(ctx, "admin");

      const { desde, hasta } = parsePeriodo(req);

      const [rows] = await ctx.tenantPool.query<any[]>(
        `SELECT
           COALESCE(s.nombre, 'Sin sucursal') AS sucursal,
           COUNT(f.id)           AS facturas,
           SUM(f.total_cents)    AS revenue_cents,
           AVG(f.total_cents)    AS ticket_promedio_cents
         FROM facturas f
         LEFT JOIN sucursales s ON s.id=f.sucursal_id
         WHERE f.tenant_id=? AND f.emitida_at BETWEEN ? AND ?
           AND f.estado IN ('pagada','emitida')
         GROUP BY f.sucursal_id
         ORDER BY revenue_cents DESC`,
        [ctx.tenantId, desde, hasta]
      );

      res.json(ok(rows));
    } catch (e) { next(e); }
  });

  // ── GET /ocupacion-agenda — % de ocupación por veterinario ───────────────
  r.get("/ocupacion-agenda", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getCtx(req);
      requireRole(ctx, "admin", "staff");

      const { desde, hasta } = parsePeriodo(req);

      const [rows] = await ctx.tenantPool.query<any[]>(
        `SELECT
           CONCAT(v.nombre,' ',v.apellido) AS veterinario,
           COUNT(t.id)   AS turnos_totales,
           SUM(CASE WHEN t.estado='completado' THEN 1 ELSE 0 END) AS completados,
           SUM(CASE WHEN t.estado='cancelado'  THEN 1 ELSE 0 END) AS cancelados,
           SUM(CASE WHEN t.estado='no_show'    THEN 1 ELSE 0 END) AS no_show,
           ROUND(SUM(CASE WHEN t.estado='completado' THEN 1 ELSE 0 END) * 100.0 / COUNT(t.id), 1) AS tasa_ocupacion
         FROM turnos t
         JOIN veterinarios v ON v.id=t.veterinario_id
         WHERE t.tenant_id=? AND t.fecha_hora BETWEEN ? AND ?
         GROUP BY t.veterinario_id
         ORDER BY tasa_ocupacion DESC`,
        [ctx.tenantId, desde, hasta]
      );

      res.json(ok(rows));
    } catch (e) { next(e); }
  });

  // ── GET /top-diagnosticos ────────────────────────────────────────────────
  r.get("/top-diagnosticos", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getCtx(req);
      requireRole(ctx, "admin", "vet");

      const { desde, hasta } = parsePeriodo(req);
      const limit = Math.min(20, parseInt(String(req.query.limit ?? "10")));

      const [rows] = await ctx.tenantPool.query<any[]>(
        `SELECT
           diagnostico, COUNT(*) AS total,
           GROUP_CONCAT(DISTINCT especie ORDER BY especie) AS especies
         FROM consultas c
         JOIN pacientes p ON p.id=c.paciente_id
         WHERE c.tenant_id=? AND c.fecha BETWEEN ? AND ?
           AND c.diagnostico IS NOT NULL AND c.diagnostico != ''
           AND c.is_active=1
         GROUP BY diagnostico
         ORDER BY total DESC
         LIMIT ?`,
        [ctx.tenantId, desde, hasta, limit]
      );

      res.json(ok(rows, { limit }));
    } catch (e) { next(e); }
  });

  // ── GET /top-especies ────────────────────────────────────────────────────
  r.get("/top-especies", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getCtx(req);
      const [rows] = await ctx.tenantPool.query<any[]>(
        `SELECT especie, COUNT(*) AS total
         FROM pacientes
         WHERE tenant_id=? AND is_active=1
         GROUP BY especie ORDER BY total DESC LIMIT 10`,
        [ctx.tenantId]
      );
      res.json(ok(rows));
    } catch (e) { next(e); }
  });

  // ── GET /pacientes-nuevos-vs-recurrentes ─────────────────────────────────
  r.get("/pacientes-nuevos-vs-recurrentes", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getCtx(req);
      requireRole(ctx, "admin", "vet", "staff");

      const { desde, hasta } = parsePeriodo(req);

      const [[nuevos]] = await ctx.tenantPool.query<any[]>(
        "SELECT COUNT(DISTINCT c.paciente_id) AS total FROM consultas c JOIN pacientes p ON p.id=c.paciente_id WHERE c.tenant_id=? AND c.fecha BETWEEN ? AND ? AND p.created_at BETWEEN ? AND ? AND c.is_active=1",
        [ctx.tenantId, desde, hasta, desde, hasta]
      );

      const [[recurrentes]] = await ctx.tenantPool.query<any[]>(
        "SELECT COUNT(DISTINCT c.paciente_id) AS total FROM consultas c JOIN pacientes p ON p.id=c.paciente_id WHERE c.tenant_id=? AND c.fecha BETWEEN ? AND ? AND p.created_at < ? AND c.is_active=1",
        [ctx.tenantId, desde, hasta, desde]
      );

      res.json(ok({
        periodo: { desde, hasta },
        nuevos: Number(nuevos.total),
        recurrentes: Number(recurrentes.total),
        total: Number(nuevos.total) + Number(recurrentes.total),
      }));
    } catch (e) { next(e); }
  });

  return r;
}

// ── Helper: parse período de query params ─────────────────────────────────────
function parsePeriodo(req: Request): { desde: string; hasta: string } {
  const now   = new Date();
  const hasta = req.query.hasta ? String(req.query.hasta) : now.toISOString().slice(0, 10);
  let desde: string;

  if (req.query.desde) {
    desde = String(req.query.desde);
  } else {
    // Default: último mes
    const d = new Date(now);
    d.setMonth(d.getMonth() - 1);
    desde = d.toISOString().slice(0, 10);
  }

  if (desde > hasta) throw new AppError("VALIDATION_ERROR", "desde no puede ser mayor a hasta");
  return { desde, hasta };
}
