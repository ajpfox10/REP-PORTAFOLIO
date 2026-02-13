import rateLimit from "express-rate-limit";
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

// ✅ FALLBACK EN MEMORIA (cuando Redis falla o no está configurado)
const memoryStore: Record<string, number> = {};

const fallbackStore = {
  increment(key: string) {
    const hits = (memoryStore[key] || 0) + 1;
    memoryStore[key] = hits;
    return Promise.resolve({ totalHits: hits, resetTime: new Date(Date.now() + 60000) });
  },
  decrement(key: string) {
    memoryStore[key] = (memoryStore[key] || 1) - 1;
    return Promise.resolve();
  },
  resetKey(key: string) {
    delete memoryStore[key];
    return Promise.resolve();
  }
};

// ✅ STORE PERSONALIZADO QUE FUNCIONA CON CUALQUIER REDIS (SIN COMANDO SCRIPT)
function buildStoreIfEnabled() {
  if (!env.RATE_LIMIT_USE_REDIS) return undefined;
  if (!String(env.REDIS_URL || "").trim()) return undefined;

  return {
    async increment(key: string) {
      try {
        const client = await getRedisClient();
        const now = Date.now();
        const windowMs = env.RATE_LIMIT_WINDOW_MS || 60000;
        const windowKey = `${key}:${Math.floor(now / windowMs)}`;
        
        // Usar multi().exec() de forma segura con tipado
        const multi = client.multi();
        multi.incr(windowKey);
        multi.expire(windowKey, Math.ceil(windowMs / 1000));
        
        const results = await multi.exec();
        
        // ✅ EXTRACCIÓN SEGURA DEL RESULTADO
        let totalHits = 1;
        if (results && results.length > 0 && results[0]) {
          const firstResult = results[0];
          if (Array.isArray(firstResult) && firstResult.length > 1) {
            const value = firstResult[1];
            if (typeof value === 'number') totalHits = value;
          }
        }
        
        return {
          totalHits,
          resetTime: new Date(Math.floor(now / windowMs) * windowMs + windowMs)
        };
      } catch (err) {
        console.error('[rateLimit] Redis error, usando fallback:', err);
        return fallbackStore.increment(key);
      }
    },
    
    async decrement(key: string) {
      // No implementado, no es necesario para rate-limit
    },
    
    async resetKey(key: string) {
      try {
        const client = await getRedisClient();
        const pattern = `${key}:*`;
        const keys = await client.keys(pattern);
        if (keys.length) {
          await client.del(keys);
        }
      } catch {
        // Ignorar errores en reset
      }
    }
  };
}

export const globalLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  store: buildStoreIfEnabled(),
  handler: rateLimitJsonHandler("Demasiadas solicitudes. Intente más tarde."),
  skipSuccessfulRequests: false,
});

export const rateLimiter = globalLimiter;

export const authLimiter = rateLimit({
  windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
  max: env.AUTH_LOGIN_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  store: buildStoreIfEnabled(),
  handler: rateLimitJsonHandler("Demasiados intentos. Espere unos minutos."),
});