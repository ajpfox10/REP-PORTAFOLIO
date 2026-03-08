import { AppError } from "../../core/errors/appError.js";
import type { Request, Response, NextFunction } from "express";
import type Redis from "ioredis";

/**
 * Require MFA for sensitive operations.
 * The client must provide header: x-stepup-token
 * which is issued by /api/v1/auth/mfa/step-up after verifying TOTP.
 */
export function requireStepUpMfa(opts: { redis: Redis; ttlSeconds?: number } ) {
  const ttl = opts.ttlSeconds ?? 300;
  return async (req: Request, _res: Response, next: NextFunction) => {
    const ctx = (req as any).ctx || {};
    if (!ctx.mfaEnabled) return next();

    const token = req.header("x-stepup-token");
    if (!token) return next(new AppError("MFA_STEP_UP_REQUIRED", "Se requiere MFA para esta operación", 401));

    const key = `stepup:${ctx.tenantId}:${ctx.userId}:${token}`;
    const ok = await opts.redis.get(key);
    if (!ok) return next(new AppError("MFA_STEP_UP_REQUIRED", "Step-up expirado o inválido", 401));

    // refresh TTL on use (sliding)
    await opts.redis.expire(key, ttl).catch(() => {});
    return next();
  };
}
