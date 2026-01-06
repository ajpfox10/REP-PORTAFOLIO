import type { Express } from "express";

type EnvOverrides = Record<string, string | undefined>;
type AttachRoutes = (app: Express) => void;

function applyEnv(overrides: EnvOverrides) {
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

function restoreEnv(snapshot: NodeJS.ProcessEnv) {
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, snapshot);
}

/**
 * Crea una app Express usando createApp() pero sin levantar DB/server.ts.
 * Permite setear env vars ANTES de importar src/app (clave para env.ts + zod).
 */
export function buildTestApp(overrides: EnvOverrides = {}, attach?: AttachRoutes): Express {
  const envSnapshot = { ...process.env };

  applyEnv(overrides);
  jest.resetModules();

  // imports lazy después de setear env
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createApp } = require("../../src/app");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { healthRouter } = require("../../src/routes/health.routes");

  const app: Express = createApp();

  // Endpoints básicos
  app.use("/", healthRouter);

  // Endpoint de utilidad para testear middlewares (sanitize, openapi, etc.)
  app.all("/echo", (req, res) => {
    res.json({
      method: req.method,
      body: req.body,
      query: req.query,
      headers: req.headers,
    });
  });

  if (attach) attach(app);

  // Restauramos env para no contaminar otros tests
  restoreEnv(envSnapshot);

  return app;
}
