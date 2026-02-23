import { Router } from "express";
import type { Sequelize } from "sequelize";
import { env } from "../config/env";
import { logger } from "../logging/logger";

// Router simple (no DB) para compatibilidad.
export const healthRouter = Router();
healthRouter.get("/health", (_req, res) => res.json({ ok: true, status: "up" }));
healthRouter.get("/ready",  (_req, res) => res.json({ ok: true, status: "ready" }));

/**
 * buildHealthRouter: /health y /ready con verificaciones reales.
 *
 * /health → siempre 200 (el proceso está vivo)
 * /ready  → 200 si DB y Redis (si está habilitado) responden
 *           503 si alguna dependencia crítica no responde
 *
 * Formato de respuesta:
 *   { ok: true,  status: "ready", checks: { db: "up", redis: "up|disabled|down" } }
 *   { ok: false, status: "not-ready", checks: { db: "down", redis: "up" } }
 */
export function buildHealthRouter(sequelize: Sequelize) {
  const r = Router();

  r.get("/health", (_req, res) =>
    res.json({ ok: true, status: "up", ts: new Date().toISOString() })
  );

  r.get("/ready", async (_req, res) => {
    const checks: Record<string, string> = {};

    // ── DB ────────────────────────────────────────────────────────────────────
    try {
      await sequelize.query("SELECT 1");
      checks.db = "up";
    } catch (e: any) {
      checks.db = "down";
      logger.error({ msg: "[ready] DB check failed", err: e?.message });
    }

    // ── Redis ─────────────────────────────────────────────────────────────────
    const redisEnabled = env.CACHE_USE_REDIS || env.RATE_LIMIT_USE_REDIS;
    if (redisEnabled && env.REDIS_URL?.trim()) {
      try {
        const { getRedisClient } = await import("../infra/redis");
        const client = await getRedisClient();
        await (client as any).ping();
        checks.redis = "up";
      } catch (e: any) {
        checks.redis = "down";
        logger.warn({ msg: "[ready] Redis check failed", err: e?.message });
      }
    } else {
      checks.redis = "disabled";
    }

    const allOk = Object.values(checks).every(v => v === "up" || v === "disabled");

    return res.status(allOk ? 200 : 503).json({
      ok:     allOk,
      status: allOk ? "ready" : "not-ready",
      checks,
      ts:     new Date().toISOString(),
    });
  });

  return r;
}
