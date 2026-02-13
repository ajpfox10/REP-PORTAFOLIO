// src/infra/cache.ts
import { createClient } from 'redis';
import { env } from '../config/env';
import { logger } from '../logging/logger';

type CacheClient = ReturnType<typeof createClient>;

let client: CacheClient | null = null;
let connecting: Promise<CacheClient> | null = null;

const DEFAULT_TTL = 300; // 5 minutos
const DEFAULT_KEY_PREFIX = 'cache:';

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timeout (${ms}ms)`)), ms);
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }).catch((e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

export async function getRedisClient(): Promise<CacheClient> {
  if (client) return client;
  if (connecting) return connecting;

  const url = String(env.REDIS_URL || '').trim();
  if (!url) {
    throw new Error('REDIS_URL no configurado');
  }

  const c = createClient({ url });
  
  c.on('error', (err) => {
    logger.warn(`[redis] error: ${err?.message || err}`);
  });
  
  c.on('reconnecting', () => {
    logger.warn('[redis] reconnecting...');
  });
  
  c.on('connect', () => {
    logger.info('[redis] connected');
  });

  connecting = withTimeout(
    c.connect().then(() => c),
    env.REDIS_CONNECT_TIMEOUT_MS || 5000,
    'Redis connect'
  );

  try {
    client = await connecting;
    return client;
  } finally {
    connecting = null;
  }
}

export async function closeRedisClient(): Promise<void> {
  if (!client) return;
  try {
    await client.quit();
  } catch {
    try {
      await client.disconnect();
    } catch {
      // ignore
    }
  } finally {
    client = null;
  }
}

export function isRedisEnabled(): boolean {
  return env.RATE_LIMIT_USE_REDIS === true && !!env.REDIS_URL?.trim();
}

// ============== CACHE API ==============

export interface CacheOptions {
  ttl?: number; // segundos
  keyPrefix?: string;
  tags?: string[]; // para invalidación por grupo
}

export async function cacheGet<T>(key: string, options?: CacheOptions): Promise<T | null> {
  if (!isRedisEnabled()) return null;
  
  try {
    const redis = await getRedisClient();
    const prefixed = `${options?.keyPrefix || DEFAULT_KEY_PREFIX}${key}`;
    const data = await redis.get(prefixed);
    
    if (!data) return null;
    
    return JSON.parse(data) as T;
  } catch (err) {
    logger.warn({ msg: 'Cache get failed', key, err: String(err) });
    return null; // Fail open: si Redis falla, seguimos sin cache
  }
}

export async function cacheSet<T>(
  key: string, 
  value: T, 
  options?: CacheOptions
): Promise<void> {
  if (!isRedisEnabled()) return;
  
  try {
    const redis = await getRedisClient();
    const prefixed = `${options?.keyPrefix || DEFAULT_KEY_PREFIX}${key}`;
    const ttl = options?.ttl || DEFAULT_TTL;
    
    await redis.setEx(prefixed, ttl, JSON.stringify(value));
    
    // Guardar tags para invalidación
    if (options?.tags?.length) {
      for (const tag of options.tags) {
        const tagKey = `tag:${tag}`;
        await redis.sAdd(tagKey, prefixed);
        await redis.expire(tagKey, ttl);
      }
    }
  } catch (err) {
    logger.warn({ msg: 'Cache set failed', key, err: String(err) });
  }
}

export async function cacheDel(key: string, options?: CacheOptions): Promise<void> {
  if (!isRedisEnabled()) return;
  
  try {
    const redis = await getRedisClient();
    const prefixed = `${options?.keyPrefix || DEFAULT_KEY_PREFIX}${key}`;
    await redis.del(prefixed);
  } catch (err) {
    logger.warn({ msg: 'Cache del failed', key, err: String(err) });
  }
}

export async function cacheInvalidateTags(tags: string[]): Promise<void> {
  if (!isRedisEnabled() || !tags.length) return;
  
  try {
    const redis = await getRedisClient();
    
    for (const tag of tags) {
      const tagKey = `tag:${tag}`;
      const keys = await redis.sMembers(tagKey);
      
      if (keys.length) {
        await redis.del(keys);
        await redis.del(tagKey);
        logger.debug({ msg: 'Cache invalidated by tag', tag, keys: keys.length });
      }
    }
  } catch (err) {
    logger.warn({ msg: 'Cache invalidate tags failed', tags, err: String(err) });
  }
}

// ============== CACHE MIDDLEWARE ==============

import { Request, Response, NextFunction } from 'express';

export interface CacheMiddlewareOptions {
  ttl?: number;
  keyPrefix?: string;
  tags?: (req: Request) => string[];
  condition?: (req: Request) => boolean;
}

/**
 * Middleware de cache para Express.
 * 
 * @example
 * app.get('/api/v1/documents',
 *   cacheMiddleware({ ttl: 300, tags: ['documents'] }),
 *   documentsHandler
 * );
 */
export function cacheMiddleware(options: CacheMiddlewareOptions = {}) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // ✅ Solo cachear GET
    if (req.method !== 'GET') {
      return next();
    }

    // ✅ Condición personalizada (ej: no cachear con ?noCache=1)
    if (options.condition && !options.condition(req)) {
      return next();
    }

    // ✅ Si Redis no está habilitado, skip
    if (!isRedisEnabled()) {
      return next();
    }

    // ✅ Generar key única basada en URL + query + auth (opcional)
    const userId = (req as any).auth?.principalId || 'anon';
    const path = req.originalUrl || req.url;
    const cacheKey = `${req.method}:${userId}:${path}`;

    try {
      // Intentar obtener del cache
      const cached = await cacheGet<any>(cacheKey, {
        ttl: options.ttl,
        keyPrefix: options.keyPrefix
      });

      if (cached) {
        logger.debug({ msg: 'Cache HIT', key: cacheKey });
        return res.status(cached.status).json(cached.body);
      }

      logger.debug({ msg: 'Cache MISS', key: cacheKey });

      // Interceptar res.json para guardar en cache
      const originalJson = res.json;
      res.json = function(body) {
        const responseBody = body;
        const statusCode = res.statusCode;

        // Solo cachear respuestas exitosas
        if (statusCode >= 200 && statusCode < 300) {
          const tags = options.tags ? options.tags(req) : [];
          
          cacheSet(cacheKey, { status: statusCode, body: responseBody }, {
            ttl: options.ttl,
            keyPrefix: options.keyPrefix,
            tags
          }).catch(err => {
            logger.warn({ msg: 'Async cache set failed', key: cacheKey, err });
          });
        }

        return originalJson.call(this, responseBody);
      };

      next();
    } catch (err) {
      logger.warn({ msg: 'Cache middleware error', err });
      next(); // Fail open
    }
  };
}