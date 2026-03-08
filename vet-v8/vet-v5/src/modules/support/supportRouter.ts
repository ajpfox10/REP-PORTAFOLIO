import { Router } from "express";
import type Redis from "ioredis";
import { type Pool } from "mysql2/promise";
import { nanoid } from "nanoid";
import { AppError } from "../../core/errors/appError.js";
import { type JwtService } from "../../security/auth/jwtService.js";
import { appendAudit } from "../../audit/auditRepo.js";

/**
 * Support / Impersonation (internal only)
 *
 * Design goals:
 * - Temporary, auditable impersonation with TTL
 * - Break-glass style: explicit actor + target, short-lived, revocable
 * - Server-side enforcement: every request checks Redis session (see authMiddleware)
 */
export function buildSupportRouter(opts: { redis: Redis; masterPool: Pool; tenantPoolFactory: (dbName: string) => Pool; jwtService: JwtService }) {
  const router = Router();

  function impKey(tenantId: string, actorUserId: string, impSessionId: string) {
    return `imp:${tenantId}:${actorUserId}:${impSessionId}`;
  }

  router.post("/impersonate", async (req, res, next) => {
    try {
      const { tenantId, actorUserId, targetUserId, ttlSeconds } = req.body ?? {};
      if (!tenantId || !actorUserId || !targetUserId) {
        throw new AppError("VALIDATION_ERROR", "tenantId, actorUserId, targetUserId required");
      }
      const ttl = Math.max(60, Math.min(Number(ttlSeconds ?? 900), 3600)); // 1m..1h (default 15m)

      const [trows] = await opts.masterPool.query<any[]>("SELECT db_name FROM tenants WHERE tenant_id=? LIMIT 1", [String(tenantId)]);
      const dbName = trows?.[0]?.db_name;
      if (!dbName) throw new AppError("TENANT_NOT_FOUND", "Tenant not found");
      const tenantPool = opts.tenantPoolFactory(String(dbName));
      const [rows] = await tenantPool.query<any[]>("SELECT id, roles, is_active FROM users WHERE id=? LIMIT 1", [String(targetUserId)]);
      const user = rows?.[0];
      if (!user || !user.is_active) throw new AppError("NOT_FOUND", "Target user not found or inactive");

      const roles: string[] = JSON.parse(user.roles ?? '["viewer"]');

      const impSessionId = nanoid();
      await opts.redis.set(
        impKey(String(tenantId), String(actorUserId), impSessionId),
        JSON.stringify({ targetUserId: String(targetUserId), createdAt: Date.now(), expiresAt: Date.now() + ttl * 1000 }),
        "EX",
        ttl
      );

      const accessToken = await opts.jwtService.signAccess({
        sub: String(targetUserId),
        tid: String(tenantId),
        roles,
        sid: impSessionId,
        imp: true,
        act: String(actorUserId),
        tkv: 0,
      });

      await appendAudit(tenantPool, {
        actor_user_id: String(actorUserId),
        tenant_id: String(tenantId),
        action: "support_impersonation_start",
        resource: "support",
        resource_id: String(targetUserId),
        ip: req.ip,
        user_agent: String(req.headers["user-agent"] ?? ""),
        request_id: (req as any).id,
        after_json: { impSessionId, ttlSeconds: ttl }
      });

      res.json({ data: { accessToken, impSessionId, expiresIn: ttl }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  router.post("/impersonate/revoke", async (req, res, next) => {
    try {
      const { tenantId, actorUserId, impSessionId } = req.body ?? {};
      if (!tenantId || !actorUserId || !impSessionId) throw new AppError("VALIDATION_ERROR", "tenantId, actorUserId, impSessionId required");

      await opts.redis.del(impKey(String(tenantId), String(actorUserId), String(impSessionId)));
      res.json({ data: { ok: true }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  return router;
}
