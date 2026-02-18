import rateLimit from "express-rate-limit";
import { env } from "../config/env";
import { getRedisClient, isRedisEnabled, redisIncrWithExpire, redisDel, redisKeys } from "../infra/redis";

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

// ✅ FALLBACK EN MEMORIA
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

// ✅ STORE CON REDIS
function buildStoreIfEnabled() {
  if (!env.RATE_LIMIT_USE_REDIS) return undefined;
  if (!String(env.REDIS_URL || "").trim()) return undefined;

  return {
    async increment(key: string) {
      try {
        const now = Date.now();
        const windowMs = env.RATE_LIMIT_WINDOW_MS || 60000;
        const windowKey = `${key}:${Math.floor(now / windowMs)}`;
        
        const totalHits = await redisIncrWithExpire(windowKey, Math.ceil(windowMs / 1000));
        
        return {
          totalHits: totalHits || 1,
          resetTime: new Date(Math.floor(now / windowMs) * windowMs + windowMs)
        };
      } catch (err) {
        console.error('[rateLimit] Redis error, usando fallback:', err);
        return fallbackStore.increment(key);
      }
    },
    
    async decrement(key: string) {},
    
    async resetKey(key: string) {
      try {
        const pattern = `${key}:*`;
        const keys = await redisKeys(pattern);
        for (const k of keys) {
          await redisDel(k);
        }
      } catch {}
    }
  };
}

// ✅ KEY GENERATOR QUE USA IP + USUARIO (SI ESTÁ AUTENTICADO)
function keyGenerator(req: any): string {
  const auth = req.auth;
  const userId = auth?.principalId;
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  
  if (userId && env.RATE_LIMIT_BY_USER) {
    return `user:${userId}`;
  }
  
  return `ip:${ip}`;
}

export const globalLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  store: buildStoreIfEnabled(),
  keyGenerator,
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
  keyGenerator: (req) => req.ip || 'unknown',
  handler: rateLimitJsonHandler("Demasiados intentos. Espere unos minutos."),
});