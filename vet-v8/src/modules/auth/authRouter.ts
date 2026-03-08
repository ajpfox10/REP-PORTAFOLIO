import { Router } from "express";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import type Redis from "ioredis";
import { AppError } from "../../core/errors/appError.js";
import { type JwtService } from "../../security/auth/jwtService.js";
import { appendAudit } from "../../audit/auditRepo.js";
import { generateBase32Secret, verifyTotp } from "../../security/auth/totp.js";
import { generateRecoveryCodes, hashRecoveryCode } from "../../security/auth/recoveryCodes.js";
import { type AppConfig } from "../../config/types.js";
import { type KmsEnvelope } from "../../security/encryption/kmsEnvelope.js";
import { buildRateLimiter } from "../../infra/rate-limit/rateLimiter.js";
import { getCtx, getRequestId, ok } from "../../core/http/requestCtx.js";
import { validatePasswordPolicy } from "../../security/password/passwordPolicy.js";

export function buildAuthRouter(opts: {
  jwtService: JwtService;
  redis: Redis;
  config: AppConfig;
  kms: KmsEnvelope;
}) {
  const router = Router();
  const { kms } = opts;

  const RT_TTL_SECONDS = 60 * 60 * 24 * 7;

  // Auth-specific rate limiter
  const rateLimiter = buildRateLimiter({ config: opts.config, redis: opts.redis });
  const authLimit = rateLimiter.auth();

  function failedUserKey(tenantId: string, email: string) { return `auth_fail:user:${tenantId}:${email}`; }
  function failedIpKey(tenantId: string, ip: string) { return `auth_fail:ip:${tenantId}:${ip}`; }
  async function assertNotLocked(tenantId: string, email: string, ip: string) {
    const [u, i] = await Promise.all([
      opts.redis.get(failedUserKey(tenantId, email)),
      opts.redis.get(failedIpKey(tenantId, ip)),
    ]);
    if ((Number(u ?? 0) >= opts.config.authMaxFailedAttempts) || (Number(i ?? 0) >= opts.config.authMaxFailedAttempts * 2)) {
      throw new AppError("AUTH_REQUIRED", "Account temporarily locked due to repeated failed logins", 429);
    }
  }
  async function registerFailedLogin(tenantId: string, email: string, ip: string) {
    const ttl = opts.config.authLockoutSeconds;
    const uk = failedUserKey(tenantId, email);
    const ik = failedIpKey(tenantId, ip);
    await Promise.all([
      opts.redis.multi().incr(uk).expire(uk, ttl).exec(),
      opts.redis.multi().incr(ik).expire(ik, ttl).exec(),
    ]);
  }
  async function clearFailedLogin(tenantId: string, email: string, ip: string) {
    await Promise.all([
      opts.redis.del(failedUserKey(tenantId, email)),
      opts.redis.del(failedIpKey(tenantId, ip)),
    ]);
  }

  function rtKey(tenantId: string, userId: string, sessionId: string) {
    return `rt:${tenantId}:${userId}:${sessionId}`;
  }
  function sessIndexKey(tenantId: string, userId: string) {
    return `rt_sessions:${tenantId}:${userId}`;
  }
  async function listSessionIds(tenantId: string, userId: string): Promise<string[]> {
    return (await opts.redis.smembers(sessIndexKey(tenantId, userId))) ?? [];
  }
  async function revokeSession(tenantId: string, userId: string, sessionId: string) {
    await opts.redis.del(rtKey(tenantId, userId, sessionId));
    await opts.redis.srem(sessIndexKey(tenantId, userId), sessionId);
  }

  /**
   * POST /api/v1/auth/login
   */
  router.post("/login", authLimit, async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      const { email, password, mfaCode } = req.body ?? {};
      if (!email || !password) throw new AppError("VALIDATION_ERROR", "email and password required");
      const normalizedEmail = String(email).toLowerCase().trim();
      const ip = String(req.ip ?? "");
      await assertNotLocked(ctx.tenantId, normalizedEmail, ip);

      const [rows] = await ctx.tenantPool.query<any[]>(
        `SELECT id, email, password_hash, roles, sucursal_id, veterinario_id,
                is_active, mfa_enabled, totp_secret_enc, token_version
         FROM users WHERE email=? LIMIT 1`,
        [normalizedEmail]
      );
      const user = rows?.[0];
      if (!user || !user.is_active) {
        await registerFailedLogin(ctx.tenantId, normalizedEmail, ip);
        throw new AppError("AUTH_REQUIRED", "Invalid credentials");
      }

      const valid = await bcrypt.compare(String(password), String(user.password_hash));
      if (!valid) {
        await registerFailedLogin(ctx.tenantId, normalizedEmail, ip);
        throw new AppError("AUTH_REQUIRED", "Invalid credentials");
      }

      if (user.mfa_enabled) {
        if (!mfaCode) throw new AppError("MFA_REQUIRED", "MFA code required");
        if (!user.totp_secret_enc) throw new AppError("CONFIG_ERROR", "MFA not configured");
        const secret = await kms.decryptJson<string>(ctx.tenantId, String(user.totp_secret_enc));
        if (!verifyTotp({ secretBase32: secret, code: String(mfaCode) })) {
          throw new AppError("AUTH_REQUIRED", "Invalid MFA code");
        }
      }

      await clearFailedLogin(ctx.tenantId, normalizedEmail, ip);

      const roles: string[] = JSON.parse(user.roles ?? '["viewer"]');
      const tokenVersion: number = Number(user.token_version ?? 0);
      const sessionId = nanoid();
      const familyId = nanoid();

      const accessToken = await opts.jwtService.signAccess({
        sid: sessionId,
        sub: String(user.id),
        tid: ctx.tenantId,
        roles,
        sucursal_id: user.sucursal_id ?? undefined,
        veterinario_id: user.veterinario_id ?? undefined,
        tkv: tokenVersion,
      });

      const refreshToken = await opts.jwtService.signRefresh({ userId: String(user.id), tenantId: ctx.tenantId, tokenVersion, sessionId, familyId });
      const rtDecoded = await opts.jwtService.verifyRefresh(refreshToken);
      const key = rtKey(ctx.tenantId, String(user.id), sessionId);
      await opts.redis.set(key, JSON.stringify({
        currentJti: rtDecoded.jti,
        familyId,
        version: tokenVersion,
        createdAt: Date.now(),
        ip: req.ip,
        ua: String(req.headers["user-agent"] ?? ""),
      }), "EX", RT_TTL_SECONDS);
      await opts.redis.sadd(sessIndexKey(ctx.tenantId, String(user.id)), sessionId);
      await opts.redis.expire(sessIndexKey(ctx.tenantId, String(user.id)), RT_TTL_SECONDS);

      await ctx.tenantPool.query("UPDATE users SET last_login_at=NOW() WHERE id=?", [String(user.id)]);

      await appendAudit(ctx.tenantPool, {
        actor_user_id: String(user.id), tenant_id: ctx.tenantId,
        action: "login", resource: "auth", resource_id: String(user.id),
        ip: req.ip, user_agent: String(req.headers["user-agent"] ?? ""),
        request_id: (req as any).id,
      });

      res.json({ data: { accessToken, refreshToken, expiresIn: 900, roles, sessionId }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  /**
   * GET /api/v1/auth/me
   * Returns current user profile.
   */
  router.get("/me", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      if (!ctx.userId) throw new AppError("AUTH_REQUIRED", "Login required");

      const [rows] = await ctx.tenantPool.query<any[]>(
        `SELECT id, email, roles, mfa_enabled, sucursal_id, veterinario_id, locale, last_login_at, created_at
         FROM users WHERE id=? AND is_active=1 LIMIT 1`,
        [ctx.userId]
      );
      const user = rows?.[0];
      if (!user) throw new AppError("NOT_FOUND", "User not found");

      res.json({
        data: {
          id: user.id,
          email: user.email,
          roles: JSON.parse(user.roles ?? '["viewer"]'),
          mfaEnabled: Boolean(user.mfa_enabled),
          sucursalId: user.sucursal_id ?? null,
          veterinarioId: user.veterinario_id ?? null,
          locale: user.locale ?? "es",
          lastLoginAt: user.last_login_at,
          tenantId: ctx.tenantId,
        },
        meta: { requestId: (req as any).id },
        errors: [],
      });
    } catch (e) { next(e); }
  });

  /**
   * POST /api/v1/auth/refresh — token rotation + theft detection
   */
  router.post("/refresh", authLimit, async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      const { refreshToken } = req.body ?? {};
      if (!refreshToken) throw new AppError("AUTH_REQUIRED", "refreshToken required");

      const decoded = await opts.jwtService.verifyRefresh(String(refreshToken));
      if (decoded.tid !== ctx.tenantId) throw new AppError("AUTH_REQUIRED", "Token tenant mismatch");

      const sessionId = String(decoded.sid ?? "");
      if (!sessionId) throw new AppError("AUTH_REQUIRED", "Refresh token missing session id");
      const key = rtKey(ctx.tenantId, decoded.sub, sessionId);
      const stored = await opts.redis.get(key);

      if (!stored) throw new AppError("AUTH_REQUIRED", "Refresh token revoked");

      let storedData: { currentJti: string; familyId: string; version: number };
      try { storedData = JSON.parse(stored); } catch { throw new AppError("AUTH_REQUIRED", "Invalid token record"); }

      if (storedData.currentJti !== String(decoded.jti)) {
        // THEFT DETECTION: revoke this session
        await revokeSession(ctx.tenantId, decoded.sub, sessionId);
        await appendAudit(ctx.tenantPool, {
          actor_user_id: decoded.sub, tenant_id: ctx.tenantId,
          action: "refresh_token_theft_detected", resource: "auth", resource_id: decoded.sub,
          ip: req.ip, user_agent: String(req.headers["user-agent"] ?? ""),
          request_id: (req as any).id,
        });
        throw new AppError("AUTH_REQUIRED", "Refresh token reuse detected — session revoked");
      }

      const [rows] = await ctx.tenantPool.query<any[]>(
        "SELECT id, roles, sucursal_id, veterinario_id, is_active, token_version FROM users WHERE id=? LIMIT 1",
        [decoded.sub]
      );
      const user = rows?.[0];
      if (!user || !user.is_active) throw new AppError("AUTH_REQUIRED", "User inactive");

      const tokenVersion: number = Number(user.token_version ?? 0);
      if (Number(decoded.tkv ?? 0) < tokenVersion) {
        await revokeSession(ctx.tenantId, decoded.sub, sessionId);
        throw new AppError("AUTH_REQUIRED", "Token invalidated — please log in again");
      }

      const roles: string[] = JSON.parse(user.roles ?? '["viewer"]');

      const newAccessToken = await opts.jwtService.signAccess({
        sub: decoded.sub, tid: ctx.tenantId, roles, sid: sessionId,
        sucursal_id: user.sucursal_id ?? undefined,
        veterinario_id: user.veterinario_id ?? undefined,
        tkv: tokenVersion,
      });
      const newRefreshToken = await opts.jwtService.signRefresh({ userId: decoded.sub, tenantId: ctx.tenantId, tokenVersion, sessionId, familyId: storedData.familyId });

      const newDecoded = await opts.jwtService.verifyRefresh(newRefreshToken);
      await opts.redis.set(key, JSON.stringify({
        currentJti: newDecoded.jti,
        familyId: storedData.familyId,
        version: tokenVersion,
        lastSeenAt: Date.now(),
        ip: req.ip,
        ua: String(req.headers["user-agent"] ?? ""),
      }), "EX", RT_TTL_SECONDS);

      res.json({ data: { accessToken: newAccessToken, refreshToken: newRefreshToken, expiresIn: 900, sessionId }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  /**
   * POST /api/v1/auth/logout
   */
  router.post("/logout", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      if (ctx.userId) {
        const sid = String(ctx.sessionId ?? "");
        if (sid) await revokeSession(ctx.tenantId, ctx.userId, sid);
        await appendAudit(ctx.tenantPool, {
          actor_user_id: ctx.userId, tenant_id: ctx.tenantId,
          action: "logout", resource: "auth", resource_id: ctx.userId,
          ip: req.ip, user_agent: String(req.headers["user-agent"] ?? ""),
          request_id: (req as any).id,
        });
      }
      res.json({ data: { ok: true }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  /**
   * POST /api/v1/auth/logout-all
   */
  router.post("/logout-all", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      if (!ctx.userId) throw new AppError("AUTH_REQUIRED", "Login required");

      await ctx.tenantPool.query("UPDATE users SET token_version = token_version + 1 WHERE id=?", [ctx.userId]);
      const sids = await listSessionIds(ctx.tenantId, ctx.userId);
      for (const sid of sids) await revokeSession(ctx.tenantId, ctx.userId, sid);
      await opts.redis.del(sessIndexKey(ctx.tenantId, ctx.userId));

      await appendAudit(ctx.tenantPool, {
        actor_user_id: ctx.userId, tenant_id: ctx.tenantId,
        action: "logout_all_sessions", resource: "auth", resource_id: ctx.userId,
        ip: req.ip, user_agent: String(req.headers["user-agent"] ?? ""),
        request_id: (req as any).id,
      });

      res.json({ data: { ok: true }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  /**
   * GET /api/v1/auth/sessions
   */
  router.get("/sessions", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      if (!ctx.userId) throw new AppError("AUTH_REQUIRED", "Login required");
      const sids = await listSessionIds(ctx.tenantId, ctx.userId);
      const sessions: any[] = [];
      for (const sid of sids) {
        const raw = await opts.redis.get(rtKey(ctx.tenantId, ctx.userId, sid));
        if (!raw) continue;
        try {
          const data = JSON.parse(raw);
          // Strip sensitive JTI from response
          const { currentJti: _jti, ...safe } = data;
          sessions.push({ sessionId: sid, isCurrent: sid === ctx.sessionId, ...safe });
        } catch {
          sessions.push({ sessionId: sid });
        }
      }
      res.json({ data: { sessions }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  /**
   * DELETE /api/v1/auth/sessions/:sessionId
   */
  router.delete("/sessions/:sessionId", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      if (!ctx.userId) throw new AppError("AUTH_REQUIRED", "Login required");
      const sessionId = String(req.params.sessionId ?? "");
      if (!sessionId) throw new AppError("VALIDATION_ERROR", "sessionId required");
      await revokeSession(ctx.tenantId, ctx.userId, sessionId);
      await appendAudit(ctx.tenantPool, {
        actor_user_id: ctx.userId, tenant_id: ctx.tenantId,
        action: "revoke_session", resource: "auth", resource_id: ctx.userId,
        ip: req.ip, user_agent: String(req.headers["user-agent"] ?? ""),
        request_id: (req as any).id,
        after_json: { revokedSessionId: sessionId },
      });
      res.json({ data: { ok: true }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  /**
   * POST /api/v1/auth/sessions/revoke-others
   */
  router.post("/sessions/revoke-others", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      if (!ctx.userId) throw new AppError("AUTH_REQUIRED", "Login required");
      const current = String(ctx.sessionId ?? "");
      const sids = await listSessionIds(ctx.tenantId, ctx.userId);
      let revoked = 0;
      for (const sid of sids) {
        if (current && sid === current) continue;
        await revokeSession(ctx.tenantId, ctx.userId, sid);
        revoked++;
      }
      res.json({ data: { ok: true, revoked }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  /**
   * POST /api/v1/auth/change-password
   */
  router.post("/change-password", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      if (!ctx.userId) throw new AppError("AUTH_REQUIRED", "Login required");
      const { currentPassword, newPassword } = req.body ?? {};
      if (!currentPassword || !newPassword) throw new AppError("VALIDATION_ERROR", "currentPassword and newPassword required");
      if (currentPassword === newPassword) throw new AppError("VALIDATION_ERROR", "New password must differ from current password");

      const [rows] = await ctx.tenantPool.query<any[]>("SELECT password_hash, email, mfa_enabled FROM users WHERE id=? LIMIT 1", [ctx.userId]);
      const user = rows?.[0];
      if (!user) throw new AppError("NOT_FOUND", "User not found");

      const valid = await bcrypt.compare(String(currentPassword), String(user.password_hash));
      if (!valid) throw new AppError("AUTH_REQUIRED", "Current password is incorrect");

      validatePasswordPolicy(String(newPassword), { email: String(user.email ?? ""), minLength: opts.config.authPasswordMinLength });
      if (Boolean(user.mfa_enabled)) {
        const step = String(req.header("x-stepup-token") ?? "");
        if (!step) throw new AppError("MFA_STEP_UP_REQUIRED", "MFA step-up required", 401);
        const ok = await opts.redis.get(`stepup:${ctx.tenantId}:${ctx.userId}:${step}`);
        if (!ok) throw new AppError("MFA_STEP_UP_REQUIRED", "Step-up expired or invalid", 401);
      }

      const hash = await bcrypt.hash(String(newPassword), 12);
      await ctx.tenantPool.query(
        "UPDATE users SET password_hash=?, token_version = token_version + 1 WHERE id=?",
        [hash, ctx.userId]
      );

      const sids = await listSessionIds(ctx.tenantId, ctx.userId);
      for (const sid of sids) await revokeSession(ctx.tenantId, ctx.userId, sid);
      await opts.redis.del(sessIndexKey(ctx.tenantId, ctx.userId));

      await appendAudit(ctx.tenantPool, {
        actor_user_id: ctx.userId, tenant_id: ctx.tenantId,
        action: "change_password", resource: "auth", resource_id: ctx.userId,
        ip: req.ip, user_agent: String(req.headers["user-agent"] ?? ""),
        request_id: (req as any).id,
      });

      res.json({ data: { ok: true }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  /**
   * POST /api/v1/auth/mfa/setup
   */
  router.post("/mfa/setup", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      if (!ctx.userId) throw new AppError("AUTH_REQUIRED", "Login required");

      const secret = generateBase32Secret(20);
      const label = encodeURIComponent(`vet:${ctx.tenantId}:${ctx.userId}`);
      const issuer = encodeURIComponent("veterinaria-saas");
      const otpauthUrl = `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&digits=6&period=30`;

      await ctx.tenantPool.query(
        "UPDATE users SET totp_secret_enc=?, mfa_enabled=0 WHERE id=?",
        [await kms.encryptJson(ctx.tenantId, secret), ctx.userId]
      );

      res.json({ data: { secretBase32: secret, otpauthUrl }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  /**
   * POST /api/v1/auth/mfa/verify
   */
  router.post("/mfa/verify", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      const { code } = req.body ?? {};
      if (!ctx.userId) throw new AppError("AUTH_REQUIRED", "Login required");
      if (!code) throw new AppError("VALIDATION_ERROR", "code required");

      const [rows] = await ctx.tenantPool.query<any[]>(
        "SELECT totp_secret_enc FROM users WHERE id=? LIMIT 1", [ctx.userId]
      );
      const rec = rows?.[0];
      if (!rec?.totp_secret_enc) throw new AppError("VALIDATION_ERROR", "MFA not initialized — call /mfa/setup first");

      const secret = await kms.decryptJson<string>(ctx.tenantId, String(rec.totp_secret_enc));
      if (!verifyTotp({ secretBase32: secret, code: String(code) })) {
        throw new AppError("AUTH_REQUIRED", "Invalid MFA code");
      }

      await ctx.tenantPool.query("UPDATE users SET mfa_enabled=1 WHERE id=?", [ctx.userId]);
      res.json({ data: { ok: true }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  /**
   * DELETE /api/v1/auth/mfa — disable MFA (requires current TOTP code)
   */
  router.delete("/mfa", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      const { code } = req.body ?? {};
      if (!ctx.userId) throw new AppError("AUTH_REQUIRED", "Login required");
      if (!code) throw new AppError("VALIDATION_ERROR", "TOTP code required to disable MFA");

      const [rows] = await ctx.tenantPool.query<any[]>(
        "SELECT totp_secret_enc FROM users WHERE id=? AND mfa_enabled=1 LIMIT 1", [ctx.userId]
      );
      const rec = rows?.[0];
      if (!rec?.totp_secret_enc) throw new AppError("NOT_FOUND", "MFA not enabled");

      const secret = await kms.decryptJson<string>(ctx.tenantId, String(rec.totp_secret_enc));
      if (!verifyTotp({ secretBase32: secret, code: String(code) })) {
        throw new AppError("AUTH_REQUIRED", "Invalid MFA code");
      }

      await ctx.tenantPool.query("UPDATE users SET mfa_enabled=0, totp_secret_enc=NULL WHERE id=?", [ctx.userId]);
      await appendAudit(ctx.tenantPool, {
        actor_user_id: ctx.userId, tenant_id: ctx.tenantId,
        action: "mfa_disabled", resource: "auth", resource_id: ctx.userId,
        ip: req.ip, user_agent: String(req.headers["user-agent"] ?? ""),
        request_id: (req as any).id,
      });
      res.json({ data: { ok: true }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  /**
   * POST /api/v1/auth/mfa/step-up
   */
  router.post("/mfa/step-up", authLimit, async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      const { code } = req.body || {};
      if (!ctx.userId) throw new AppError("AUTH_REQUIRED", "Login required");

      const [rows] = await ctx.tenantPool.query<any[]>(
        "SELECT totp_secret_enc, mfa_enabled FROM users WHERE id=?", [ctx.userId]
      );
      const u = rows?.[0];
      if (!u?.mfa_enabled) throw new AppError("MFA_NOT_ENABLED", "MFA not enabled", 400);
      if (!code) throw new AppError("VALIDATION_ERROR", "code required");

      // FIX: was calling non-existent kms.decryptForTenant — use decryptJson
      const secret = await kms.decryptJson<string>(ctx.tenantId, String(u.totp_secret_enc));
      if (!verifyTotp({ secretBase32: secret, code: String(code) })) {
        throw new AppError("MFA_INVALID", "Invalid MFA code", 401);
      }

      const token = nanoid(24);
      const key = `stepup:${ctx.tenantId}:${ctx.userId}:${token}`;
      await opts.redis.setex(key, 300, "1");
      return res.json({ data: { stepup_token: token, ttlSeconds: 300 }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { return next(e); }
  });

  /**
   * POST /api/v1/auth/mfa/recovery-codes/regenerate
   */
  router.post("/mfa/recovery-codes/regenerate", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      if (!ctx.userId) throw new AppError("AUTH_REQUIRED", "Login required");

      const step = req.header("x-stepup-token");
      if (!step) throw new AppError("MFA_STEP_UP_REQUIRED", "MFA step-up required", 401);
      const ok = await opts.redis.get(`stepup:${ctx.tenantId}:${ctx.userId}:${step}`);
      if (!ok) throw new AppError("MFA_STEP_UP_REQUIRED", "Step-up expired or invalid", 401);

      const [rows] = await ctx.tenantPool.query<any[]>("SELECT mfa_enabled FROM users WHERE id=?", [ctx.userId]);
      if (!rows?.[0]?.mfa_enabled) throw new AppError("MFA_NOT_ENABLED", "MFA not enabled", 400);

      const codes = generateRecoveryCodes(10);
      await ctx.tenantPool.query("DELETE FROM auth_recovery_codes WHERE user_id=?", [ctx.userId]);
      for (const c of codes) {
        await ctx.tenantPool.query(
          "INSERT INTO auth_recovery_codes (user_id, code_hash, used, created_at) VALUES (?,?,0,NOW())",
          [ctx.userId, hashRecoveryCode(c)]
        );
      }

      await appendAudit(ctx.tenantPool, {
        actor_user_id: ctx.userId, tenant_id: ctx.tenantId,
        action: "mfa_recovery_codes_regenerated", resource: "auth", resource_id: ctx.userId,
        ip: req.ip, user_agent: String(req.headers["user-agent"] ?? ""),
        request_id: (req as any).id,
      });
      return res.json({ data: { codes }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { return next(e); }
  });

  return router;
}
