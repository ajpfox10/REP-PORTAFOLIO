import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { env } from "../config/env";
import { getRedisClient } from "../infra/redis";

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

function buildStoreIfEnabled() {
  // Por defecto, express-rate-limit usa un store en memoria (sirve para 1 sola instancia).
  // Si habilitás Redis, el límite se vuelve compartido entre múltiples instancias.
  if (!env.RATE_LIMIT_USE_REDIS) return undefined;
  if (!String(env.REDIS_URL || "").trim()) return undefined;

  return new RedisStore({
    // rate-limit-redis espera un método sendCommand compatible.
    // Lo hacemos lazy para no romper dev/test si Redis no está levantado.
    sendCommand: async (...args: any[]) => {
      const client = await getRedisClient();
      const cmd = Array.isArray(args[0]) ? args[0] : args;
      return client.sendCommand(cmd.map((x: any) => String(x)));
    },
  });
}

export const globalLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  store: buildStoreIfEnabled(),
  handler: rateLimitJsonHandler("Demasiadas solicitudes. Intente más tarde."),
});
export const rateLimiter = globalLimiter;

// ✅ limiter extra para endpoints de auth (defensa en profundidad).
// OJO: el control fino está en auth_login_guard (DB), esto es un cinturón extra.
export const authLimiter = rateLimit({
  windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
  max: env.AUTH_LOGIN_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  store: buildStoreIfEnabled(),
  handler: rateLimitJsonHandler("Demasiados intentos. Espere unos minutos."),
});
