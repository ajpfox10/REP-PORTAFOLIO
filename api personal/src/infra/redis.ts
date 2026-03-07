// src/infra/redis.ts
import { createClient } from "redis";
import { env } from "../config/env";
import { logger } from "../logging/logger";

type RedisClient = ReturnType<typeof createClient>;

let client: RedisClient | null = null;
let connecting: Promise<RedisClient> | null = null;

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

export async function getRedisClient(): Promise<RedisClient> {
  if (client) return client;
  if (connecting) return connecting;

  const url = String(env.REDIS_URL || "").trim();
  if (!url) {
    throw new Error("REDIS_URL no configurado");
  }

  const c = createClient({ url });
  
  c.on("error", (err) => {
    logger.warn(`[redis] error: ${err?.message || err}`);
  });
  
  c.on("reconnecting", () => {
    logger.warn("[redis] reconnecting...");
  });
  
  c.on("connect", () => {
    logger.info("[redis] connected");
  });

  connecting = withTimeout(c.connect().then(() => c), env.REDIS_CONNECT_TIMEOUT_MS || 5000, "Redis connect");

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

// ✅ NUEVO: Helper para incremento atómico con expire (sin MULTI problemático)
export async function redisIncrWithExpire(key: string, ttlSeconds: number): Promise<number> {
  if (!isRedisEnabled()) return 0;
  
  try {
    const redis = await getRedisClient();
    
    // ✅ Usar comando único en Redis 7.2.7+
    // Este comando es atómico y no requiere MULTI/EXEC
    const result = await redis.sendCommand([
      'EVAL',
      `
        local current = redis.call('INCR', KEYS[1])
        if current == 1 then
          redis.call('EXPIRE', KEYS[1], ARGV[1])
        end
        return current
      `,
      '1',
      key,
      ttlSeconds.toString()
    ]);
    
    return typeof result === 'number' ? result : parseInt(String(result || '0'), 10);
  } catch (err) {
    logger.warn({ msg: '[redis] INCR failed, usando fallback', key, err: String(err) });
    return 0;
  }
}

export async function redisDel(key: string): Promise<void> {
  if (!isRedisEnabled()) return;
  
  try {
    const redis = await getRedisClient();
    await redis.del(key);
  } catch (err) {
    logger.warn({ msg: '[redis] DEL failed', key, err: String(err) });
  }
}

export async function redisKeys(pattern: string): Promise<string[]> {
  if (!isRedisEnabled()) return [];
  
  try {
    const redis = await getRedisClient();
    return await redis.keys(pattern);
  } catch (err) {
    logger.warn({ msg: '[redis] KEYS failed', pattern, err: String(err) });
    return [];
  }
}