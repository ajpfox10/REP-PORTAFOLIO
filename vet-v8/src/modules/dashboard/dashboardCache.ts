/**
 * dashboardCache.ts — Helpers para invalidar el caché del dashboard.
 *
 * El dashboard cachea KPIs 5 minutos en Redis.
 * Cuando se crean/modifican datos relevantes (turnos, pacientes, facturas, stock)
 * hay que invalidar el caché para que la próxima consulta refleje datos reales.
 *
 * Se llama desde los routers después de mutaciones exitosas.
 */

import type Redis from "ioredis";

export async function invalidateDashboardCache(redis: Redis, tenantId: string): Promise<void> {
  try {
    const keys = await redis.keys(`dash:*:${tenantId}*`);
    if (keys.length) {
      await redis.del(...keys);
    }
  } catch {
    // No bloquear la operación principal si Redis falla
  }
}

/**
 * Middleware factory: invalida caché del dashboard después de
 * una mutación exitosa (POST/PATCH/DELETE con 2xx).
 *
 * Uso: router.post("/", invalidateDashAfter(redis), async handler)
 */
export function invalidateDashAfter(redis: Redis) {
  return (_req: any, res: any, next: any) => {
    const originalJson = res.json.bind(res);
    res.json = function (body: unknown) {
      // Invalidar solo en respuestas exitosas
      if (res.statusCode < 400) {
        const tenantId = _req.ctx?.tenantId;
        if (tenantId) {
          invalidateDashboardCache(redis, tenantId).catch(() => {});
        }
      }
      return originalJson(body);
    };
    next();
  };
}
