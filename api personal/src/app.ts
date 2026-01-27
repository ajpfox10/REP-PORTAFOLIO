// src/app.ts
import express, { type Express } from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import hpp from "hpp";
import morgan from "morgan";

import { env } from "./config/env";
import { logger } from "./logging/logger";
import { requestId } from "./middlewares/requestId";
import { sanitize } from "./middlewares/sanitize";
import { ipGuard } from "./middlewares/ipGuard";
import { rateLimiter } from "./middlewares/rateLimiters";
import { openapiValidator } from "./middlewares/openapiValidator";
import { systemRouter } from "./routes/system.routes";
import { errorHandler } from "./middlewares/errorHandler";

type MountFn = (app: Express) => void;

export function createApp(openapiPathOverride?: string, mount?: MountFn) {
  const app = express();

  // trust proxy
  if (env.TRUST_PROXY) {
    app.set("trust proxy", 1);
  }

  // request id
  app.use(requestId);

  // logging http -> va a tu logger
  app.use(
    morgan("combined", {
      stream: {
        write: (msg: string) => logger.info({ msg: msg.trim() })
      }
    })
  );

  // hardening
  if (env.ENABLE_HARDENING) {
    app.disable("x-powered-by");
    app.use(helmet());
    app.use(hpp());
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
  // ⚠️ Importante: si el front usa `credentials: "include"` (cookies/refresh),
  // el navegador PROHÍBE `Access-Control-Allow-Origin: *`.
  // Por eso, incluso en modo "allow all", reflejamos el origin real.
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true); // curl/postman/server-to-server

        const o = origin.toLowerCase();
        const deny = env.CORS_DENYLIST.map((x: string) => x.toLowerCase());
        if (deny.includes(o)) return cb(new Error("CORS blocked"));

        // Si hay allowlist explícita, solo permitimos esos origins.
        if (env.CORS_ALLOWLIST.length > 0) {
          const allow = env.CORS_ALLOWLIST.map((x: string) => x.toLowerCase());
          if (!allow.includes(o)) return cb(new Error("CORS not allowed"));
          return cb(null, true);
        }

        // Si no hay allowlist:
        // - Si CORS_ALLOW_ALL=true -> permitimos cualquier origin (reflejado)
        // - Si CORS_ALLOW_ALL=false -> permitimos cualquier origin salvo denylist (reflejado)
        // (ambos casos sirven para cookies porque NO devolvemos '*')
        return cb(null, true);
      },
      credentials: true
    })
  );

  // IP guard
  app.use(ipGuard);

  // ✅ SYSTEM ROUTES SIEMPRE DISPONIBLES (antes de OpenAPI y también antes del rate limiter)
  app.use(systemRouter);

  // rate limit (para el resto, no para /health)
  app.use(rateLimiter);

  // ✅ OpenAPI validation (optional)
  if (env.ENABLE_OPENAPI_VALIDATION) {
    const specPath = openapiPathOverride || env.OPENAPI_PATH;
    logger.info({ msg: "OpenAPI validation enabled", apiSpecPath: specPath });
    app.use(openapiValidator(specPath));
  }

  // ✅ Montaje de rutas reales del sistema (API /api/v1 etc)
  if (mount) mount(app);

  // 404 default (al final)
  app.use((req, res) => {
    res.status(404).json({
      ok: false,
      error: "Not found",
      details: [{ path: req.path, message: "not found" }]
    });
  });

  // error handler final (al final de TODO)
  app.use(errorHandler);

  return app;
}
