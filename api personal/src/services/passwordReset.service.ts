import { Sequelize, QueryTypes } from 'sequelize';
import crypto from 'crypto';
import { hashPassword } from '../auth/password';
import { env } from '../config/env';
import { logger } from '../logging/logger';
import { sendEmail, getPasswordResetEmailHtml, getPasswordResetEmailText } from './email.service';

export interface PasswordResetToken {
  id: number;
  usuario_id: number;
  token_hash: string;
  expires_at: Date;
  used_at: Date | null;
  created_at: Date;
}

export function generateResetToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function hashResetToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export async function createPasswordResetToken(
  sequelize: Sequelize,
  userId: number
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateResetToken();
  const tokenHash = hashResetToken(token);

  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + (env.PASSWORD_RESET_TOKEN_TTL_HOURS || 1));

  await sequelize.query(
    `
    INSERT INTO password_reset_tokens (usuario_id, token_hash, expires_at, created_at, updated_at)
    VALUES (:usuario_id, :token_hash, :expires_at, NOW(), NOW())
    `,
    {
      replacements: {
        usuario_id: userId,
        token_hash: tokenHash,
        expires_at: expiresAt,
      },
      type: QueryTypes.INSERT,
    }
  );

  logger.info({ msg: 'Password reset token created', usuario_id: userId });

  return { token, expiresAt };
}

export async function validatePasswordResetToken(
  sequelize: Sequelize,
  token: string
): Promise<{ ok: boolean; userId?: number; error?: string }> {
  const tokenHash = hashResetToken(token);

  const rows = await sequelize.query<PasswordResetToken>(
    `
    SELECT id, usuario_id, token_hash, expires_at, used_at, created_at
    FROM password_reset_tokens
    WHERE token_hash = :token_hash
      AND used_at IS NULL
      AND expires_at > NOW()
    ORDER BY created_at DESC
    LIMIT 1
    `,
    {
      replacements: { token_hash: tokenHash },
      type: QueryTypes.SELECT,
    }
  );

  if (!rows || rows.length === 0) {
    return { ok: false, error: 'Token inválido o expirado' };
  }

  const resetToken = rows[0];
  return { ok: true, userId: resetToken.usuario_id };
}

export async function markResetTokenAsUsed(
  sequelize: Sequelize,
  token: string
): Promise<void> {
  const tokenHash = hashResetToken(token);

  await sequelize.query(
    `
    UPDATE password_reset_tokens
    SET used_at = NOW(), updated_at = NOW()
    WHERE token_hash = :token_hash AND used_at IS NULL
    `,
    {
      replacements: { token_hash: tokenHash },
      type: QueryTypes.UPDATE,
    }
  );
}

export async function revokeAllPasswordResetTokensForUser(
  sequelize: Sequelize,
  userId: number
): Promise<void> {
  await sequelize.query(
    `
    UPDATE password_reset_tokens
    SET used_at = NOW(), updated_at = NOW()
    WHERE usuario_id = :usuario_id AND used_at IS NULL
    `,
    {
      replacements: { usuario_id: userId },
      type: QueryTypes.UPDATE,
    }
  );

  logger.info({ msg: 'All password reset tokens revoked for user', usuario_id: userId });
}

export async function resetPasswordWithToken(
  sequelize: Sequelize,
  token: string,
  newPassword: string
): Promise<{ ok: boolean; error?: string }> {
  const validation = await validatePasswordResetToken(sequelize, token);

  if (!validation.ok || !validation.userId) {
    return { ok: false, error: validation.error || 'Token inválido' };
  }

  try {
    const passwordHash = await hashPassword(newPassword);

    await sequelize.query(
      `
      UPDATE usuarios
      SET password_hash = :password_hash, updated_at = NOW()
      WHERE id = :usuario_id
      `,
      {
        replacements: {
          password_hash: passwordHash,
          usuario_id: validation.userId,
        },
        type: QueryTypes.UPDATE,
      }
    );

    await markResetTokenAsUsed(sequelize, token);

    logger.info({ msg: 'Password reset successful', usuario_id: validation.userId });

    return { ok: true };
  } catch (error: any) {
    logger.error({ msg: 'Error resetting password', error: error?.message || error });
    return { ok: false, error: 'Error al restablecer contraseña' };
  }
}

export async function initiatePasswordReset(
  sequelize: Sequelize,
  email: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const userRows = await sequelize.query<any>(
      `
      SELECT id, email, nombre, active
      FROM usuarios
      WHERE email = :email AND deleted_at IS NULL
      LIMIT 1
      `,
      {
        replacements: { email },
        type: QueryTypes.SELECT,
      }
    );

    if (!userRows || userRows.length === 0) {
      logger.warn({ msg: 'Password reset requested for non-existent email', email });
      return { ok: true };
    }

    const user = userRows[0];

    if (!user.active) {
      return { ok: true };
    }

    const { token, expiresAt } = await createPasswordResetToken(sequelize, user.id);

    const resetLink = `${env.PASSWORD_RESET_URL_BASE || 'http://localhost:3000'}/reset-password?token=${token}`;

    if (env.EMAIL_ENABLE) {
      await sendEmail({
        to: user.email,
        subject: 'Restablecer Contraseña - Personal v5',
        html: getPasswordResetEmailHtml(resetLink, user.nombre),
        text: getPasswordResetEmailText(resetLink, user.nombre),
      });
    }

    return { ok: true };
  } catch (error: any) {
    logger.error({ msg: 'Error initiating password reset', error: error?.message || error });
    return { ok: false, error: 'Error al procesar solicitud' };
  }
}

export async function cleanupExpiredResetTokens(sequelize: Sequelize): Promise<number> {
  const result: any = await sequelize.query(
    `
    DELETE FROM password_reset_tokens
    WHERE expires_at < NOW() OR used_at IS NOT NULL
    `,
    { type: QueryTypes.DELETE }
  );

  const affectedRows = result?.[1] || 0;

  logger.info({ msg: 'Cleaned up expired reset tokens', count: affectedRows });

  return affectedRows;
}
