// src/routes/auth.routes.ts
import { Router, Request, Response } from "express";
import { Sequelize } from "sequelize";
import { z } from "zod";
import { env } from "../config/env";
import { authLoginTotal, authRefreshTotal } from "../metrics/domain";
import { alertOnSpike } from "../alerts/thresholds";
import { verifyPassword } from "../auth/password";
import { signAccessToken, signRefreshToken } from "../auth/jwt";
import { loadPermissionsByRoleId } from "../auth/permissionsRepo";
import { findUserByEmail, findUserById } from "../auth/usersRepo";
import {
  refreshTokenExpiresAtFromNow,
  revokeAllRefreshTokensForUser,
  revokeRefreshTokenByHash,
  storeRefreshToken,
  validateRefreshToken,
} from "../auth/refreshTokensRepo";
import {
  getClientIp,
  getLoginLock,
  recordLoginAttempt,
  getActiveSecurityBan,
} from "../auth/loginGuardRepo";
import { authLimiter } from "../middlewares/rateLimiters";
import { logger } from "../logging/logger";

// ─── Schemas Zod ─────────────────────────────────────────────────────────────

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8),
});

const verify2faSchema = z.object({
  pending2faToken: z.string().min(1),
  code: z.string().min(1),
});

// ─── Helper de métricas (no rompe si falla) ──────────────────────────────────

function incMetric(counter: any, label: string) {
  try { counter.labels(label).inc(1); } catch {}
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const buildAuthRouter = (sequelize: Sequelize) => {
  const router = Router();

  // ── POST /login ─────────────────────────────────────────────────────────────
  router.post("/login", authLimiter, async (req: Request, res: Response) => {
    if (!env.AUTH_ENABLE) return res.status(400).json({ ok: false, error: "AUTH_ENABLE=false" });
    if (!env.JWT_ACCESS_SECRET || !env.JWT_REFRESH_SECRET) {
      return res.status(500).json({ ok: false, error: "Faltan JWT secrets" });
    }

    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      incMetric(authLoginTotal, "fail");
      alertOnSpike("auth_login_fail", 20, 60_000, "Spike login fails (posible bruteforce)");
      return res.status(400).json({ ok: false, error: parsed.error.flatten() });
    }

    const { email, password } = parsed.data;
    const ip = getClientIp(req, env.TRUST_PROXY);

    // ── Login Guard: ban activo ───────────────────────────────────────────────
    if (env.LOGIN_GUARD_ENABLE) {
      try {
        const ban = await getActiveSecurityBan(sequelize, ip, email);
        if (ban) {
          incMetric(authLoginTotal, "banned");
          alertOnSpike("auth_login_banned", 5, 60_000, "Acceso con ban activo");
          return res.status(429).json({
            ok: false,
            error: "Acceso temporalmente bloqueado. Intente más tarde.",
          });
        }

        const lock = await getLoginLock(sequelize, ip, email);
        if (lock.lockedUntil && lock.lockedUntil.getTime() > Date.now()) {
          incMetric(authLoginTotal, "locked");
          return res.status(429).json({
            ok: false,
            error: "Demasiados intentos fallidos. Intente más tarde.",
            retryAfter: lock.lockedUntil.toISOString(),
          });
        }
      } catch (guardErr) {
        // Login guard no debe bloquear el flujo si falla
        logger.warn({ msg: "Login guard check failed (skipping)", err: guardErr });
      }
    }

    // ── Validación de credenciales ────────────────────────────────────────────
    const user = await findUserByEmail(sequelize, email);
    const okPass = user?.active ? await verifyPassword(password, user.passwordHash) : false;

    if (!user || !user.active || !okPass) {
      incMetric(authLoginTotal, "fail");
      alertOnSpike("auth_login_fail", 20, 60_000, "Spike login fails (posible bruteforce)");

      // Registrar intento fallido en login guard
      if (env.LOGIN_GUARD_ENABLE) {
        try {
          await recordLoginAttempt(
            sequelize, ip, email, false,
            env.LOGIN_GUARD_MAX_ATTEMPTS,
            env.LOGIN_GUARD_LOCK_MINUTES
          );
        } catch (guardErr) {
          logger.warn({ msg: "recordLoginAttempt failed", err: guardErr });
        }
      }

      return res.status(401).json({ ok: false, error: "Credenciales inválidas" });
    }

    // ── Credenciales OK → limpiar contador de intentos ───────────────────────
    if (env.LOGIN_GUARD_ENABLE) {
      try {
        await recordLoginAttempt(
          sequelize, ip, email, true,
          env.LOGIN_GUARD_MAX_ATTEMPTS,
          env.LOGIN_GUARD_LOCK_MINUTES
        );
      } catch (guardErr) {
        logger.warn({ msg: "recordLoginAttempt (ok) failed", err: guardErr });
      }
    }

    // ── 2FA: si está habilitado globalmente Y el usuario lo tiene activo ──────
    if (env.ENABLE_2FA) {
      let user2faEnabled = false;
      try {
        const { isUser2FAEnabled } = await import("../services/twoFactor.service");
        user2faEnabled = await isUser2FAEnabled(sequelize, user.id);
      } catch (err) {
        logger.error({ msg: "isUser2FAEnabled failed", err });
      }

      if (user2faEnabled) {
        if (!env.EMAIL_ENABLE) {
          // 2FA activo pero email deshabilitado: no podemos enviar el código
          logger.warn({ msg: "2FA activo pero EMAIL_ENABLE=false. Skipping 2FA.", userId: user.id });
        } else {
          try {
            const { create2FACode } = await import("../services/twoFactor.service");
            const { sendEmail, get2FAEmailHtml, get2FAEmailText } = await import("../services/email.service");

            const { code } = await create2FACode(sequelize, user.id);

            await sendEmail({
              to: user.email,
              subject: "Código de verificación",
              html: get2FAEmailHtml(code, user.nombre ?? ""),
              text: get2FAEmailText(code, user.nombre ?? ""),
            });

            // Token de pending 2FA: firmado con access secret, muy corto TTL, claim especial
            const jwt = await import("jsonwebtoken");
            const pending2faToken = jwt.sign(
              { sub: String(user.id), typ: "pending_2fa" },
              env.JWT_ACCESS_SECRET,
              { expiresIn: env.TWO_FA_CODE_TTL_MINUTES * 60 }
            );

            incMetric(authLoginTotal, "2fa_pending");
            return res.status(202).json({
              ok: true,
              status: "2fa_required",
              pending2faToken,
              message: "Código enviado al correo registrado.",
            });
          } catch (twoFaErr) {
            logger.error({ msg: "2FA flow failed, allowing login without 2FA", err: twoFaErr });
            // Fail open: si hay error en 2FA, continuamos con login normal
          }
        }
      }
    }

    // ── Emitir tokens ─────────────────────────────────────────────────────────
    const accessToken = signAccessToken(user.id, user.roleId);
    const refreshToken = signRefreshToken(user.id);

    const ip2 = req.ip ? String(req.ip) : null;
    const ua = req.header("user-agent") ? String(req.header("user-agent")) : null;
    const expiresAt = refreshTokenExpiresAtFromNow(env.JWT_REFRESH_TTL_DAYS);

    await storeRefreshToken(sequelize, user.id, refreshToken, null, expiresAt, ip2, ua);

    const permissions = await loadPermissionsByRoleId(sequelize, user.roleId);

    incMetric(authLoginTotal, "ok");

    return res.json({
      ok: true,
      data: {
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          email: user.email,
          nombre: user.nombre,
          roleId: user.roleId,
        },
        permissions,
      },
    });
  });

  // ── POST /verify-2fa (solo activo si ENABLE_2FA=true) ─────────────────────
  if (env.ENABLE_2FA) {
    router.post("/verify-2fa", authLimiter, async (req: Request, res: Response) => {
      if (!env.EMAIL_ENABLE) {
        return res.status(503).json({ ok: false, error: "2FA no disponible (EMAIL_ENABLE=false)" });
      }

      const parsed = verify2faSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ ok: false, error: parsed.error.flatten() });
      }

      const { pending2faToken, code } = parsed.data;

      // Verificar pending token
      let userId: number;
      try {
        const jwt = await import("jsonwebtoken");
        const claims = jwt.verify(pending2faToken, env.JWT_ACCESS_SECRET) as any;
        if (claims?.typ !== "pending_2fa") throw new Error("Token tipo incorrecto");
        userId = Number(claims.sub);
        if (!Number.isFinite(userId) || userId <= 0) throw new Error("UserId inválido");
      } catch {
        return res.status(401).json({ ok: false, error: "Token de verificación inválido o expirado" });
      }

      // Verificar código 2FA
      const { verify2FACode } = await import("../services/twoFactor.service");
      const result = await verify2FACode(sequelize, userId, code);
      if (!result.ok) {
        return res.status(401).json({ ok: false, error: result.error });
      }

      // Código OK → emitir tokens reales
      const user = await findUserById(sequelize, userId);
      if (!user || !user.active) {
        return res.status(401).json({ ok: false, error: "Usuario inválido" });
      }

      const accessToken = signAccessToken(user.id, user.roleId);
      const refreshToken = signRefreshToken(user.id);

      const ip = req.ip ? String(req.ip) : null;
      const ua = req.header("user-agent") ? String(req.header("user-agent")) : null;
      const expiresAt = refreshTokenExpiresAtFromNow(env.JWT_REFRESH_TTL_DAYS);

      await storeRefreshToken(sequelize, user.id, refreshToken, null, expiresAt, ip, ua);

      const permissions = await loadPermissionsByRoleId(sequelize, user.roleId);
      incMetric(authLoginTotal, "2fa_ok");

      return res.json({
        ok: true,
        data: {
          accessToken,
          refreshToken,
          user: { id: user.id, email: user.email, nombre: user.nombre, roleId: user.roleId },
          permissions,
        },
      });
    });
  }

  // ── POST /refresh ──────────────────────────────────────────────────────────
  router.post("/refresh", authLimiter, async (req: Request, res: Response) => {
    const parsed = refreshSchema.safeParse(req.body);
    if (!parsed.success) {
      incMetric(authRefreshTotal, "fail");
      alertOnSpike("auth_refresh_fail", 20, 60_000, "Spike refresh fails");
      return res.status(400).json({ ok: false, error: parsed.error.flatten() });
    }

    const { refreshToken } = parsed.data;

    const valid = await validateRefreshToken(sequelize, refreshToken);
    if (!valid.ok) {
      const errMsg = String(valid.error || "").toLowerCase();
      const isReuse = errMsg.includes("reutilizado") || errMsg.includes("reuse");
      incMetric(authRefreshTotal, isReuse ? "reuse" : "fail");
      alertOnSpike("auth_refresh_fail", 20, 60_000, "Spike refresh fails", { reuse: isReuse });
      return res.status(401).json({ ok: false, error: valid.error });
    }

    await revokeRefreshTokenByHash(sequelize, refreshToken);

    const user = await findUserById(sequelize, valid.usuarioId);
    if (!user || !user.active) {
      incMetric(authRefreshTotal, "fail");
      return res.status(401).json({ ok: false, error: "Usuario inválido" });
    }

    const newAccess = signAccessToken(user.id, user.roleId);
    const newRefresh = signRefreshToken(user.id);

    const ip = req.ip ? String(req.ip) : null;
    const ua = req.header("user-agent") ? String(req.header("user-agent")) : null;
    const expiresAt = refreshTokenExpiresAtFromNow(env.JWT_REFRESH_TTL_DAYS);

    await storeRefreshToken(sequelize, user.id, newRefresh, valid.rowId, expiresAt, ip, ua);
    incMetric(authRefreshTotal, "ok");

    return res.json({
      ok: true,
      data: { accessToken: newAccess, refreshToken: newRefresh },
    });
  });

  // ── POST /logout ───────────────────────────────────────────────────────────
  router.post("/logout", async (req: Request, res: Response) => {
    const parsed = refreshSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.flatten() });
    }

    const { refreshToken } = parsed.data;
    const valid = await validateRefreshToken(sequelize, refreshToken);
    if (valid.ok) {
      await revokeAllRefreshTokensForUser(sequelize, valid.usuarioId);
    }
    return res.json({ ok: true });
  });

  // ── POST /forgot-password (solo si EMAIL_ENABLE=true) ─────────────────────
  if (env.EMAIL_ENABLE) {
    router.post("/forgot-password", async (req: Request, res: Response) => {
      const parsed = forgotPasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ ok: false, error: parsed.error.flatten() });
      }

      const { initiatePasswordReset } = await import("../services/passwordReset.service");
      const result = await initiatePasswordReset(sequelize, parsed.data.email);

      if (!result.ok) {
        return res.status(500).json({ ok: false, error: result.error });
      }

      // Respuesta siempre igual (no revelar si el email existe)
      return res.json({
        ok: true,
        message: "Si el correo existe en nuestro sistema, recibirás instrucciones para restablecerla.",
      });
    });

    // ── POST /reset-password ─────────────────────────────────────────────────
    router.post("/reset-password", async (req: Request, res: Response) => {
      const parsed = resetPasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ ok: false, error: parsed.error.flatten() });
      }

      const { resetPasswordWithToken } = await import("../services/passwordReset.service");
      const result = await resetPasswordWithToken(sequelize, parsed.data.token, parsed.data.newPassword);

      if (!result.ok) {
        return res.status(400).json({ ok: false, error: result.error });
      }

      return res.json({ ok: true, message: "Contraseña restablecida exitosamente." });
    });
  }

  return router;
};
