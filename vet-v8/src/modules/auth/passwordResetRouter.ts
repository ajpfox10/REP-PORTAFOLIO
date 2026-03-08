import { Router } from "express";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import type Redis from "ioredis";
import { z } from "zod";
import { AppError } from "../../core/errors/appError.js";
import { buildRateLimiter } from "../../infra/rate-limit/rateLimiter.js";
import type { AppConfig } from "../../config/types.js";
import { Queue } from "bullmq";
import { getCtx } from "../../core/http/requestCtx.js";
import { validatePasswordPolicy } from "../../security/password/passwordPolicy.js";
import { type KmsEnvelope } from "../../security/encryption/kmsEnvelope.js";
import { verifyTotp } from "../../security/auth/totp.js";
import { hashRecoveryCode } from "../../security/auth/recoveryCodes.js";

const TOKEN_TTL = 60 * 15;

export function buildPasswordResetRouter(opts: {
  redis: Redis;
  config: AppConfig;
  kms: KmsEnvelope;
}) {
  const router = Router();
  const rl = buildRateLimiter({ config: opts.config, redis: opts.redis });

  function recoveryKey(tenantId: string, token: string) {
    return `pw_reset:${tenantId}:${token}`;
  }
  function sessionsKey(tenantId: string, userId: string) {
    return `rt_sessions:${tenantId}:${userId}`;
  }

  router.post("/forgot-password", rl.auth(), async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      const { email } = z.object({ email: z.string().email() }).parse(req.body ?? {});

      const [rows] = await ctx.tenantPool.query<any[]>(
        "SELECT id, email, mfa_enabled FROM users WHERE email=? AND is_active=1 LIMIT 1",
        [String(email).toLowerCase().trim()]
      );
      if (!rows?.length) {
        return res.json({ data: { ok: true }, meta: { requestId: (req as any).id }, errors: [] });
      }

      const user = rows[0];
      const token = nanoid(48);
      await opts.redis.set(
        recoveryKey(ctx.tenantId, token),
        JSON.stringify({ userId: user.id, email: user.email, mfaEnabled: Boolean(user.mfa_enabled) }),
        "EX", TOKEN_TTL
      );

      const resetUrl = `${process.env.FRONTEND_URL ?? "https://app.vetpro.com"}/auth/reset-password#token=${encodeURIComponent(token)}&tenant=${encodeURIComponent(ctx.tenantId)}`;
      const q = new Queue("jobs", { connection: opts.redis });
      await q.add("send-email", {
        to: user.email,
        subject: "Recuperación de contraseña — VetPro",
        body: `Solicitaste restablecer tu contraseña. Enlace válido por 15 minutos:\n${resetUrl}\n${Boolean(user.mfa_enabled) ? "Tu cuenta tiene MFA activo: también vas a necesitar tu código TOTP o un recovery code." : ""}`,
        bodyHtml: `<p>Solicitaste restablecer tu contraseña.</p><p><a href="${resetUrl}">Restablecer contraseña</a></p><p>Este enlace vence en 15 minutos.</p>${Boolean(user.mfa_enabled) ? "<p>Tu cuenta tiene MFA activo. El formulario también pedirá un código TOTP o recovery code.</p>" : ""}`,
        tenantId: ctx.tenantId,
      });

      return res.json({ data: { ok: true }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  router.post("/reset-password", rl.auth(), async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      const { token, newPassword, mfaCodeOrRecoveryCode } = z.object({
        token: z.string().min(20),
        newPassword: z.string().min(opts.config.authPasswordMinLength).max(128),
        mfaCodeOrRecoveryCode: z.string().optional(),
      }).parse(req.body ?? {});

      const stored = await opts.redis.get(recoveryKey(ctx.tenantId, token));
      if (!stored) throw new AppError("AUTH_REQUIRED", "Token inválido o expirado");
      const payload = JSON.parse(stored) as { userId: string; email: string; mfaEnabled?: boolean };

      validatePasswordPolicy(newPassword, { email: payload.email, minLength: opts.config.authPasswordMinLength });

      const [rows] = await ctx.tenantPool.query<any[]>(
        "SELECT id, email, mfa_enabled, totp_secret_enc, password_hash FROM users WHERE id=? AND tenant_id=? LIMIT 1",
        [payload.userId, ctx.tenantId]
      );
      const user = rows?.[0];
      if (!user) throw new AppError("NOT_FOUND", "User not found");
      const samePassword = await bcrypt.compare(newPassword, String(user.password_hash));
      if (samePassword) throw new AppError("VALIDATION_ERROR", "New password must differ from current password");

      if (opts.config.authRequireMfaOnReset && user.mfa_enabled) {
        const candidate = String(mfaCodeOrRecoveryCode ?? "").trim();
        if (!candidate) throw new AppError("MFA_STEP_UP_REQUIRED", "MFA code or recovery code required", 401);
        let validSecondFactor = false;
        if (/^\d{6,8}$/.test(candidate) && user.totp_secret_enc) {
          const secret = await opts.kms.decryptJson<string>(ctx.tenantId, String(user.totp_secret_enc));
          validSecondFactor = verifyTotp({ secretBase32: secret, code: candidate });
        }
        if (!validSecondFactor) {
          const [recoveryRows] = await ctx.tenantPool.query<any[]>(
            "SELECT id, code_hash FROM auth_recovery_codes WHERE user_id=? AND used=0",
            [payload.userId]
          );
          const hashed = hashRecoveryCode(candidate.replace(/\s+/g, "").toUpperCase());
          const match = (recoveryRows ?? []).find((r: any) => String(r.code_hash) === hashed);
          if (match) {
            validSecondFactor = true;
            await ctx.tenantPool.query("UPDATE auth_recovery_codes SET used=1, used_at=NOW() WHERE id=?", [match.id]);
          }
        }
        if (!validSecondFactor) throw new AppError("AUTH_REQUIRED", "Invalid MFA verification for password reset");
      }

      const hash = await bcrypt.hash(newPassword, 12);
      await ctx.tenantPool.query(
        "UPDATE users SET password_hash=?, token_version=token_version+1, updated_at=NOW() WHERE id=? AND tenant_id=?",
        [hash, payload.userId, ctx.tenantId]
      );

      const sessionIds = await opts.redis.smembers(sessionsKey(ctx.tenantId, String(payload.userId)));
      for (const sid of sessionIds ?? []) await opts.redis.del(`rt:${ctx.tenantId}:${payload.userId}:${sid}`);
      await opts.redis.del(sessionsKey(ctx.tenantId, String(payload.userId)));
      await opts.redis.del(recoveryKey(ctx.tenantId, token));

      return res.json({ data: { ok: true }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  const verifyResetTokenHandler = async (req: any, res: any, next: any) => {
    try {
      const ctx = getCtx(req);
      const token = String(req.body?.token ?? req.query.token ?? "");
      const stored = await opts.redis.get(recoveryKey(ctx.tenantId, token));
      if (!stored) return res.json({ data: { valid: false }, meta: { requestId: (req as any).id }, errors: [] });
      const parsed = JSON.parse(stored) as { mfaEnabled?: boolean };
      return res.json({ data: { valid: true, requiresSecondFactor: Boolean(parsed.mfaEnabled && opts.config.authRequireMfaOnReset) }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  };

  router.post("/verify-reset-token", verifyResetTokenHandler);
  router.get("/verify-reset-token", verifyResetTokenHandler);

  return router;
}
