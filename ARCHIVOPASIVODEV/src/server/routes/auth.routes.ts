import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { query } from "../db/pool.js";
import { signAccessToken, signRefreshToken } from "../auth/jwt.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { loadPermissionsByRoleId } from "../auth/permissions.js";
import { findUserByEmail, findUserById, findUserByIdentifier } from "../auth/users.js";
import { assertLoginAllowed, clientIp, recordLoginAttempt } from "../auth/loginGuard.js";
import { authLimiter } from "../middlewares/security.js";
import { authContext } from "../middlewares/authContext.js";
import { createTwoFactorQr, createTwoFactorSecret, verifyTwoFactorCode } from "../auth/twoFactor.js";
import { revokeAllRefreshTokens, revokeRefreshToken, rotateRefreshToken, storeRefreshToken } from "../auth/refreshTokens.js";
import { randomHex, sha256Hex } from "../utils/hash.js";

const router = Router();

const loginSchema = z.object({
  identifier: z.string().min(3),
  password: z.string().min(1),
  twoFactorCode: z.string().optional(),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const requestAccessSchema = z.object({
  nombre: z.string().min(3).max(160),
  email: z.string().email(),
  motivo: z.string().max(500).optional(),
});

const confirmAccessSchema = z.object({
  email: z.string().email(),
  code: z.string().min(4).max(12),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(20),
  password: z.string().min(10),
});

// Crea codigos cortos para confirmar solicitudes de acceso.
function confirmationCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// Construye la respuesta de sesion con usuario y permisos actuales.
async function sessionPayload(userId: number, refreshToken: string) {
  const user = await findUserById(userId);
  if (!user || !user.activo) throw Object.assign(new Error("Usuario inactivo"), { status: 401 });
  const permissions = await loadPermissionsByRoleId(user.rol_id);
  return {
    accessToken: signAccessToken(user.id, user.rol_id, user.token_version),
    refreshToken,
      user: { id: user.id, username: user.username, email: user.email, nombre: user.nombre, roleId: user.rol_id },
    permissions,
  };
}

// Registra una solicitud publica de acceso sin crear usuario todavia.
router.post("/request-access", authLimiter, async (req, res, next) => {
  try {
    const input = requestAccessSchema.parse(req.body);
    const email = input.email.trim().toLowerCase();
    const code = confirmationCode();

    await query(
      `INSERT INTO access_requests
        (email, nombre, motivo, codigo_hash, expires_at, ip, user_agent)
       VALUES
        (:email, :nombre, :motivo, :codigoHash, DATE_ADD(NOW(), INTERVAL 24 HOUR), :ip, :userAgent)`,
      {
        email,
        nombre: input.nombre.trim(),
        motivo: input.motivo?.trim() || null,
        codigoHash: sha256Hex(code),
        ip: clientIp(req),
        userAgent: String(req.header("user-agent") || ""),
      }
    );

    res.json({
      ok: true,
      message: "Solicitud recibida. Confirme el codigo para que administracion pueda revisarla.",
      data: env.NODE_ENV === "production" ? undefined : { confirmationCode: code },
    });
  } catch (error) {
    next(error);
  }
});

// Confirma el email declarado en la solicitud de acceso.
router.post("/confirm-access", authLimiter, async (req, res, next) => {
  try {
    const input = confirmAccessSchema.parse(req.body);
    const email = input.email.trim().toLowerCase();
    const rows = await query<Array<{ id: number; codigo_hash: string }>>(
      `SELECT id, codigo_hash
         FROM access_requests
        WHERE email = :email
          AND status = 'PENDIENTE'
          AND confirmed_at IS NULL
          AND expires_at > NOW()
        ORDER BY id DESC
        LIMIT 1`,
      { email }
    );

    const request = rows[0];
    if (!request || request.codigo_hash !== sha256Hex(input.code.trim())) {
      return res.status(400).json({ ok: false, error: "Codigo invalido o vencido" });
    }

    await query(
      `UPDATE access_requests
          SET status = 'CONFIRMADA', confirmed_at = NOW()
        WHERE id = :id`,
      { id: request.id }
    );
    res.json({ ok: true, message: "Email confirmado. La solicitud queda pendiente de aprobacion." });
  } catch (error) {
    next(error);
  }
});

// Genera un token de reseteo sin revelar si el email existe.
router.post("/forgot-password", authLimiter, async (req, res, next) => {
  try {
    const input = forgotPasswordSchema.parse(req.body);
    const email = input.email.trim().toLowerCase();
    const user = await findUserByEmail(email);
    let resetUrl: string | undefined;

    if (user?.activo) {
      const token = randomHex(32);
      resetUrl = `${env.PUBLIC_URL}/login?resetToken=${token}`;
      await query(
        `INSERT INTO password_reset_tokens
          (usuario_id, token_hash, expires_at, ip, user_agent)
         VALUES
          (:userId, :tokenHash, DATE_ADD(NOW(), INTERVAL 1 HOUR), :ip, :userAgent)`,
        {
          userId: user.id,
          tokenHash: sha256Hex(token),
          ip: clientIp(req),
          userAgent: String(req.header("user-agent") || ""),
        }
      );
    }

    res.json({
      ok: true,
      message: "Si el email existe, se genero una instruccion de reseteo.",
      data: env.NODE_ENV === "production" || !resetUrl ? undefined : { resetUrl },
    });
  } catch (error) {
    next(error);
  }
});

// Cambia la contrasena usando un token valido y revoca sesiones anteriores.
router.post("/reset-password", authLimiter, async (req, res, next) => {
  try {
    const input = resetPasswordSchema.parse(req.body);
    const tokenHash = sha256Hex(input.token.trim());
    const rows = await query<Array<{ id: number; usuario_id: number }>>(
      `SELECT id, usuario_id
         FROM password_reset_tokens
        WHERE token_hash = :tokenHash
          AND used_at IS NULL
          AND expires_at > NOW()
        LIMIT 1`,
      { tokenHash }
    );

    const reset = rows[0];
    if (!reset) return res.status(400).json({ ok: false, error: "Token invalido o vencido" });

    const passwordHash = await hashPassword(input.password);
    await query(
      `UPDATE usuarios
          SET password_hash = :passwordHash,
              token_version = token_version + 1
        WHERE id = :userId`,
      { userId: reset.usuario_id, passwordHash }
    );
    await query(`UPDATE password_reset_tokens SET used_at = NOW() WHERE id = :id`, { id: reset.id });
    await revokeAllRefreshTokens(reset.usuario_id);
    res.json({ ok: true, message: "Contrasena actualizada. Ingrese nuevamente." });
  } catch (error) {
    next(error);
  }
});

// Inicia sesion con usuario, contrasena y 2FA cuando corresponde.
router.post("/login", authLimiter, async (req, res, next) => {
  try {
    const input = loginSchema.parse(req.body);
    const identifier = input.identifier.trim().toLowerCase();
    const ip = clientIp(req);
    const userAgent = String(req.header("user-agent") || "");

    await assertLoginAllowed(ip, identifier);
    const user = await findUserByIdentifier(identifier);
    if (!user || !(await verifyPassword(input.password, user.password_hash))) {
      await recordLoginAttempt(ip, identifier, false);
      return res.status(401).json({ ok: false, error: "Credenciales invalidas" });
    }
    if (!user.activo) return res.status(403).json({ ok: false, error: "Usuario inactivo" });

    if (env.TWO_FACTOR_ENABLE && user.two_factor_enabled) {
      const valid = input.twoFactorCode && user.two_factor_secret
        ? verifyTwoFactorCode(user.two_factor_secret, input.twoFactorCode)
        : false;
      if (!valid) return res.status(401).json({ ok: false, error: "Codigo 2FA requerido o invalido" });
    }

    await recordLoginAttempt(ip, identifier, true);
    const refreshToken = signRefreshToken(user.id);
    await storeRefreshToken(user.id, refreshToken, ip, userAgent);
    res.json({ ok: true, data: await sessionPayload(user.id, refreshToken) });
  } catch (error) {
    next(error);
  }
});

// Rota refresh token y devuelve una sesion renovada.
router.post("/refresh", authLimiter, async (req, res, next) => {
  try {
    const input = refreshSchema.parse(req.body);
    const rotated = await rotateRefreshToken(input.refreshToken, clientIp(req), String(req.header("user-agent") || ""));
    res.json({ ok: true, data: await sessionPayload(rotated.userId, rotated.refreshToken) });
  } catch {
    res.status(401).json({ ok: false, error: "Refresh invalido o vencido" });
  }
});

// Cierra sesion revocando el refresh actual y todas las sesiones del usuario autenticado.
router.post("/logout", authContext, async (req, res, next) => {
  try {
    const input = refreshSchema.partial().parse(req.body ?? {});
    if (input.refreshToken) await revokeRefreshToken(input.refreshToken);
    if (req.auth?.userId) await revokeAllRefreshTokens(req.auth.userId);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// Devuelve usuario y permisos vigentes para sincronizar el frontend.
router.get("/me", authContext, async (req, res, next) => {
  try {
    const user = await findUserById(req.auth!.userId);
    if (!user) return res.status(401).json({ ok: false, error: "No autenticado" });
    res.json({
      ok: true,
      data: {
        user: { id: user.id, username: user.username, email: user.email, nombre: user.nombre, roleId: user.rol_id },
        permissions: req.auth!.permissions,
        twoFactorEnabled: Boolean(user.two_factor_enabled),
      },
    });
  } catch (error) {
    next(error);
  }
});

// Genera QR de 2FA para el usuario autenticado cuando la feature esta activa.
router.post("/2fa/setup", authContext, async (req, res, next) => {
  try {
    if (!env.TWO_FACTOR_ENABLE) return res.status(400).json({ ok: false, error: "2FA desactivado por entorno" });
    const user = await findUserById(req.auth!.userId);
    if (!user) return res.status(401).json({ ok: false, error: "No autenticado" });
    const setup = createTwoFactorSecret(user.email);
    await query(`UPDATE usuarios SET two_factor_secret = :secret WHERE id = :id`, { id: user.id, secret: setup.secret });
    res.json({ ok: true, data: { qr: await createTwoFactorQr(setup.otpauth) } });
  } catch (error) {
    next(error);
  }
});

// Confirma 2FA y activa la exigencia de codigo para futuros logins.
router.post("/2fa/confirm", authContext, async (req, res, next) => {
  try {
    if (!env.TWO_FACTOR_ENABLE) return res.status(400).json({ ok: false, error: "2FA desactivado por entorno" });
    const token = z.object({ code: z.string().min(6) }).parse(req.body).code;
    const user = await findUserById(req.auth!.userId);
    if (!user?.two_factor_secret || !verifyTwoFactorCode(user.two_factor_secret, token)) {
      return res.status(400).json({ ok: false, error: "Codigo 2FA invalido" });
    }
    await query(`UPDATE usuarios SET two_factor_enabled = 1 WHERE id = :id`, { id: user.id });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

export { router as authRouter };
