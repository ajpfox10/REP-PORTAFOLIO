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

  // Metricas HTTP (Prometheus)
  if (env.METRICS_ENABLE) {
    app.use(metricsHttp);
  }

  // logging HTTP estructurado con requestId
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
            try { logger.info(JSON.parse(raw)); }
            catch { logger.info({ msg: "http", line: raw }); }
          },
        },
      }
    )
  );

  // hardening (Helmet, HPP, etc.)
  if (env.ENABLE_HARDENING) {
    app.disable("x-powered-by");
    app.use(...hardening());
  }

  // compression gzip/br
  if (env.ENABLE_COMPRESSION) {
    app.use(compression());
  }

  // body parsing con limites de tamano
  if (env.ENABLE_REQUEST_BODY_LIMITS) {
    app.use(express.json({ limit: `${env.REQUEST_BODY_LIMIT_KB || 200}kb` }));
    app.use(express.urlencoded({ extended: true, limit: `${env.REQUEST_BODY_LIMIT_KB || 200}kb` }));
  } else {
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
  }

  // sanitizar inputs (XSS, injection basica)
  app.use(sanitize);

  // CORS - permite origenes configurados en .env
  app.use(
    cors({
      origin: (origin, cb) => {
        // Sin origin = request directa (server-to-server, curl, Postman)
        if (!origin) return cb(null, true);
        const o = origin.toLowerCase();
        const deny = env.CORS_DENYLIST.map((x: string) => x.toLowerCase());
        if (deny.includes(o)) return cb(new Error("CORS blocked"));
        if (env.CORS_ALLOWLIST.length > 0) {
          const allow = env.CORS_ALLOWLIST.map((x: string) => x.toLowerCase());
          if (!allow.includes(o)) return cb(new Error("CORS not allowed"));
          return cb(null, true);
        }
        if (env.CORS_ALLOW_ALL) return cb(null, true);
        return cb(new Error("CORS not allowed"));
      },
      credentials: true,
    })
  );

  // IP allowlist/denylist
  app.use(ipGuard);

  // System routes: /health, /ready, /version (siempre disponibles, sin auth)
  // Estos van ANTES del rate limiter para que los health checks de k8s/balanceadores
  // no consuman cuota del rate limit.
  app.use(systemRouter);

  // Rate limit global (excepto system routes que van arriba)
  app.use(rateLimiter);

  // Validacion OpenAPI (opcional, solo si ENABLE_OPENAPI_VALIDATION=true)
  if (env.ENABLE_OPENAPI_VALIDATION) {
    const specPath = openapiPathOverride || env.OPENAPI_PATH;
    logger.info({ msg: "OpenAPI validation habilitada", apiSpecPath: specPath });
    app.use(openapiValidator(specPath));
  }

  // Hook de montaje externo: el servidor llama esto para agregar audit middleware
  // IMPORTANTE: se ejecuta ANTES del montaje de rutas en mountApiGateway
  if (mount) mount(app);

  // ⚠️  NO agregamos 404 ni errorHandler aqui.
  // Se agregan en server.ts DESPUES de mountApiGateway() para que no bloqueen
  // las rutas que el gateway registra dinamicamente.
  // Ver: addFinalHandlers() mas abajo.

  return app;
}

/**
 * Agregar los handlers finales (404 y error handler) DESPUES de que todas
 * las rutas esten montadas. Llamar esto al final de server.ts.
 *
 * Razon: Express ejecuta middlewares en orden de registro.
 * Si el 404 se registra antes que las rutas del API Gateway, esas rutas
 * nunca se alcanzan y todo da 404.
 */
export function addFinalHandlers(app: Express): void {
  // 404 catch-all: cualquier ruta que no matcheo hasta aca
  app.use((req: any, res: any) => {
    res.status(404).json({
      ok: false,
      error: "Not found",
      details: [{ path: req.path, message: "not found" }],
      requestId: req.requestId,
    });
  });

  // Error handler global (captura errores lanzados con next(err))
  app.use(errorHandler);
}
