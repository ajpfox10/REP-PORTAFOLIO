// src/routes/auth.routes.ts
import { Router, Request, Response } from "express";
import { Sequelize, QueryTypes } from "sequelize";
import { z } from "zod";
import { env } from "../config/env";
import { authLoginTotal, authRefreshTotal } from "../metrics/domain";
import { alertOnSpike } from "../alerts/thresholds";
import { verifyPassword, hashPassword } from "../auth/password";
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
import { authContext } from "../middlewares/authContext";
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


  // ─── GET /api/v1/auth/me ─────────────────────────────────────────────────────
  // Requiere token JWT válido. Devuelve: id, email, nombre, roleId, permissions.
  router.get('/me', authContext(sequelize), async (req: Request, res: Response) => {
    const auth = (req as any).auth;
    if (!auth || !auth.principalId) {
      return res.status(401).json({ ok: false, error: 'No autenticado' });
    }

    const user = await findUserById(sequelize, auth.principalId);
    if (!user || !user.active) {
      return res.status(401).json({ ok: false, error: 'Usuario no encontrado o inactivo' });
    }

    const permissions = await loadPermissionsByRoleId(sequelize, user.roleId);

    return res.json({
      ok: true,
      data: {
        id:          user.id,
        email:       user.email,
        nombre:      user.nombre,
        roleId:      user.roleId,
        permissions,
      },
    });
  });

  // ─── PATCH /api/v1/auth/me/password ──────────────────────────────────────────
  // Cambio de contraseña autenticado (el usuario cambia la suya propia).
  // Requiere token JWT válido + contraseña actual.
  router.patch('/me/password', authContext(sequelize), async (req: Request, res: Response) => {
    const auth = (req as any).auth;
    if (!auth || !auth.principalId) {
      return res.status(401).json({ ok: false, error: 'No autenticado' });
    }

    const strongPassword = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/;

    const schema = z.object({
      passwordActual: z.string().min(1, 'Contraseña actual requerida'),
      passwordNuevo: z
        .string()
        .min(8, 'Mínimo 8 caracteres')
        .refine((val) => strongPassword.test(val), {
          message: 'Debe incluir mayúscula, minúscula, número y símbolo',
        }),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.flatten() });
    }

    const { passwordActual, passwordNuevo } = parsed.data;

    // Obtener hash actual del usuario
    const [rows] = await sequelize.query(
      'SELECT id, password FROM usuarios WHERE id = :id AND deleted_at IS NULL LIMIT 1',
      { replacements: { id: auth.principalId } }
    );
    const userRow = (rows as any[])[0];
    if (!userRow) return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });

    const ok = await verifyPassword(passwordActual, userRow.password);
    if (!ok) {
      return res.status(401).json({ ok: false, error: 'Contraseña actual incorrecta' });
    }

    if (passwordActual === passwordNuevo) {
      return res.status(400).json({ ok: false, error: 'La nueva contraseña debe ser distinta a la actual' });
    }

    const newHash = await hashPassword(passwordNuevo);
    await sequelize.query(
      'UPDATE usuarios SET password = :newHash WHERE id = :id',
      { replacements: { newHash, id: auth.principalId } }
    );

    // Opcional: revocar todos los refresh tokens para forzar re-login en otros dispositivos
    await revokeAllRefreshTokensForUser(sequelize, auth.principalId).catch(() => {});

    logger.info({ msg: 'Contraseña cambiada', userId: auth.principalId });
    return res.json({ ok: true, message: 'Contraseña actualizada exitosamente' });
  });

  // ─── POST /api/v1/auth/request-access ────────────────────────────────────────
  // Endpoint PÚBLICO: solicitud de acceso.
  // Genera un código de confirmación, lo envía al mail del solicitante Y al admin.
  router.post('/request-access', async (req: Request, res: Response) => {
    try {
      const { nombre, email, motivo } = req.body || {};
      if (!nombre?.trim() || !email?.trim()) {
        return res.status(400).json({ ok: false, error: 'nombre y email son requeridos' });
      }
      const emailLower = String(email).toLowerCase().trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLower)) {
        return res.status(400).json({ ok: false, error: 'Email inválido' });
      }

      // ── Generar código de confirmación (6 dígitos) ──
      const codigo = Math.floor(100000 + Math.random() * 900000).toString();
      const expira = new Date(Date.now() + 24 * 3600 * 1000); // 24 hs

      // ── Guardar solicitud en audit_log ──
      await sequelize.query(
        `INSERT INTO audit_log
           (action, table_name, record_pk, route, ip, user_agent, request_json, created_at)
         VALUES
           ('request_access', 'usuarios', NULL,
            '/api/v1/auth/request-access', :ip, :ua, :req_json, NOW())`,
        {
          replacements: {
            ip:       String(req.ip || 'unknown').substring(0, 64),
            ua:       String(req.headers['user-agent'] || '').substring(0, 255),
            req_json: JSON.stringify({
              nombre,
              email: emailLower,
              motivo: motivo?.substring(0, 500),
              codigo,            // guardamos para que el admin pueda verificar
              expira: expira.toISOString(),
            }),
          },
        }
      ).catch(() => {});        // no fallar si audit falla

      // ── Enviar emails ──
      try {
        const { sendEmail } = await import('../services/email.service');

        // 1️⃣  Email al SOLICITANTE con el código de confirmación
        await sendEmail({
          to: emailLower,
          subject: 'Código de confirmación — Solicitud de acceso PersonalV5',
          html: `
            <h2>Solicitud de acceso al sistema PersonalV5</h2>
            <p>Hola <strong>${nombre}</strong>,</p>
            <p>Recibimos tu solicitud de acceso. Tu código de confirmación es:</p>
            <h1 style="font-size:2.5rem;letter-spacing:0.3rem;color:#2563eb;">${codigo}</h1>
            <p>Este código vence en <strong>24 horas</strong>.</p>
            <p>El administrador del sistema revisará tu solicitud.
               Una vez aprobada recibirás otro email con tus credenciales de acceso.</p>
            <hr>
            <p style="font-size:0.8rem;color:#94a3b8;">
              Si no solicitaste este acceso, ignorá este mensaje.
            </p>
          `,
          text: `Solicitud de acceso PersonalV5\n\nHola ${nombre},\nTu código de confirmación es: ${codigo}\nVence en 24 horas.\nEl administrador revisará tu solicitud.`,
        });

        // 2️⃣  Email al ADMINISTRADOR con los datos del solicitante
        const adminEmail = env.ADMIN_EMAIL || env.EMAIL_FROM || '';
        if (adminEmail && adminEmail !== emailLower) {
          await sendEmail({
            to: adminEmail,
            subject: `Nueva solicitud de acceso: ${nombre} <${emailLower}>`,
            html: `
              <h2>Nueva solicitud de acceso — PersonalV5</h2>
              <table>
                <tr><td><strong>Nombre:</strong></td><td>${nombre}</td></tr>
                <tr><td><strong>Email:</strong></td><td>${emailLower}</td></tr>
                <tr><td><strong>Motivo:</strong></td><td>${motivo || 'No especificado'}</td></tr>
                <tr><td><strong>Código verificación:</strong></td><td>${codigo}</td></tr>
                <tr><td><strong>Expira:</strong></td><td>${expira.toLocaleString('es-AR')}</td></tr>
              </table>
              <p>Para crear el usuario, ingresá al panel de administración (Admin → Usuarios → Nuevo usuario).</p>
            `,
            text: `Nueva solicitud de acceso\nNombre: ${nombre}\nEmail: ${emailLower}\nMotivo: ${motivo || 'N/A'}\nCódigo: ${codigo}`,
          });
        }
      } catch (emailErr: any) {
        // Si el email falla, loguear pero no fallar la respuesta
        // (el admin puede ver la solicitud en audit_log)
        console.warn('[request-access] Email no enviado:', emailErr?.message);
      }

      // Responder siempre OK (no revelar si el email ya existe)
      return res.json({
        ok: true,
        message: 'Solicitud recibida. Revisá tu casilla de correo para confirmar tu solicitud.',
        emailSent: true,   // el front puede mostrar instrucciones
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error interno' });
    }
  });

  // ─── POST /api/v1/auth/confirm-access-code ───────────────────────────────────
  // Verifica el código de 6 dígitos que el solicitante recibió por email.
  // El código se guarda en audit_log.request_json al crear la solicitud.
  router.post('/confirm-access-code', async (req: Request, res: Response) => {
    try {
      const { email, codigo } = req.body || {};
      if (!email || !codigo) {
        return res.status(400).json({ ok: false, error: 'email y codigo son requeridos' });
      }

      const emailLower = String(email).toLowerCase().trim();
      const codigoStr  = String(codigo).replace(/\D/g, '').substring(0, 6);

      // Buscar TODAS las solicitudes activas de ese email (puede haber varias por reenvíos)
      // y validar contra cualquiera cuyo código coincida
      const rows = await sequelize.query(
        `SELECT id, request_json, created_at
         FROM audit_log
         WHERE action = 'request_access'
           AND request_json LIKE :emailLike
           AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
         ORDER BY id DESC`,
        {
          replacements: { emailLike: `%${emailLower}%` },
          type: QueryTypes.SELECT,
        }
      );

      if (!(rows as any[]).length) {
        return res.status(400).json({
          ok: false,
          error: 'No se encontró una solicitud activa para ese email o ya venció (24 hs).',
        });
      }

      // Buscar la fila cuyo código coincide (usuario puede tener varios emails enviados)
      let row: any = null;
      for (const r of rows as any[]) {
        let p: any = {};
        try { p = typeof r.request_json === 'string' ? JSON.parse(r.request_json) : r.request_json; } catch {}
        if (p?.codigo === codigoStr) { row = r; break; }
      }

      if (!row) {
        return res.status(400).json({ ok: false, error: 'Código incorrecto. Verificá tu email.' });
      }

      // Marcar como confirmado en audit_log
      await sequelize.query(
        `UPDATE audit_log
         SET request_json = JSON_SET(request_json, '$.confirmed', true, '$.confirmed_at', :now)
         WHERE id = :id`,
        { replacements: { id: row.id, now: new Date().toISOString() } }
      ).catch(() => {});

      return res.json({
        ok: true,
        message: 'Email confirmado. El administrador revisará tu solicitud y recibirás acceso por email.',
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error interno' });
    }
  });

  // ─── GET /api/v1/auth/pending-requests ───────────────────────────────────────
  // Lista solicitudes de acceso confirmadas y pendientes de aprobación (solo admin).
  router.get('/pending-requests', authContext(sequelize), async (req: Request, res: Response) => {
    const auth = (req as any).auth;
    if (!auth) return res.status(401).json({ ok: false, error: 'No autenticado' });

    try {
      const rows = await sequelize.query(
        `SELECT id, created_at, request_json
         FROM audit_log
         WHERE action = 'request_access'
         ORDER BY id DESC
         LIMIT 200`,
        { type: QueryTypes.SELECT }
      );

      const requests = (rows as any[]).map(r => {
        let p: any = {};
        try { p = typeof r.request_json === 'string' ? JSON.parse(r.request_json) : r.request_json; } catch {}
        return {
          id:           r.id,
          created_at:   r.created_at,
          nombre:       p.nombre   || '',
          email:        p.email    || '',
          motivo:       p.motivo   || '',
          confirmed:    p.confirmed === true,
          confirmed_at: p.confirmed_at || null,
          approved:     p.approved === true,
          approved_at:  p.approved_at  || null,
          expira:       p.expira   || null,
        };
      });

      return res.json({ ok: true, data: requests });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error interno' });
    }
  });

  // ─── POST /api/v1/auth/approve-request ───────────────────────────────────────
  // Aprueba una solicitud: crea el usuario, le envía email con credenciales (solo admin).
  router.post('/approve-request', authContext(sequelize), async (req: Request, res: Response) => {
    const auth = (req as any).auth;
    if (!auth) return res.status(401).json({ ok: false, error: 'No autenticado' });

    try {
      const { audit_log_id, password, rol_id } = req.body || {};
      if (!audit_log_id) {
        return res.status(400).json({ ok: false, error: 'audit_log_id es requerido' });
      }
      if (!password || String(password).length < 8) {
        return res.status(400).json({ ok: false, error: 'La contraseña debe tener al menos 8 caracteres' });
      }

      // Buscar la solicitud en audit_log
      const rows = await sequelize.query(
        `SELECT id, request_json FROM audit_log WHERE id = :id AND action = 'request_access' LIMIT 1`,
        { replacements: { id: audit_log_id }, type: QueryTypes.SELECT }
      );
      if (!(rows as any[]).length) {
        return res.status(404).json({ ok: false, error: 'Solicitud no encontrada' });
      }

      const logRow = (rows as any[])[0];
      let p: any = {};
      try { p = typeof logRow.request_json === 'string' ? JSON.parse(logRow.request_json) : logRow.request_json; } catch {}

      const emailLower = String(p.email || '').toLowerCase().trim();
      const nombre     = String(p.nombre || '').trim();
      if (!emailLower || !nombre) {
        return res.status(400).json({ ok: false, error: 'La solicitud no tiene email o nombre válido' });
      }

      // Verificar que el email no exista ya como usuario
      const existing = await sequelize.query(
        'SELECT id FROM usuarios WHERE email = :email AND deleted_at IS NULL LIMIT 1',
        { replacements: { email: emailLower }, type: QueryTypes.SELECT }
      );
      if ((existing as any[]).length) {
        return res.status(409).json({ ok: false, error: 'Ya existe un usuario con ese email' });
      }

      // Crear usuario y asignar rol en transacción
      const { hashPassword } = await import('../auth/password');
      const passwordHash = await hashPassword(String(password));

      const t = await sequelize.transaction();
      let userId: number;
      try {
        const result = await sequelize.query(
          `INSERT INTO usuarios (email, nombre, password, estado, created_at)
           VALUES (:email, :nombre, :passwordHash, 'activo', NOW())`,
          {
            replacements: { email: emailLower, nombre, passwordHash },
            transaction: t,
            type: QueryTypes.INSERT,
          }
        );

        // Con QueryTypes.INSERT el insertId suele venir en el OkPacket (shape puede variar por versión)
        const r: any = result as any;
        // Sequelize/MySQL puede devolver OkPacket, [OkPacket, meta] o [insertId, affectedRows] según versión.
        const okPacket: any =
          Array.isArray(r)
            ? (typeof r[0] === 'object' ? r[0] : { insertId: r[0] })
            : r;

        userId = Number(okPacket?.insertId ?? 0);
        if (!userId) throw new Error('No se pudo obtener el ID del usuario creado');

        if (rol_id) {
          await sequelize.query(
            `INSERT INTO usuarios_roles (usuario_id, rol_id, created_at)
             VALUES (:userId, :rolId, NOW())`,
            {
              replacements: { userId, rolId: Number(rol_id) },
              transaction: t,
              type: QueryTypes.INSERT,
            }
          );
        }

        // Marcar solicitud como aprobada en audit_log
        await sequelize.query(
          `UPDATE audit_log
           SET request_json = JSON_SET(request_json, '$.approved', true, '$.approved_at', :now)
           WHERE id = :id`,
          { replacements: { id: audit_log_id, now: new Date().toISOString() }, transaction: t }
        );

        await t.commit();
      } catch (err: any) {
        await t.rollback().catch(() => {});
        return res.status(500).json({ ok: false, error: err?.message });
      }

      // Enviar email al usuario con sus credenciales
      try {
        const { sendEmail } = await import('../services/email.service');
        await sendEmail({
          to: emailLower,
          subject: 'Tu acceso a PersonalV5 fue aprobado',
          html: `
            <h2>¡Tu solicitud fue aprobada!</h2>
            <p>Hola <strong>${nombre}</strong>,</p>
            <p>El administrador aprobó tu acceso al sistema <strong>PersonalV5</strong>.</p>
            <p>Tus credenciales de acceso son:</p>
            <ul>
              <li><strong>Email:</strong> ${emailLower}</li>
              <li><strong>Contraseña:</strong> ${password}</li>
            </ul>
            <p>Ingresá en: <a href="${env.APP_URL || 'http://localhost:5173'}">${env.APP_URL || 'http://localhost:5173'}</a></p>
            <p>Te recomendamos cambiar tu contraseña luego del primer ingreso.</p>
            <hr>
            <p style="font-size:0.8rem;color:#94a3b8;">Sistema PersonalV5</p>
          `,
          text: `Tu solicitud fue aprobada.\nEmail: ${emailLower}\nContraseña: ${password}\nIngresá al sistema y cambiá tu contraseña.`,
        });
      } catch (emailErr: any) {
        logger.warn({ msg: 'No se pudo enviar email de aprobación', email: emailLower, error: emailErr?.message });
      }

      logger.info({ msg: 'Solicitud aprobada', userId, email: emailLower, actor: auth.principalId });
      return res.status(201).json({ ok: true, data: { userId, email: emailLower, nombre } });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err?.message || 'Error interno' });
    }
  });

  return router;
};
