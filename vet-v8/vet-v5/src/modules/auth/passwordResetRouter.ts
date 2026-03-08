/**
 * Password recovery flow:
 *   1. POST /api/v1/auth/forgot-password  { email }  → genera token, envía email
 *   2. POST /api/v1/auth/reset-password   { token, newPassword } → valida y resetea
 *
 * Token: nanoid(32), stored in Redis with TTL=15min, scoped to tenant+email.
 */

import { Router } from "express";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import type Redis from "ioredis";
import { z } from "zod";
import { AppError } from "../../core/errors/appError.js";
import { buildRateLimiter } from "../../infra/rate-limit/rateLimiter.js";
import type { AppConfig } from "../../config/types.js";
import { Queue } from "bullmq";

const TOKEN_TTL = 60 * 15; // 15 min

export function buildPasswordResetRouter(opts: {
  redis: Redis;
  config: AppConfig;
}) {
  const router = Router();
  const rl = buildRateLimiter({ config: opts.config, redis: opts.redis });

  function recoveryKey(tenantId: string, token: string) {
    return `pw_reset:${tenantId}:${token}`;
  }

  /**
   * POST /api/v1/auth/forgot-password
   * Always returns 200 to avoid email enumeration.
   */
  router.post("/forgot-password", rl.auth(), async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      const { email } = z.object({ email: z.string().email() }).parse(req.body ?? {});

      const [rows] = await ctx.tenantPool.query<any[]>(
        "SELECT id, email FROM users WHERE email=? AND is_active=1 LIMIT 1",
        [String(email).toLowerCase().trim()]
      );

      // Always 200 — never reveal if email exists
      if (!rows?.length) {
        return res.json({ data: { ok: true }, meta: { requestId: (req as any).id }, errors: [] });
      }

      const user = rows[0];
      const token = nanoid(32);
      await opts.redis.set(
        recoveryKey(ctx.tenantId, token),
        JSON.stringify({ userId: user.id, email: user.email }),
        "EX", TOKEN_TTL
      );

      const resetUrl = `${process.env.FRONTEND_URL ?? "https://app.vetpro.com"}/auth/reset-password?token=${token}&tenant=${ctx.tenantId}`;

      const q = new Queue("jobs", { connection: opts.redis });
      await q.add("send-email", {
        to: user.email,
        subject: "Recuperación de contraseña — VetPro",
        body: `Recibiste este email porque solicitaste restablecer tu contraseña.\n\nHacé clic en el siguiente enlace (válido 15 minutos):\n${resetUrl}\n\nSi no lo solicitaste, ignorá este mensaje.`,
        bodyHtml: `
          <p>Recibiste este email porque solicitaste restablecer tu contraseña en <strong>VetPro</strong>.</p>
          <p><a href="${resetUrl}" style="background:#4f46e5;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block">Restablecer contraseña</a></p>
          <p style="color:#6b7280;font-size:12px">Este enlace vence en 15 minutos. Si no lo solicitaste, ignorá este mensaje.</p>
        `,
        tenantId: ctx.tenantId,
      });

      return res.json({ data: { ok: true }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  /**
   * POST /api/v1/auth/reset-password
   */
  router.post("/reset-password", rl.auth(), async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      const { token, newPassword } = z.object({
        token: z.string().min(10),
        newPassword: z.string().min(8).max(128),
      }).parse(req.body ?? {});

      const stored = await opts.redis.get(recoveryKey(ctx.tenantId, token));
      if (!stored) throw new AppError("AUTH_REQUIRED", "Token inválido o expirado");

      const { userId } = JSON.parse(stored) as { userId: string; email: string };

      const hash = await bcrypt.hash(newPassword, 12);
      await ctx.tenantPool.query(
        "UPDATE users SET password_hash=?, token_version=token_version+1, updated_at=NOW() WHERE id=? AND tenant_id=?",
        [hash, userId, ctx.tenantId]
      );

      // Invalidate token immediately
      await opts.redis.del(recoveryKey(ctx.tenantId, token));

      return res.json({ data: { ok: true }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  /**
   * GET /api/v1/auth/verify-reset-token?token=xxx
   * Lets the frontend verify a token before showing the reset form.
   */
  router.get("/verify-reset-token", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      const token = String(req.query.token ?? "");
      const stored = await opts.redis.get(recoveryKey(ctx.tenantId, token));
      if (!stored) {
        return res.json({ data: { valid: false }, meta: { requestId: (req as any).id }, errors: [] });
      }
      return res.json({ data: { valid: true }, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  return router;
}
