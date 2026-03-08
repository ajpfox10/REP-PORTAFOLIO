/**
 * Auth Middleware — v10
 *
 * S-02: JTI blocklist check after signature verification.
 *   If the token was explicitly revoked (logout, force-logout, password change),
 *   reject it even if it's still within its 15-minute validity window.
 *   Cost: 1 Redis GET per authenticated request (~0.3 ms).
 */

import { type RequestHandler } from "express";
import { type JwtService } from "./jwtService.js";
import { AppError } from "../../core/errors/appError.js";
import { sameUserAgentFamily } from "../network/requestSecurity.js";
import { jtiBlocklist } from "./jtiBlocklist.js";

const PUBLIC_PATHS = [
  "/api/v1/auth/forgot-password",
  "/api/v1/auth/reset-password",
  "/api/v1/auth/verify-reset-token",
  "/api/v1/portal/login",
  "/api/v1/portal/register",
  "/api/v1/whatsapp/webhook",
  "/health",
  "/api/v1/auth/login",
  "/api/v1/auth/refresh",
  "/api/v1/billing/webhooks/stripe",
  "/.well-known/jwks.json",
];

export function buildAuthMiddleware(jwt: JwtService, opts?: { redis?: any; config?: any }): RequestHandler {
  return async (req, _res, next) => {
    try {
      const ctx = (req as any).ctx;
      if (!ctx) throw new AppError("TENANT_NOT_FOUND", "Tenant context missing");
      if (PUBLIC_PATHS.some(p => req.path === p || req.path.startsWith(p))) return next();

      const token = jwt.extractFromRequest(req.headers.authorization);
      const payload = await jwt.verifyAccess(token);
      if (payload.tid !== ctx.tenantId) throw new AppError("AUTH_REQUIRED", "Token tenant mismatch");

      // S-02: check JTI blocklist — catches revoked tokens within their validity window
      const redis = opts?.redis;
      if (redis && payload.jti) {
        if (await jtiBlocklist.isRevoked(redis, payload.jti)) {
          throw new AppError("AUTH_REQUIRED", "Token has been revoked");
        }
      }

      ctx.userId        = payload.sub;
      ctx.roles         = payload.roles;
      ctx.sucursalId    = payload.sucursal_id;
      ctx.veterinarioId = payload.veterinario_id;
      ctx.tokenVersion  = payload.tkv ?? 0;
      ctx.sessionId     = (payload as any).sid;
      ctx.actorUserId   = (payload as any).act ?? payload.sub;
      ctx.jti           = payload.jti;   // expose for logout handlers
      ctx.tokenExp      = payload.exp;   // expose for logout handlers

      const [rows] = await ctx.tenantPool.query<any[]>(
        "SELECT id, token_version, mfa_enabled, is_active FROM users WHERE id=? AND tenant_id=? LIMIT 1",
        [ctx.userId, ctx.tenantId]
      );
      const user = rows?.[0];
      if (!user || !user.is_active) throw new AppError("AUTH_REQUIRED", "User inactive or not found");
      ctx.mfaEnabled = Boolean(user.mfa_enabled);
      if (Number(payload.tkv ?? 0) !== Number(user.token_version ?? 0)) {
        throw new AppError("AUTH_REQUIRED", "Access token revoked");
      }

      const sid = String(ctx.sessionId ?? "");
      if ((opts?.config?.authRequireStatefulAccessSession ?? true) && !(payload as any).imp) {
        if (!redis || !sid) throw new AppError("AUTH_REQUIRED", "Missing session state");
        const key = `rt:${ctx.tenantId}:${ctx.userId}:${sid}`;
        const raw = await redis.get(key);
        if (!raw) throw new AppError("AUTH_REQUIRED", "Session expired or revoked");
        try {
          const sess = JSON.parse(raw);
          if (Number(sess.version ?? -1) !== Number(user.token_version ?? 0)) {
            throw new AppError("AUTH_REQUIRED", "Session version mismatch");
          }
          if (opts?.config?.authEnforceSessionFingerprint) {
            const currentUa = String(req.headers["user-agent"] ?? "");
            if (sess.ua && !sameUserAgentFamily(String(sess.ua), currentUa)) {
              throw new AppError("AUTH_REQUIRED", "Session fingerprint mismatch");
            }
          }
        } catch (e) {
          if (e instanceof AppError) throw e;
          throw new AppError("AUTH_REQUIRED", "Invalid session state");
        }
      }

      if ((payload as any).imp) {
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
