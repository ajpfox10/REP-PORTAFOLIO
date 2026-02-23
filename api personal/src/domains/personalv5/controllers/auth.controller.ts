/**
 * @file domains/personalv5/controllers/auth.controller.ts
 *
 * Controller de auth: validación de input + llamada al service.
 */

import { Request, Response } from 'express';
import {
  loginSchema, refreshSchema, forgotPasswordSchema, resetPasswordSchema,
  requestAccessSchema, confirmCodeSchema,
} from '../schemas';
import {
  loginUser, refreshTokens, requestAccess, confirmAccessCode,
} from '../services/auth.service';
import { revokeAllRefreshTokensForUser } from '../../../auth/refreshTokensRepo';
import { logger } from '../../../logging/logger';

function getClientIpFromReq(req: Request): string {
  return String(
    req.headers['x-forwarded-for']?.toString().split(',')[0].trim() ??
    req.ip ?? 'unknown'
  ).substring(0, 64);
}

// ── LOGIN ─────────────────────────────────────────────────────────────────────

export async function login(req: Request, res: Response): Promise<void> {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'Email o contraseña inválidos', details: parsed.error.issues });
    return;
  }

  const sequelize = (req.app.locals as any).sequelize;

  try {
    const result = await loginUser(sequelize, {
      ...parsed.data,
      ip: getClientIpFromReq(req),
      ua: String(req.headers['user-agent'] || '').substring(0, 255),
    });

    if (result.require2FA) {
      res.status(200).json({ ok: true, require2FA: true, tempToken: result.tempToken });
      return;
    }

    res.json({ ok: true, ...result });
  } catch (err: any) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}

// ── REFRESH ───────────────────────────────────────────────────────────────────

export async function refresh(req: Request, res: Response): Promise<void> {
  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'refreshToken requerido' });
    return;
  }

  const sequelize = (req.app.locals as any).sequelize;

  try {
    const tokens = await refreshTokens(sequelize, parsed.data.refreshToken, getClientIpFromReq(req));
    res.json({ ok: true, ...tokens });
  } catch (err: any) {
    res.status(err.status || 401).json({ ok: false, error: err.message });
  }
}

// ── LOGOUT ────────────────────────────────────────────────────────────────────

export async function logout(req: Request, res: Response): Promise<void> {
  const auth      = (req as any).auth;
  const sequelize = (req.app.locals as any).sequelize;

  if (auth?.principalId) {
    await revokeAllRefreshTokensForUser(sequelize, auth.principalId).catch(() => {});
  }

  res.json({ ok: true, message: 'Sesión cerrada' });
}

// ── REQUEST ACCESS ────────────────────────────────────────────────────────────

export async function handleRequestAccess(req: Request, res: Response): Promise<void> {
  const parsed = requestAccessSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'Datos inválidos', details: parsed.error.issues });
    return;
  }

  const sequelize = (req.app.locals as any).sequelize;

  try {
    await requestAccess(sequelize, {
      ...parsed.data,
      ip: getClientIpFromReq(req),
      ua: String(req.headers['user-agent'] || '').substring(0, 255),
    });
    res.json({
      ok:      true,
      message: 'Solicitud recibida. Revisá tu casilla de correo para confirmar.',
    });
  } catch (err: any) {
    // Siempre respondemos OK para no revelar si el email existe
    logger.warn({ msg: '[auth] request-access error', err: err?.message });
    res.json({
      ok:      true,
      message: 'Solicitud recibida. Si el email es válido, recibirás el código.',
    });
  }
}

// ── CONFIRM CODE ──────────────────────────────────────────────────────────────

export async function handleConfirmCode(req: Request, res: Response): Promise<void> {
  const parsed = confirmCodeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'Datos inválidos', details: parsed.error.issues });
    return;
  }

  const sequelize = (req.app.locals as any).sequelize;

  try {
    await confirmAccessCode(sequelize, parsed.data.email, parsed.data.codigo);
    res.json({
      ok:      true,
      message: 'Email confirmado. El administrador revisará tu solicitud.',
    });
  } catch (err: any) {
    res.status(err.status || 400).json({ ok: false, error: err.message });
  }
}

// ── FORGOT / RESET PASSWORD ───────────────────────────────────────────────────

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  const parsed = forgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'Email inválido' });
    return;
  }

  const sequelize = (req.app.locals as any).sequelize;

  try {
    const { initiatePasswordReset } = await import('../../../services/passwordReset.service');
    await initiatePasswordReset(sequelize, parsed.data.email);
  } catch { /* silencioso: no revelar si el email existe */ }

  res.json({ ok: true, message: 'Si el email existe, recibirás instrucciones para recuperar tu contraseña.' });
}

export async function resetPassword(req: Request, res: Response): Promise<void> {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'Datos inválidos', details: parsed.error.issues });
    return;
  }

  const sequelize = (req.app.locals as any).sequelize;

  try {
    const { resetPasswordWithToken } = await import('../../../services/passwordReset.service');
    await resetPasswordWithToken(sequelize, parsed.data.token, parsed.data.password);
    res.json({ ok: true, message: 'Contraseña restablecida exitosamente.' });
  } catch (err: any) {
    res.status(err.status || 400).json({ ok: false, error: err.message });
  }
}
