import rateLimit from "express-rate-limit";
import { env } from "../config/env";

function pickRequestId(req: any): string | null {
  const id = req?.requestId || req?.headers?.["x-request-id"];
  return id ? String(id) : null;
}

function rateLimitJsonHandler(message: string) {
  return (req: any, res: any) => {
    const requestId = pickRequestId(req);
    res.status(429).json({
      ok: false,
      error: message,
      requestId,
    });
  };
}

export const globalLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitJsonHandler("Demasiadas solicitudes. Intente más tarde."),
});
export const rateLimiter = globalLimiter;

// ✅ limiter extra para endpoints de auth (defensa en profundidad).
// OJO: el control fino está en auth_login_guard (DB), esto es un cinturón extra.
export const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitJsonHandler("Demasiados intentos. Espere unos minutos."),
});
