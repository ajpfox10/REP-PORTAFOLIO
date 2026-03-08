/**
 * Dashboard de métricas — plan: pro+
 *
 * Queries optimizadas con índices existentes.
 * Cachea resultados en Redis por 5 min para no saturar el DB.
 */

import { Router } from "express";
import type Redis from "ioredis";
import { requireModule } from "../../infra/plan-limits/planGuard.js";

export function buildDashboardRouter(opts: { redis: Redis; featureFlags?: any }) {
  const router = Router();

  router.use(requireModule("dashboard_metricas", opts));

  const CACHE_TTL = 300; // 5 min

  async function cached<T>(redis: Redis, key: string, fn: () => Promise<T>): Promise<T> {
    const hit = await redis.get(key).catch(() => null);
    if (hit) return JSON.parse(hit) as T;
    const data = await fn();
    await redis.set(key, JSON.stringify(data), "EX", CACHE_TTL).catch(() => {});
    return data;
  }

  /**
   * GET /api/v1/dashboard/resumen
   * Returns daily/monthly KPIs for the clinic.
   */
  router.get("/resumen", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      const tenantId = ctx.tenantId;

      const data = await cached(opts.redis, `dash:resumen:${tenantId}`, async () => {
        const pool = ctx.tenantPool;

        const [[turnos_hoy]] = await pool.query<any[]>(
          "SELECT COUNT(*) as total FROM turnos WHERE tenant_id=? AND DATE(fecha_hora)=CURDATE() AND estado NOT IN ('cancelado')",
          [tenantId]
        );
        const [[turnos_mes]] = await pool.query<any[]>(
          "SELECT COUNT(*) as total FROM turnos WHERE tenant_id=? AND MONTH(fecha_hora)=MONTH(CURDATE()) AND YEAR(fecha_hora)=YEAR(CURDATE())",
          [tenantId]
        );
        const [[pacientes_total]] = await pool.query<any[]>(
          "SELECT COUNT(*) as total FROM pacientes WHERE tenant_id=? AND is_active=1",
          [tenantId]
        );
        const [[pacientes_nuevos_mes]] = await pool.query<any[]>(
          "SELECT COUNT(*) as total FROM pacientes WHERE tenant_id=? AND MONTH(created_at)=MONTH(CURDATE()) AND YEAR(created_at)=YEAR(CURDATE())",
          [tenantId]
        );
        const [[internados]] = await pool.query<any[]>(
          "SELECT COUNT(*) as total FROM internaciones WHERE tenant_id=? AND estado='internado'",
          [tenantId]
        );
        const [[vacunas_proximas]] = await pool.query<any[]>(
          "SELECT COUNT(*) as total FROM vacunas WHERE tenant_id=? AND proxima_dosis BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)",
          [tenantId]
        );

        // Revenue this month (paid invoices)
        let facturacion_mes = { total: 0 };
        try {
          const [[fac]] = await pool.query<any[]>(
            "SELECT COALESCE(SUM(total), 0) as total FROM facturas WHERE tenant_id=? AND estado='pagada' AND MONTH(emitida_at)=MONTH(CURDATE())",
            [tenantId]
          );
          facturacion_mes = { total: Number(fac?.total ?? 0) };
        } catch { /* facturacion table may not exist for basic plans */ }

        // Low stock alerts
        const [stock_critico] = await pool.query<any[]>(
          "SELECT id, nombre, stock, stock_minimo FROM productos WHERE tenant_id=? AND is_active=1 AND stock <= stock_minimo ORDER BY stock ASC LIMIT 10",
          [tenantId]
        ).catch(() => [[]]);

        return {
          turnos: {
            hoy: Number(turnos_hoy?.total ?? 0),
            este_mes: Number(turnos_mes?.total ?? 0),
          },
          pacientes: {
            total: Number(pacientes_total?.total ?? 0),
            nuevos_este_mes: Number(pacientes_nuevos_mes?.total ?? 0),
          },
          internados: Number(internados?.total ?? 0),
          vacunas_proximas_30d: Number(vacunas_proximas?.total ?? 0),
          facturacion_mes_ars: facturacion_mes.total,
          stock_critico,
        };
      });

      res.json({ data, meta: { requestId: (req as any).id, cached: true, ttl: CACHE_TTL }, errors: [] });
    } catch (e) { next(e); }
  });

  /**
   * GET /api/v1/dashboard/turnos-semana?veterinario_id=
   * Returns this week's appointments grouped by day.
   */
  router.get("/turnos-semana", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      const veterinarioId = req.query.veterinario_id ? Number(req.query.veterinario_id) : null;

      const cacheKey = `dash:turnos_semana:${ctx.tenantId}:${veterinarioId ?? "all"}`;
      const data = await cached(opts.redis, cacheKey, async () => {
        const conditions = ["tenant_id=?", "fecha_hora >= DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)", "fecha_hora < DATE_ADD(DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY), INTERVAL 7 DAY)"];
        const params: any[] = [ctx.tenantId];
        if (veterinarioId) { conditions.push("veterinario_id=?"); params.push(veterinarioId); }

        const [rows] = await ctx.tenantPool.query<any[]>(
          `SELECT DATE(fecha_hora) as dia, estado, COUNT(*) as total
           FROM turnos WHERE ${conditions.join(" AND ")}
           GROUP BY dia, estado ORDER BY dia`,
          params
        );
        return rows;
      });

      res.json({ data, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  /**
   * GET /api/v1/dashboard/especies
   * Distribution of patients by species.
   */
  router.get("/especies", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      const data = await cached(opts.redis, `dash:especies:${ctx.tenantId}`, async () => {
        const [rows] = await ctx.tenantPool.query<any[]>(
          "SELECT especie, COUNT(*) as total FROM pacientes WHERE tenant_id=? AND is_active=1 GROUP BY especie ORDER BY total DESC",
          [ctx.tenantId]
        );
        return rows;
      });
      res.json({ data, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  return router;
}
