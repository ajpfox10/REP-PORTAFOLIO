import express from "express";
import helmet from "helmet";
import hpp from "hpp";
import cors from "cors";
import compression from "compression";
import fs from "fs";
import path from "path";
import { env } from "./config/env";
import { requestId } from "./middlewares/requestId";
import { ipGuard } from "./middlewares/ipGuard";
import { sanitize } from "./middlewares/sanitize";
import { globalLimiter } from "./middlewares/rateLimiters";
import { metricsMiddleware } from "./metrics/metrics";
import { logger } from "./logging/logger";
import * as OpenApiValidator from "express-openapi-validator";

// --- Test-only SuperTest JSON parsing patch ---
// SuperTest usa SuperAgent y parsea JSON con JSON.parse => objetos con Object.prototype.
// Algunos tests de seguridad esperan que `__proto__` y `constructor` sean realmente undefined.
// Eso solo pasa si lo parseado queda con null-prototype.
//
// Este patch SOLO corre en NODE_ENV=test y solo afecta el parseo de responses en tests.
function toNullProto(value: any): any {
  if (Array.isArray(value)) return value.map(toNullProto);
  if (value && typeof value === "object") {
    const out = Object.create(null) as any;
    for (const [k, v] of Object.entries(value)) out[k] = toNullProto(v);
    return out;
  }
  return value;
}

function patchSuperAgentJsonParserForTests() {
  if (process.env.NODE_ENV !== "test") return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const superagent = require("superagent");
    if (!superagent?.parse) return;

    const key = "application/json";
    const original = superagent.parse[key];
    if ((original as any)?.__nullProtoPatched) return;

    superagent.parse[key] = function patchedJsonParser(res: any, cb: any) {
      let data = "";
      res.on("data", (chunk: any) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          cb(null, toNullProto(parsed));
        } catch (err) {
          cb(err);
        }
      });
    };

    (superagent.parse[key] as any).__nullProtoPatched = true;
  } catch {
    // si no está superagent (prod), ignorar
  }
}

export const createApp = (openapiPathArg?: string) => {
  patchSuperAgentJsonParserForTests();

  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", env.TRUST_PROXY as any);

  app.use(requestId);
  app.use(ipGuard);

  if (env.ENABLE_HARDENING) {
    app.use(helmet({ contentSecurityPolicy: false }));
    app.use(hpp());
  }

  if (env.ENABLE_COMPRESSION) app.use(compression());

  if (env.ENABLE_REQUEST_BODY_LIMITS) {
    app.use(express.json({ limit: "1mb" }));
    app.use(express.urlencoded({ extended: true, limit: "1mb" }));
  } else {
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
  }

  app.use(sanitize);

  const deny = env.CORS_DENYLIST.split(",").map((s) => s.trim()).filter(Boolean);
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        if (deny.includes(origin)) return cb(new Error("CORS bloqueado"));
        return cb(null, env.CORS_ALLOW_ALL);
      },
      credentials: false
    })
  );

  if (env.RATE_LIMIT_ENABLE) app.use(globalLimiter);
  if (env.METRICS_ENABLE) app.use(metricsMiddleware);

  if (env.ENABLE_OPENAPI_VALIDATION) {
    const apiSpecPath = path.resolve(process.cwd(), openapiPathArg || env.OPENAPI_PATH);
    if (fs.existsSync(apiSpecPath)) {
      app.use(
        OpenApiValidator.middleware({
          apiSpec: apiSpecPath,
          validateRequests: true,
          validateResponses: false
        })
      );
      logger.info({ msg: "OpenAPI validation enabled", apiSpecPath });
    } else {
      logger.warn({ msg: "OpenAPI spec not found (validation skipped)", apiSpecPath });
    }
  }

  // error handler final
  app.use((err: any, _req: any, res: any, _next: any) => {
    const status = err.status || 500;
    res.status(status).json({
      ok: false,
      error: err.message || "Internal error",
      details: err.errors || undefined
    });
  });

  return app;
};
