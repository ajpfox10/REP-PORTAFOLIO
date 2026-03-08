import { type RequestHandler } from "express";
import { type JwtService } from "./jwtService.js";
import { AppError } from "../../core/errors/appError.js";

const PUBLIC_PATHS = [
  "/health",
  "/api/v1/auth/login",
  "/api/v1/auth/refresh",
  "/api/v1/billing/webhooks/stripe",
  "/.well-known/jwks.json",
  "/metrics",
];

// Paths that require auth — /me, /sessions, /logout, etc. go through authMiddleware
const AUTH_PROTECTED_AUTH_PATHS = [
  "/api/v1/auth/me",
  "/api/v1/auth/logout",
  "/api/v1/auth/logout-all",
  "/api/v1/auth/sessions",
  "/api/v1/auth/change-password",
  "/api/v1/auth/mfa",
];

export function buildAuthMiddleware(jwt: JwtService, opts?: { redis?: any }): RequestHandler {
  return async (req, _res, next) => {
    try {
      const ctx = (req as any).ctx;
      if (!ctx) throw new AppError("TENANT_NOT_FOUND", "Tenant context missing");

      if (PUBLIC_PATHS.some(p => req.path === p || req.path.startsWith(p))) return next();

      const token = jwt.extractFromRequest(req.headers.authorization);
      const payload = await jwt.verifyAccess(token);

      if (payload.tid !== ctx.tenantId) throw new AppError("AUTH_REQUIRED", "Token tenant mismatch");

      ctx.userId = payload.sub;
      ctx.roles = payload.roles;
      ctx.sucursalId = payload.sucursal_id;
      ctx.veterinarioId = payload.veterinario_id;
      ctx.tokenVersion = payload.tkv ?? 0;
ctx.sessionId = (payload as any).sid;
ctx.actorUserId = (payload as any).act ?? payload.sub;

// If token is an impersonation token, enforce TTL by checking the server-side session in Redis.
if ((payload as any).imp) {
  const redis = opts?.redis;
  if (!redis) throw new AppError("CONFIG_ERROR", "Impersonation requires redis");
  const key = `imp:${ctx.tenantId}:${ctx.actorUserId}:${ctx.sessionId}`;
  const raw = await redis.get(key);
  if (!raw) throw new AppError("AUTH_REQUIRED", "Impersonation session expired or revoked");
  try {
    const data = JSON.parse(raw);
    if (String(data.targetUserId) !== String(payload.sub)) throw new AppError("AUTH_REQUIRED", "Impersonation mismatch");
  } catch {
    throw new AppError("AUTH_REQUIRED", "Invalid impersonation session");
  }
}

next();

    } catch (e) {
      next(e);
    }
  };
}
