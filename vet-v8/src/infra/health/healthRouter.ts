/**
 * Health endpoints — v9
 *
 * CHANGES vs v8:
 *  GET /health        — PUBLIC, minimal. Returns {ok, ts} only.
 *                       Safe for load-balancer/k8s liveness probes.
 *  GET /health/ready  — PRIVATE, detailed. Requires internal Bearer token
 *                       OR request from localhost (sidecar / k8s exec probe).
 *                       Returns full checks: Redis, DB, queues, version.
 *
 * WHY: The v8 /health endpoint was public and returned system version,
 * Redis latency, DB state, queue depths and error messages — useful
 * reconnaissance for an attacker. Separating the endpoints removes
 * information leakage without breaking monitoring infrastructure.
 */

import { Router, type Request, type Response } from "express";
import type { Pool } from "mysql2/promise";

export type HealthRouterOpts = {
  redis: any;
  masterPool: Pool;
  internalToken: string;   // config.internalApiToken — never expose publicly
  version?: string;
};

export function buildHealthRouter(opts: HealthRouterOpts) {
  const router = Router();
  const { redis, masterPool, internalToken, version = "9.0.0" } = opts;

  // ── PUBLIC liveness probe — safe for uptime monitors / load balancers ─────
  router.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({ ok: true, ts: new Date().toISOString() });
  });

  // ── PRIVATE readiness probe — detailed infra checks ───────────────────────
  router.get("/health/ready", async (req: Request, res: Response) => {
    const fromLocalhost = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.ip ?? "");
    if (!fromLocalhost) {
      const auth = req.headers.authorization ?? "";
      if (!auth.startsWith("Bearer ") || auth.slice(7) !== internalToken) {
        res.status(401).json({ ok: false, error: "Unauthorized" });
        return;
      }
    }

    const checks: Record<string, { ok: boolean; [k: string]: unknown }> = {};

    try {
      const t = Date.now();
      await redis.ping();
      checks.redis = { ok: true, latencyMs: Date.now() - t };
    } catch (e: any) {
      checks.redis = { ok: false, error: String(e?.message) };
    }

    try {
      const t = Date.now();
      await masterPool.query("SELECT 1");
      checks.masterDb = { ok: true, latencyMs: Date.now() - t };
    } catch (e: any) {
      checks.masterDb = { ok: false, error: String(e?.message) };
    }

    try {
      const { Queue: BQueue } = await import("bullmq");
      const jobsQ = new BQueue("jobs", { connection: redis });
      const schedQ = new BQueue("scheduler", { connection: redis });
      const [active, waiting, failed] = await Promise.all([
        jobsQ.getActiveCount(),
        schedQ.getWaitingCount(),
        jobsQ.getFailedCount(),
      ]);
      checks.queues = {
        ok: failed < 100,
        jobs: { active, failed },
        scheduler: { waiting },
        ...(failed >= 100 ? { warning: `${failed} failed jobs accumulated` } : {}),
      };
      await jobsQ.disconnect();
      await schedQ.disconnect();
    } catch (e: any) {
      checks.queues = { ok: false, error: String(e?.message) };
    }

    const allOk = Object.values(checks).every(c => c.ok);
    res.status(allOk ? 200 : 503).json({ ok: allOk, ts: new Date().toISOString(), version, checks });
  });

  return router;
}
