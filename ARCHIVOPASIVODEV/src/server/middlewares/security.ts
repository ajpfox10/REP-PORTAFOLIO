import compression from "compression";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import hpp from "hpp";
import rateLimit from "express-rate-limit";
import type { Express } from "express";
import { corsAllowlist, env } from "../config/env.js";

// Aplica defensas HTTP generales sin acoplarlas a rutas concretas.
export function applySecurity(app: Express) {
  if (env.TRUST_PROXY) app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(hpp());
  app.use(compression());
  app.use(
    cors({
      credentials: true,
      origin(origin, callback) {
        if (!origin) return callback(null, true);
        if (corsAllowlist.includes(origin)) return callback(null, true);
        return callback(new Error("CORS no permitido"));
      },
    })
  );
  app.use(express.json({ limit: "512kb" }));
}

// Limita endpoints sensibles de autenticacion.
export const authLimiter = rateLimit({
  windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
  max: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
});
