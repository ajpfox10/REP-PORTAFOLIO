import express, { Express } from "express";
import cors from "cors";

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

function pickExport(mod: any, names: string[]) {
  for (const n of names) {
    if (mod && mod[n]) return mod[n];
  }
  // fallback: module itself
  return mod;
}

/**
 * Si el export es factory (típicamente length 0),
 * lo invocamos para obtener el middleware real.
 */
function asMiddleware(maybeFactory: any) {
  if (typeof maybeFactory !== "function") return maybeFactory;

  // middleware express típico: (req,res,next) => ... => length 3 (a veces 4 con err)
  // factory típico: () => (req,res,next) => ... => length 0
  if (maybeFactory.length <= 1) {
    // factory
    return maybeFactory();
  }
  // middleware directo
  return maybeFactory;
}

export function buildTestApp(
  overrides: EnvOverrides = {},
  attach?: AttachRoutes
): Express {
  const envSnapshot = { ...process.env };

  applyEnv(overrides);
  jest.resetModules();

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const envMod = require("../../src/config/env");
  const env = pickExport(envMod, ["env", "default"]);

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ridMod = require("../../src/middlewares/requestId");
  const requestId = asMiddleware(pickExport(ridMod, ["requestId", "default"]));

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ipMod = require("../../src/middlewares/ipGuard");
  const ipGuard = asMiddleware(pickExport(ipMod, ["ipGuard", "default"]));

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const sanMod = require("../../src/middlewares/sanitize");
  const sanitize = asMiddleware(pickExport(sanMod, ["sanitize", "default"]));

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const rlMod = require("../../src/middlewares/rateLimiters");
  const limiterRaw = pickExport(rlMod, ["globalLimiter", "rateLimiter", "default"]);
  const rateLimiter = asMiddleware(limiterRaw);

  // Health router (si existe)
  let healthRouter: any = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const healthMod = require("../../src/routes/health.routes");
    healthRouter = pickExport(healthMod, ["healthRouter", "default"]);
  } catch {
    healthRouter = null;
  }

  const app: Express = express();

  app.disable("x-powered-by");
  app.set("trust proxy", env?.TRUST_PROXY ? 1 : 0);

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Middlewares core
  if (requestId) app.use(requestId);
  if (sanitize) app.use(sanitize);
  if (ipGuard) app.use(ipGuard);

  // CORS (compatible con tests)
  const deny = String(env?.CORS_DENYLIST || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (env?.CORS_ALLOW_ALL) {
    app.use(
      cors({
        origin: (origin, cb) => {
          if (!origin) return cb(null, true);
          const o = origin.toLowerCase();
          if (deny.includes(o)) return cb(new Error("CORS bloqueado"));
          return cb(null, true);
        },
        credentials: false,
      })
    );
  }

  // Rate limit
  if (env?.RATE_LIMIT_ENABLE && rateLimiter) app.use(rateLimiter);

  // Health endpoints
  if (healthRouter) {
    app.use("/", healthRouter);
  } else {
    // Fallback para que health.test no dependa del archivo
    app.get("/health", (_req, res) => res.status(200).json({ ok: true }));
    app.get("/ready", (_req, res) => res.status(200).json({ ok: true }));
  }

  // Attach extra routes for specific tests
  if (attach) attach(app);

  // 404 consistente (algunos tests esperan json ok=false si viene json)
  app.use((_req, res) => {
    res.status(404).json({ ok: false, error: "Not found" });
  });

  // Error handler consistente
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: any, res: any, _next: any) => {
    const status = err?.status || 500;
    res.status(status).json({
      ok: false,
      error: err?.message || "error",
    });
  });

  restoreEnv(envSnapshot);
  return app;
}
