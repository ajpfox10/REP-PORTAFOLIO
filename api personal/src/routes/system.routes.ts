// src/routes/system.routes.ts
import { Router } from "express";

export const systemRouter = Router();

systemRouter.get("/health", (_req, res) => {
  return res.status(200).json({ ok: true, status: "up" });
});

// Si tu ready real vive en otro router, acá dejamos pasar
systemRouter.get("/ready", (_req, _res, next) => next());

systemRouter.get("/version", (req, res) => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pkg = require("../../package.json");

  return res.json({
    ok: true,
    name: pkg?.name ?? "api",
    version: pkg?.version ?? "0.0.0",
    node: process.version,
    env: process.env.NODE_ENV ?? "development",
    requestId: (req as any)?.requestId
  });
});

systemRouter.get("/diag", (req, res) => {
  const mem = process.memoryUsage();
  return res.json({
    ok: true,
    pid: process.pid,
    uptimeSec: Math.round(process.uptime()),
    memory: { rss: mem.rss, heapTotal: mem.heapTotal, heapUsed: mem.heapUsed },
    requestId: (req as any)?.requestId
  });
});
