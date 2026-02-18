// src/app.ts
import express, { type Express } from "express";
import cors from "cors";
import compression from "compression";
import morgan from "morgan";
import { metricsHttp } from "./middlewares/metricsHttp";
import { env } from "./config/env";
import { logger } from "./logging/logger";
import { requestId } from "./middlewares/requestId";
import { sanitize } from "./middlewares/sanitize";
import { ipGuard } from "./middlewares/ipGuard";
import { rateLimiter } from "./middlewares/rateLimiters";
import { openapiValidator } from "./middlewares/openapiValidator";
import { systemRouter } from "./routes/system.routes";
import { errorHandler } from "./middlewares/errorHandler";
import { hardening } from "./middlewares/hardening";

type MountFn = (app: Express) => void;

export function createApp(openapiPathOverride?: string, mount?: MountFn) {
  const app = express();

  // trust proxy
  if (env.TRUST_PROXY) {
    app.set("trust proxy", 1);
  }

  // request id
  app.use(requestId);

  // Middleware de métricas HTTP (Prometheus):
  // registra requests en vuelo, conteo por método/ruta/status
  // y tiempos de respuesta sin afectar endpoints ni contratos.
  if (env.METRICS_ENABLE) {
  app.use(metricsHttp);
  }

  // logging HTTP -> estructurado, con requestId
  morgan.token("requestId", (req: any) => String(req?.requestId || ""));
  app.use(
    morgan(
      (tokens, req: any, res) => {
        const payload = {
          msg: "http",
          requestId: tokens.requestId(req, res) || undefined,
          method: tokens.method(req, res),
          path: tokens.url(req, res),
          status: Number(tokens.status(req, res) || 0) || undefined,
          length: Number(tokens.res(req, res, "content-length") || 0) || undefined,
          durationMs: Number(tokens["response-time"](req, res) || 0) || undefined,
          remoteAddr: tokens["remote-addr"](req, res),
          userAgent: tokens["user-agent"](req, res),
        };
        return JSON.stringify(payload);
      },
      {
        stream: {
          write: (line: string) => {
            const raw = String(line || "").trim();
            if (!raw) return;
            try {
              logger.info(JSON.parse(raw));
            } catch {
              logger.info({ msg: "http", line: raw });
            }
          },
        },
      }
    )
  );

  // hardening
  if (env.ENABLE_HARDENING) {
    app.disable("x-powered-by");
    app.use(...hardening());
  }

  // compression
  if (env.ENABLE_COMPRESSION) {
    app.use(compression());
  }

  // body limits
  if (env.ENABLE_REQUEST_BODY_LIMITS) {
    app.use(express.json({ limit: "200kb" }));
    app.use(express.urlencoded({ extended: true, limit: "200kb" }));
  } else {
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
  }

  // sanitize
  app.use(sanitize);

  // CORS
  app.use(
    cors({
      origin: (origin, cb) => {
        // Sin origin = request directa (server-to-server, curl, Postman)
        if (!origin) return cb(null, true);

        const o = origin.toLowerCase();
        const deny = env.CORS_DENYLIST.map((x: string) => x.toLowerCase());
        if (deny.includes(o)) return cb(new Error("CORS blocked"));

        // Si hay allowlist explícita, solo esos orígenes
        if (env.CORS_ALLOWLIST.length > 0) {
          const allow = env.CORS_ALLOWLIST.map((x: string) => x.toLowerCase());
          if (!allow.includes(o)) return cb(new Error("CORS not allowed"));
          return cb(null, true);
        }

        // CORS_ALLOW_ALL=true → aceptar cualquier origen no bloqueado
        if (env.CORS_ALLOW_ALL) return cb(null, true);

        // CORS_ALLOW_ALL=false y sin allowlist → denegar todo origen externo
        return cb(new Error("CORS not allowed"));
      },
      credentials: true,
    })
  );

  // IP guard
  app.use(ipGuard);

  // ✅ SYSTEM ROUTES SIEMPRE DISPONIBLES
  app.use(systemRouter);

  // rate limit global
  app.use(rateLimiter);

  // ✅ OpenAPI validation (optional)
  if (env.ENABLE_OPENAPI_VALIDATION) {
    const specPath = openapiPathOverride || env.OPENAPI_PATH;
    logger.info({ msg: "OpenAPI validation enabled", apiSpecPath: specPath });
    app.use(openapiValidator(specPath));
  }

  // ✅ Montaje rutas reales
  if (mount) mount(app);

  // 404 default
  app.use((req, res) => {
    res.status(404).json({
      ok: false,
      error: "Not found",
      details: [{ path: req.path, message: "not found" }],
      requestId: (req as any).requestId,
    });
  });

  // error handler final
  app.use(errorHandler);

  return app;
}
