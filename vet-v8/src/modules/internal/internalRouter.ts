import { Router } from "express";
import type { Queue } from "bullmq";
import type Redis from "ioredis";
import { type Pool } from "mysql2/promise";
import bcrypt from "bcryptjs";
import { type AppConfig } from "../../config/types.js";
import { AppError } from "../../core/errors/appError.js";
import { provisionTenant } from "../../tenancy/provisioningService.js";
import { logger } from "../../core/logging/logger.js";
import { type JwtService } from "../../security/auth/jwtService.js";
import { type KmsEnvelope } from "../../security/encryption/kmsEnvelope.js";
import { type FeatureFlags } from "../../infra/feature-flags/featureFlags.js";
import { appendAudit } from "../../audit/auditRepo.js";
import crypto from "node:crypto";
import { nanoid } from "nanoid";
import { validatePasswordPolicy } from "../../security/password/passwordPolicy.js";
import { isPrivateIp } from "../../security/network/requestSecurity.js";

export function internalRouter(opts: {
  config: AppConfig;
  redis: Redis;
  masterPool: Pool;
  tenantPoolFactory: (dbName: string) => Pool;
  jwtService: JwtService;
  kms: KmsEnvelope;
  featureFlags: FeatureFlags;
  queue: Queue;
}) {
  const router = Router();

  // Internal guard: private network + IP allowlist + HMAC + anti-replay nonce
  router.use(async (req, _res, next) => {
    const ip = String(req.ip ?? req.socket.remoteAddress ?? "");
    const allow = opts.config.internalApiIpAllowlist;
    if (opts.config.internalApiRequirePrivateNetwork && !isPrivateIp(ip)) {
      return next(new AppError("INTERNAL_ONLY", "Internal API requires private network", { ip }));
    }
    if (allow.length && !allow.includes(ip) && !allow.includes(ip.replace(/^::ffff:/, ""))) {
      return next(new AppError("INTERNAL_ONLY", "Internal API denied", { ip }));
    }

    const secret = opts.config.internalApiSharedSecret;
    if (!secret) return next(new AppError("CONFIG_ERROR", "INTERNAL_API_SHARED_SECRET required"));

    const ts = String(req.headers["x-internal-ts"] ?? "");
    const sig = String(req.headers["x-internal-signature"] ?? "");
    const nonce = String(req.headers["x-internal-nonce"] ?? "");
    if (!ts || !sig) return next(new AppError("INTERNAL_ONLY", "Missing internal signature headers"));
    if (opts.config.internalApiRequireNonce && !nonce) return next(new AppError("INTERNAL_ONLY", "Missing internal nonce"));

    const age = Math.abs(Date.now() - Number(ts));
    if (!Number.isFinite(age) || age > opts.config.internalApiNonceTtlSeconds * 1000) {
      return next(new AppError("INTERNAL_ONLY", "Stale internal signature"));
    }

    if (opts.config.internalApiRequireNonce) {
      const nonceKey = `internal_nonce:${nonce}`;
      const wasSet = await opts.redis.set(nonceKey, JSON.stringify({ ts, path: req.originalUrl }), "EX", opts.config.internalApiNonceTtlSeconds, "NX");
      if (wasSet !== "OK") return next(new AppError("INTERNAL_ONLY", "Replay detected"));
    }

    const bodyStr = (req as any).rawBody ?? JSON.stringify(req.body ?? {});
    const base = `${req.method}
${req.originalUrl}
${ts}
${nonce}
${bodyStr}`;
    const expected = crypto.createHmac("sha256", secret).update(base).digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(sig);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return next(new AppError("INTERNAL_ONLY", "Invalid internal signature"));
    }
    next();
  });

  // ── Tenant management ──────────────────────────────────────────────────────

  router.post("/tenants/provision", async (req, res, next) => {
    try {
      const { subdomain, plan, region, adminEmail, adminPassword } = req.body ?? {};
      if (!subdomain) throw new AppError("VALIDATION_ERROR", "subdomain required");
      if (adminPassword) validatePasswordPolicy(String(adminPassword), { email: String(adminEmail ?? "admin@tenant.local"), minLength: opts.config.authPasswordMinLength });

      const tenantAdminPool = opts.tenantPoolFactory(opts.config.masterDb.name);
      const out = await provisionTenant({
        redis: opts.redis,
        masterPool: opts.masterPool,
        tenantAdminPool,
        subdomain,
        plan: plan ?? "basic",
        region: region ?? "AR",
        adminEmail,
        adminPassword,
      });

      logger.info({ tenantId: out.tenantId, subdomain }, "Tenant provisioned");
      res.status(201).json({ data: out, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  router.get("/tenants", async (req, res, next) => {
    try {
      const [rows] = await opts.masterPool.query<any[]>(
        "SELECT tenant_id, subdomain, status, plan, region, default_locale, created_at FROM tenants ORDER BY created_at DESC"
      );
      res.json({ data: rows, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  router.patch("/tenants/:tenantId/status", async (req, res, next) => {
    try {
      const { tenantId } = req.params;
      const { status } = req.body ?? {};
      if (!["active", "disabled", "suspended", "trial"].includes(status)) {
        throw new AppError("VALIDATION_ERROR", "status must be active, disabled, suspended or trial");
      }
      await opts.masterPool.query("UPDATE tenants SET status=? WHERE tenant_id=?", [status, tenantId]);
      res.json({ data: { ok: true }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  router.patch("/tenants/:tenantId/plan", async (req, res, next) => {
    try {
      const { tenantId } = req.params;
      const { plan } = req.body ?? {};
      if (!["basic", "pro", "enterprise", "custom"].includes(plan)) throw new AppError("VALIDATION_ERROR", "invalid plan");
      await opts.masterPool.query("UPDATE tenants SET plan=? WHERE tenant_id=?", [plan, tenantId]);
      res.json({ data: { ok: true }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  // ── User management ────────────────────────────────────────────────────────

  router.post("/tenants/:tenantId/users", async (req, res, next) => {
    try {
      const { tenantId } = req.params;
      const { email, password, roles } = req.body ?? {};
      if (!email || !password) throw new AppError("VALIDATION_ERROR", "email and password required");
      validatePasswordPolicy(String(password), { email: String(email), minLength: opts.config.authPasswordMinLength });

      const [rows] = await opts.masterPool.query<any[]>("SELECT db_name FROM tenants WHERE tenant_id=? LIMIT 1", [tenantId]);
      if (!rows?.length) throw new AppError("TENANT_NOT_FOUND", "Tenant not found");

      const pool = opts.tenantPoolFactory(String(rows[0].db_name));
      const hash = await bcrypt.hash(String(password), 12);
      await pool.query(
        "INSERT INTO users (tenant_id, email, password_hash, roles) VALUES (?,?,?,?)",
        [tenantId, String(email).toLowerCase().trim(), hash, JSON.stringify(roles ?? ["viewer"])]
      );
      res.status(201).json({ data: { ok: true }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  // ── Support impersonation ──────────────────────────────────────────────────

  router.post("/support/impersonate", async (req, res, next) => {
    try {
      const { tenantId, userId, reason, ticketId, scope } = req.body ?? {};
      const actor = String(req.headers["x-support-actor"] ?? "").trim();
      if (!tenantId || !userId) throw new AppError("VALIDATION_ERROR", "tenantId and userId required");
      if (!actor) throw new AppError("VALIDATION_ERROR", "x-support-actor required");
      if (!ticketId || String(ticketId).trim().length < 6) throw new AppError("VALIDATION_ERROR", "ticketId required");
      if (!reason || String(reason).trim().length < 15) throw new AppError("VALIDATION_ERROR", "reason required (min 15 chars)");

      const [tenantRows] = await opts.masterPool.query<any[]>("SELECT db_name FROM tenants WHERE tenant_id=? AND status='active' LIMIT 1", [tenantId]);
      if (!tenantRows?.length) throw new AppError("TENANT_NOT_FOUND", "Tenant not found or inactive");

      const pool = opts.tenantPoolFactory(String(tenantRows[0].db_name));
      const [userRows] = await pool.query<any[]>("SELECT id, roles, is_active FROM users WHERE id=? LIMIT 1", [userId]);
      const user = userRows?.[0];
      if (!user || !user.is_active) throw new AppError("NOT_FOUND", "User not found or inactive");

      const roles: string[] = JSON.parse(user.roles ?? '["viewer"]');
      const sessionId = nanoid();
      const allowedScope = Array.isArray(scope) ? scope.slice(0, 10).map((v:any)=>String(v)) : ["read"];

      // Store impersonation session in Redis (TTL: 15 min = access token lifetime)
      const impKey = `imp:${tenantId}:${actor}:${sessionId}`;
      await opts.redis.setex(impKey, 600, JSON.stringify({ targetUserId: String(userId), reason, ticketId, actor, scope: allowedScope, ts: Date.now() }));

      const token = await opts.jwtService.signAccess({
        sub: String(userId),
        tid: tenantId,
        roles,
        sid: sessionId,
        imp: true,
        act: actor,
        tkv: 0,
      });

      await appendAudit(pool, {
        actor_user_id: actor,
        tenant_id: tenantId,
        action: "support_impersonation",
        resource: "users",
        resource_id: String(userId),
        ip: req.ip,
        user_agent: String(req.headers["user-agent"] ?? ""),
        request_id: (req as any).id,
        after_json: { reason, ticketId, scope: allowedScope },
      });

      res.json({ data: { accessToken: token, expiresIn: 900 }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  // ── Feature flags ──────────────────────────────────────────────────────────

  router.get("/tenants/:tenantId/features", async (req, res, next) => {
    try {
      const { tenantId } = req.params;
      const [rows] = await opts.masterPool.query<any[]>(
        "SELECT feature_key, enabled FROM tenant_features WHERE tenant_id=? ORDER BY feature_key",
        [tenantId]
      );
      res.json({ data: rows, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  router.put("/tenants/:tenantId/features/:featureKey", async (req, res, next) => {
    try {
      const { tenantId, featureKey } = req.params;
      const { enabled } = req.body ?? {};
      if (typeof enabled !== "boolean") throw new AppError("VALIDATION_ERROR", "enabled must be boolean");
      await opts.featureFlags.setFlag(tenantId, featureKey, enabled);
      res.json({ data: { ok: true }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  // ── DEK rotation ──────────────────────────────────────────────────────────

  router.post("/tenants/:tenantId/dek-rotate", async (req, res, next) => {
    try {
      const { tenantId } = req.params;
      const [rows] = await opts.masterPool.query<any[]>("SELECT db_name FROM tenants WHERE tenant_id=? LIMIT 1", [tenantId]);
      if (!rows?.length) throw new AppError("TENANT_NOT_FOUND", "Tenant not found");

      await opts.queue.add("dek-rotation", { tenantId, dbName: rows[0].db_name }, { attempts: 3, backoff: { type: "exponential", delay: 5000 } });

      logger.info({ tenantId }, "DEK rotation job enqueued");
      res.json({ data: { queued: true }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  // Also allow synchronous rotation for low-volume tenants
  router.post("/tenants/:tenantId/rotate-dek", async (req, res, next) => {
    try {
      const { tenantId } = req.params;
      if (!tenantId) throw new AppError("VALIDATION_ERROR", "tenantId required");
      const nextVersion = await opts.kms.rotateDek(tenantId);
      res.json({ data: { tenantId, newKeyVersion: nextVersion }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  // ── Plugins ────────────────────────────────────────────────────────────────

  router.get("/tenants/:tenantId/plugins", async (req, res, next) => {
    try {
      const { tenantId } = req.params;
      const [rows] = await opts.masterPool.query<any[]>("SELECT plugin_key, enabled, config_json, created_at FROM tenant_plugins WHERE tenant_id=? ORDER BY plugin_key", [tenantId]);
      return res.json({ data: rows, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { return next(e); }
  });

  router.post("/tenants/:tenantId/plugins", async (req, res, next) => {
    try {
      const { tenantId } = req.params;
      const { plugin_key, enabled, config } = req.body || {};
      if (!plugin_key) throw new AppError("VALIDATION_ERROR", "plugin_key required");
      await opts.masterPool.query(
        "INSERT INTO tenant_plugins (tenant_id, plugin_key, enabled, config_json) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE enabled=VALUES(enabled), config_json=VALUES(config_json)",
        [tenantId, String(plugin_key), enabled ? 1 : 0, config ? JSON.stringify(config) : null]
      );
      return res.json({ data: { ok: true, tenantId, plugin_key, enabled: !!enabled }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { return next(e); }
  });

  // ── Audit log (read-only for support) ────────────────────────────────────

  router.get("/tenants/:tenantId/audit", async (req, res, next) => {
    try {
      const { tenantId } = req.params;
      const limit = Math.min(Number(req.query.limit ?? 100), 500);
      const offset = Number(req.query.offset ?? 0);
      const action = req.query.action ? String(req.query.action) : null;

      const [tenantRows] = await opts.masterPool.query<any[]>("SELECT db_name FROM tenants WHERE tenant_id=? LIMIT 1", [tenantId]);
      if (!tenantRows?.length) throw new AppError("TENANT_NOT_FOUND", "Tenant not found");

      const pool = opts.tenantPoolFactory(String(tenantRows[0].db_name));
      const [rows] = await pool.query<any[]>(
        `SELECT id, ts, seq, actor_user_id, action, resource, resource_id, ip, request_id
         FROM auditoria_log
         WHERE tenant_id=? ${action ? "AND action=?" : ""}
         ORDER BY seq DESC LIMIT ? OFFSET ?`,
        action ? [tenantId, action, limit, offset] : [tenantId, limit, offset]
      );
      res.json({ data: rows, meta: { requestId: (req as any).id, limit, offset }, errors: [] });
    } catch (e) { next(e); }
  });

  return router;
}
