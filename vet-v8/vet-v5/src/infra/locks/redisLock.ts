import { nanoid } from "nanoid";
import type Redis from "ioredis";
import { AppError } from "../../core/errors/appError.js";

export async function withRedisLock<T>(opts: { redis: Redis; key: string; ttlMs: number; fn: () => Promise<T> }): Promise<T> {
  const token = nanoid();
  const ok = await opts.redis.set(opts.key, token, "PX", opts.ttlMs, "NX");
  if (!ok) throw new AppError("DB_ERROR", "Lock busy", { key: opts.key });
  try { return await opts.fn(); }
  finally {
    const lua = `if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end`;
    await opts.redis.eval(lua, 1, opts.key, token);
  }
}
