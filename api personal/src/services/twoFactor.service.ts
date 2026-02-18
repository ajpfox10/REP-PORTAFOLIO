import { Sequelize, QueryTypes } from 'sequelize';
import crypto from 'crypto';
import { env } from '../config/env';
import { logger } from '../logging/logger';
import { sendEmail, get2FAEmailHtml, get2FAEmailText } from './email.service';

export interface TwoFactorCode {
  id: number;
  usuario_id: number;
  code_hash: string;
  expires_at: Date;
  verified_at: Date | null;
  attempts: number;
  created_at: Date;
}

export function generate2FACode(length: number = 6): string {
  const digits = '0123456789';
  let code = '';
  for (let i = 0; i < length; i++) {
    code += digits[crypto.randomInt(0, digits.length)];
  }
  return code;
}

export function hash2FACode(code: string): string {
  return crypto.createHash('sha256').update(code, 'utf8').digest('hex');
}

export async function create2FACode(
  sequelize: Sequelize,
  userId: number
): Promise<{ code: string; expiresAt: Date }> {
  const code = generate2FACode(env.TWO_FA_CODE_LENGTH || 6);
  const codeHash = hash2FACode(code);

  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + (env.TWO_FA_CODE_TTL_MINUTES || 10));

  await sequelize.query(
    `
    UPDATE two_factor_codes
    SET verified_at = NOW(), updated_at = NOW()
    WHERE usuario_id = :usuario_id AND verified_at IS NULL
    `,
    {
      replacements: { usuario_id: userId },
      type: QueryTypes.UPDATE,
    }
  );

  await sequelize.query(
    `
    INSERT INTO two_factor_codes (usuario_id, code_hash, expires_at, attempts, created_at, updated_at)
    VALUES (:usuario_id, :code_hash, :expires_at, 0, NOW(), NOW())
    `,
    {
      replacements: {
        usuario_id: userId,
        code_hash: codeHash,
        expires_at: expiresAt,
      },
      type: QueryTypes.INSERT,
    }
  );

  return { code, expiresAt };
}

export async function verify2FACode(
  sequelize: Sequelize,
  userId: number,
  code: string
): Promise<{ ok: boolean; error?: string }> {
  const codeHash = hash2FACode(code);

  const rows = await sequelize.query<TwoFactorCode>(
    `
    SELECT *
    FROM two_factor_codes
    WHERE usuario_id = :usuario_id
      AND code_hash = :code_hash
      AND verified_at IS NULL
      AND expires_at > NOW()
    ORDER BY created_at DESC
    LIMIT 1
    `,
    {
      replacements: { usuario_id: userId, code_hash: codeHash },
      type: QueryTypes.SELECT,
    }
  );

  if (!rows || rows.length === 0) {
    return { ok: false, error: 'Código inválido o expirado' };
  }

  const twoFactorCode = rows[0];

  if (twoFactorCode.attempts >= 3) {
    return { ok: false, error: 'Demasiados intentos' };
  }

  await sequelize.query(
    `
    UPDATE two_factor_codes
    SET verified_at = NOW(), updated_at = NOW()
    WHERE id = :id
    `,
    {
      replacements: { id: twoFactorCode.id },
      type: QueryTypes.UPDATE,
    }
  );

  return { ok: true };
}

export async function isUser2FAEnabled(
  sequelize: Sequelize,
  userId: number
): Promise<boolean> {
  const rows = await sequelize.query<any>(
    `
    SELECT two_factor_enabled
    FROM usuarios
    WHERE id = :usuario_id AND deleted_at IS NULL
    LIMIT 1
    `,
    {
      replacements: { usuario_id: userId },
      type: QueryTypes.SELECT,
    }
  );

  if (!rows || rows.length === 0) return false;

  return Boolean(rows[0].two_factor_enabled);
}
