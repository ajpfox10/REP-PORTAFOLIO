import { Router } from "express";
import type { Sequelize } from "sequelize";

// Router simple (no DB) para compatibilidad.
export const healthRouter = Router();
healthRouter.get("/health", (_req, res) => res.json({ ok: true, status: "up" }));
healthRouter.get("/ready", (_req, res) => res.json({ ok: true, status: "ready" }));

// Router enterprise: /ready valida DB.
export function buildHealthRouter(sequelize: Sequelize) {
  const r = Router();

  r.get("/health", (_req, res) => res.json({ ok: true, status: "up" }));

  r.get("/ready", async (_req, res) => {
    try {
      await sequelize.query("SELECT 1");
      return res.json({ ok: true, status: "ready", db: "up" });
    } catch (e) {
      return res.status(503).json({ ok: false, status: "not-ready", db: "down" });
    }
  });

  return r;
}
