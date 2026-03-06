// src/infra/cache.ts
import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';
import { logger } from '../logging/logger';
import { getRedisClient } from './redis';

const DEFAULT_TTL = 300; // 5 minutos
const DEFAULT_KEY_PREFIX = 'cache:';

/**
 * Indica si el cache Redis está habilitado.
 * Usa CACHE_USE_REDIS, independiente del rate limit (RATE_LIMIT_USE_REDIS).
 */
export function isCacheEnabled(): boolean {
  return env.CACHE_USE_REDIS === true && !!env.REDIS_URL?.trim();
}

// ============== CACHE API ==============

export interface CacheOptions {
  ttl?: number; // segundos
  keyPrefix?: string;
  tags?: string[]; // para invalidación por grupo
}

export async function cacheGet<T>(key: string, options?: CacheOptions): Promise<T | null> {
  if (!isCacheEnabled()) return null;

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
  if (!isCacheEnabled()) return;

  try {
    const redis = await getRedisClient();
    const prefixed = `${options?.keyPrefix || DEFAULT_KEY_PREFIX}${key}`;
    const ttl = options?.ttl || DEFAULT_TTL;

    await redis.setEx(prefixed, ttl, JSON.stringify(value));

    // Guardar tags para invalidación por grupo
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
  if (!isCacheEnabled()) return;

  try {
    const redis = await getRedisClient();
    const prefixed = `${options?.keyPrefix || DEFAULT_KEY_PREFIX}${key}`;
    await redis.del(prefixed);
  } catch (err) {
    logger.warn({ msg: 'Cache del failed', key, err: String(err) });
  }
}

export async function cacheInvalidateTags(tags: string[]): Promise<void> {
  if (!isCacheEnabled() || !tags.length) return;

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

export interface CacheMiddlewareOptions {
  ttl?: number;
  keyPrefix?: string;
  tags?: (req: Request) => string[];
  condition?: (req: Request) => boolean;
}

/**
 * Middleware de cache para Express.
 * Solo actúa cuando CACHE_USE_REDIS=true.
 * La cache key NO incluye userId: los datos son los mismos para todos
 * los usuarios que acceden a la misma URL. Si necesitás cache per-user,
 * usá un keyPrefix personalizado que incluya el userId.
 */
export function cacheMiddleware(options: CacheMiddlewareOptions = {}) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Solo cachear GET
    if (req.method !== 'GET') return next();

    // Condición personalizada (ej: no cachear con ?noCache=1)
    if (options.condition && !options.condition(req)) return next();

    // Si cache Redis no está habilitado, skip
    if (!isCacheEnabled()) return next();

    const path = req.originalUrl || req.url;
    const cacheKey = `${req.method}:${path}`;

    try {
      const cached = await cacheGet<any>(cacheKey, {
        ttl: options.ttl,
        keyPrefix: options.keyPrefix,
      });

      if (cached) {
        logger.debug({ msg: 'Cache HIT', key: cacheKey });
        return res.status(cached.status).json(cached.body);
      }

      logger.debug({ msg: 'Cache MISS', key: cacheKey });

      // Interceptar res.json para guardar en cache
      const originalJson = res.json;
      res.json = function (body) {
        const statusCode = res.statusCode;

        if (statusCode >= 200 && statusCode < 300) {
          const tags = options.tags ? options.tags(req) : [];
          cacheSet(cacheKey, { status: statusCode, body }, {
            ttl: options.ttl,
            keyPrefix: options.keyPrefix,
            tags,
          }).catch((err) => {
            logger.warn({ msg: 'Async cache set failed', key: cacheKey, err });
          });
        }

        return originalJson.call(this, body);
      };

      next();
    } catch (err) {
      logger.warn({ msg: 'Cache middleware error', err });
      next(); // Fail open
    }
  };
}
