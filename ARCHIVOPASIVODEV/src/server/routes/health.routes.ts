import { Router } from "express";
import { query } from "../db/pool.js";

const router = Router();

// Health liviano para PM2 o monitoreo local.
router.get("/health", (_req, res) => {
  res.json({ ok: true, service: "archivopasivodev" });
});

// Ready verifica conectividad basica con MySQL.
router.get("/ready", async (_req, res, next) => {
  try {
    await query("SELECT 1 AS ok");
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

export { router as healthRouter };
