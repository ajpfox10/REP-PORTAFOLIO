// src/infra/redis.ts
// Cliente Redis compartido (para rate limit distribuido, cachés, etc.)
// - Lazy connect: no conecta hasta que alguien lo pide.
// - Seguro para dev/test: si no hay REDIS_URL o RATE_LIMIT_USE_REDIS=false, no se usa.

import { createClient } from "redis";
import { env } from "../config/env";
import { logger } from "../logging/logger";

// OJO: los tipos de `redis` pueden variar según módulos instalados (@redis/*).
// Para evitar choques de tipos en TypeScript (múltiples versiones de @redis/client),
// usamos el tipo inferido del propio `createClient`.
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

/**
 * Devuelve un cliente Redis conectado.
 * Lanza error si no hay REDIS_URL.
 */
export async function getRedisClient(): Promise<RedisClient> {
  if (client) return client;
  if (connecting) return connecting;

  const url = String(env.REDIS_URL || "").trim();
  if (!url) {
    throw new Error("REDIS_URL no configurado");
  }

  const c = createClient({ url });
  c.on("error", (err) => {
    // No spamear: redis suele tirar errores transitorios cuando cae la red
    logger.warn(`[redis] error: ${err?.message || err}`);
  });
  c.on("reconnecting", () => {
    logger.warn("[redis] reconnecting...");
  });
  c.on("connect", () => {
    logger.info("[redis] connected");
  });

  connecting = withTimeout(c.connect().then(() => c), env.REDIS_CONNECT_TIMEOUT_MS, "Redis connect");

  try {
    client = await connecting;
    return client;
  } finally {
    connecting = null;
  }
}

/**
 * Cierra el cliente si está abierto.
 */
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
