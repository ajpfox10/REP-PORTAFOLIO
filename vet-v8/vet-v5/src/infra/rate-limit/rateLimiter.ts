import type Redis from "ioredis";
import { AppError } from "../../core/errors/appError.js";
import { type AppConfig } from "../../config/types.js";

export function buildRateLimiter(opts: { config: AppConfig; redis: Redis }) {
  const { redis } = opts;

  async function hit(key: string, limit: number, windowSec: number): Promise<void> {
    const bucket = `${key}:${Math.floor(Date.now() / (windowSec * 1000))}`;
    const n = await redis.incr(bucket);
    if (n === 1) await redis.expire(bucket, windowSec);
    if (n > limit) throw new AppError("RATE_LIMITED", "Too many requests — please wait and try again");
  }

  return {
    /** Global rate limit: 300 req / 15 min per IP */
    global() {
      return async (req: any, _res: any, next: any) => {
        try {
          await hit(`rl:global:${req.ip ?? "unknown"}`, 300, 900);
          next();
        } catch (e) { next(e); }
      };
    },

    /** Per-tenant: 200 req / 15 min per IP */
    perTenant() {
      return async (req: any, _res: any, next: any) => {
        try {
          const tenantId = req.ctx?.tenantId ?? "no-tenant";
          await hit(`rl:tenant:${tenantId}:${req.ip ?? "unknown"}`, 200, 900);
          next();
        } catch (e) { next(e); }
      };
    },

    /**
     * Auth rate limit: 10 attempts / 15 min per IP.
     * Applies to /login, /refresh, /mfa/* — prevents brute-force attacks.
     */
    auth() {
      return async (req: any, _res: any, next: any) => {
        try {
          const ip = req.ip ?? "unknown";
          // Also key by email for credential stuffing protection
          const email = String(req.body?.email ?? "").toLowerCase().trim();
          await hit(`rl:auth:${ip}`, 10, 900);
          if (email) await hit(`rl:auth:email:${email}`, 15, 900);
          next();
        } catch (e) { next(e); }
      };
    },

    /**
     * Strict rate limit for sensitive operations (MFA setup, password change).
     * 5 attempts / 15 min per user.
     */
    strict(userId: string) {
      return async (req: any, _res: any, next: any) => {
        try {
          await hit(`rl:strict:${userId}`, 5, 900);
          next();
        } catch (e) { next(e); }
      };
    },
  };
}
