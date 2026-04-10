/**
 * @file domains/personalv5/services/auth.service.ts
 * @description Logica de negocio de autenticacion, separada del HTTP layer.
 *
 * Este archivo es invocado desde:
 *   - routes/auth.routes.ts (rutas legacy - siguen funcionando)
 *   - domains/personalv5/controllers/auth.controller.ts (nuevo patron)
 *
 * Al no tener imports de Express (Request/Response), es completamente testeable
 * sin levantar el servidor.
 */

import { Sequelize, QueryTypes } from 'sequelize';
import { env } from '../../../config/env';
import { verifyPassword } from '../../../auth/password';
import { signAccessToken, signRefreshToken } from '../../../auth/jwt';
import { loadPermissionsByRoleId } from '../../../auth/permissionsRepo';
import { findUserByEmail, findUserById } from '../../../auth/usersRepo';
import {
  refreshTokenExpiresAtFromNow,
  revokeRefreshTokenByHash,
  storeRefreshToken,
  validateRefreshToken,
  revokeAllRefreshTokensForUser,
} from '../../../auth/refreshTokensRepo';
import {
  getClientIp,
  getLoginLock,
  recordLoginAttempt,
  getActiveSecurityBan,
} from '../../../auth/loginGuardRepo';
import { logger } from '../../../logging/logger';

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export interface LoginDto {
  email: string;
  password: string;
  ip?: string;
  ua?: string;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: { id: number; email: string; nombre: string; role: string; sector_id: number | null; sector_nombre: string | null; servicio_id: number | null; servicio_nombre: string | null; jefatura_id: number | null };
  require2FA?: boolean;
  tempToken?: string;
}

export interface RefreshResult {
  accessToken: string;
}

export interface RequestAccessDto {
  nombre: string;
  email: string;
  cargo?: string;
  motivo?: string;
  ip?: string;
  ua?: string;
}

// ─── Funciones del servicio (pattern funcional para compatibilidad con el controller existente) ──

/**
 * Procesa el login. Verifica credenciales, aplica guards de seguridad,
 * genera tokens JWT y registra el intento.
 */
export async function loginUser(
  sequelize: Sequelize,
  dto: LoginDto
): Promise<LoginResult> {
  const { email, password, ip = 'unknown', ua = '' } = dto;
  const emailLower = email.toLowerCase().trim();

  // Guard: ban activo por IP o email
  if (env.LOGIN_GUARD_ENABLE) {
    const ban = await getActiveSecurityBan(sequelize, ip, emailLower);
    if (ban) {
      const err = Object.assign(new Error('Acceso temporalmente bloqueado. Intente mas tarde.'), { status: 429 });
      throw err;
    }

    const lock = await getLoginLock(sequelize, ip, emailLower);
    if (lock.lockedUntil && new Date(lock.lockedUntil).getTime() > Date.now()) {
      throw Object.assign(
        new Error('Demasiados intentos fallidos. Intente mas tarde.'),
        { status: 429, retryAfter: lock.lockedUntil }
      );
    }
  }

  // Buscar usuario
  const user = await findUserByEmail(sequelize, emailLower);
  if (!user) {
    await failedAttempt(sequelize, ip, emailLower);
    throw Object.assign(new Error('Credenciales invalidas.'), { status: 401 });
  }

  // Verificar password
  const passwordOk = await verifyPassword(password, user.passwordHash);
  if (!passwordOk) {
    await failedAttempt(sequelize, ip, emailLower);
    throw Object.assign(new Error('Credenciales invalidas.'), { status: 401 });
  }

  // Verificar que el usuario este activo
  if (!user.active) {
    throw Object.assign(new Error('Usuario inactivo o suspendido.'), { status: 403 });
  }

  // Cargar permisos y generar tokens
  const permissions = await loadPermissionsByRoleId(sequelize, user.roleId);
  const accessToken  = signAccessToken(user.id, user.roleId);
  const refreshToken = signRefreshToken(user.id);
  const expiresAt    = refreshTokenExpiresAtFromNow(env.JWT_REFRESH_TTL_DAYS);

  await storeRefreshToken(sequelize, user.id, refreshToken, null, expiresAt, ip, ua);

  // Limpiar contador de intentos fallidos en login exitoso
  if (env.LOGIN_GUARD_ENABLE) {
    await recordLoginAttempt(
      sequelize, ip, emailLower, true,
      env.LOGIN_GUARD_MAX_ATTEMPTS, env.LOGIN_GUARD_LOCK_MINUTES
    ).catch(() => {});
  }

  logger.info({ msg: 'Login exitoso', userId: user.id, email: user.email, ip });

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      nombre: user.nombre || user.email,
      role: String(user.roleId ?? 'usuario'),
      sector_id:      (user as any).sector_id      ?? null,
      sector_nombre:  (user as any).sector_nombre  ?? null,
      servicio_id:    (user as any).servicio_id    ?? null,
      servicio_nombre:(user as any).servicio_nombre ?? null,
      jefatura_id:    (user as any).jefatura_id    ?? null,
    },
  };
}

/**
 * Renueva el access token usando un refresh token valido.
 */
export async function refreshTokens(
  sequelize: Sequelize,
  refreshToken: string,
  ip = 'unknown'
): Promise<RefreshResult> {
  const validated = await validateRefreshToken(sequelize, refreshToken);
  if (!validated.ok) {
    throw Object.assign(new Error(validated.error || 'Refresh token invalido o vencido.'), { status: 401 });
  }

  const user = await findUserById(sequelize, validated.usuarioId);
  if (!user || !user.active) {
    throw Object.assign(new Error('Usuario no encontrado o inactivo.'), { status: 401 });
  }

  const accessToken = signAccessToken(user.id, user.roleId);
  return { accessToken };
}

/**
 * Cierra la sesion revocando el refresh token.
 */
export async function logoutUser(
  sequelize: Sequelize,
  refreshToken: string,
  userId?: number
): Promise<void> {
  if (refreshToken) {
    await revokeRefreshTokenByHash(sequelize, refreshToken).catch(() => {});
  }
  if (userId) {
    await revokeAllRefreshTokensForUser(sequelize, userId).catch(() => {});
  }
  logger.info({ msg: 'Logout', userId });
}

/**
 * Registra una solicitud de acceso de un nuevo usuario.
 */
export async function requestAccess(
  sequelize: Sequelize,
  dto: RequestAccessDto
): Promise<void> {
  const { nombre, email, cargo = '', motivo = '', ip = 'unknown', ua = '' } = dto;
  const emailLower = email.toLowerCase().trim();
  const codigo = Math.floor(100000 + Math.random() * 900000).toString();
  const expira = new Date(Date.now() + 24 * 3600 * 1000);

  await sequelize.query(
    `INSERT INTO audit_log (action, table_name, record_pk, route, ip, user_agent, request_json, created_at)
     VALUES ('request_access', 'usuarios', NULL, '/api/v1/auth/request-access', :ip, :ua, :req_json, NOW())`,
    {
      replacements: {
        ip: String(ip).substring(0, 64),
        ua: String(ua).substring(0, 255),
        req_json: JSON.stringify({ nombre, email: emailLower, cargo, motivo, codigo, expira: expira.toISOString() }),
      },
    }
  ).catch(() => {});

  // Enviar email async (no bloquea la respuesta)
  sendAccessEmails({ nombre, email: emailLower, cargo, motivo, codigo, expira })
    .catch((err: any) => logger.warn({ msg: 'Email solicitud no enviado', err: err?.message }));
}

/**
 * Verifica el codigo de confirmacion (6 digitos enviado por email).
 */
export async function confirmAccessCode(
  sequelize: Sequelize,
  email: string,
  codigo: string
): Promise<void> {
  const emailLower = email.toLowerCase().trim();
  const codigoStr  = String(codigo).replace(/\D/g, '').substring(0, 6);

  const rows = await sequelize.query(
    `SELECT id, request_json FROM audit_log
     WHERE action = 'request_access'
       AND request_json LIKE :emailLike
       AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
     ORDER BY id DESC LIMIT 1`,
    { replacements: { emailLike: `%${emailLower}%` }, type: QueryTypes.SELECT }
  ) as any[];

  const row = rows[0];
  if (!row) throw Object.assign(new Error('Solicitud no encontrada o vencida (24 hs).'), { status: 400 });

  let parsed: any = {};
  try { parsed = JSON.parse(row.request_json); } catch {}

  if (parsed.codigo !== codigoStr) {
    throw Object.assign(new Error('Codigo incorrecto. Verifica tu email.'), { status: 400 });
  }

  await sequelize.query(
    `UPDATE audit_log SET request_json = JSON_SET(request_json, '$.confirmed', true, '$.confirmed_at', :now) WHERE id = :id`,
    { replacements: { id: row.id, now: new Date().toISOString() } }
  ).catch(() => {});
}

// ─── Helpers privados ──────────────────────────────────────────────────────────

async function failedAttempt(sequelize: Sequelize, ip: string, identifier: string): Promise<void> {
  if (!env.LOGIN_GUARD_ENABLE) return;
  try {
    await recordLoginAttempt(
      sequelize, ip, identifier, false,
      env.LOGIN_GUARD_MAX_ATTEMPTS, env.LOGIN_GUARD_LOCK_MINUTES
    );
  } catch {}
}

async function sendAccessEmails(data: {
  nombre: string; email: string; cargo: string;
  motivo: string; codigo: string; expira: Date;
}): Promise<void> {
  const { sendEmail } = await import('../../../services/email.service');
  const { nombre, email, cargo, motivo, codigo, expira } = data;

  await sendEmail({
    to: email,
    subject: 'Codigo de confirmacion - Solicitud de acceso',
    html: `<h2>Solicitud de acceso</h2>
           <p>Hola <strong>${nombre}</strong>, tu codigo es:</p>
           <h1 style="font-size:2.5rem;letter-spacing:0.4rem;color:#2563eb;">${codigo}</h1>
           <p>Vence: ${expira.toLocaleString('es-AR')}</p>`,
    text: `Hola ${nombre}, tu codigo es ${codigo}. Vence: ${expira.toLocaleString('es-AR')}`,
  });

  const adminEmail = env.ADMIN_EMAIL || '';
  if (adminEmail && adminEmail !== email) {
    await sendEmail({
      to: adminEmail,
      subject: `Solicitud de acceso: ${nombre} <${email}>`,
      html: `<h2>Nueva solicitud</h2>
             <p><b>Nombre:</b> ${nombre}</p><p><b>Email:</b> ${email}</p>
             <p><b>Cargo:</b> ${cargo || 'No indicado'}</p>
             <p><b>Motivo:</b> ${motivo || 'No indicado'}</p>
             <p><b>Codigo:</b> ${codigo}</p>`,
      text: `Solicitud de ${nombre} (${email}). Codigo: ${codigo}`,
    }).catch(() => {});
  }
}
