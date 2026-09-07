import { env } from "../config/env.js";
import { query } from "../db/pool.js";
import { sha256Hex } from "../utils/hash.js";
import { signRefreshToken, verifyRefreshToken } from "./jwt.js";

// Calcula la fecha de vencimiento del refresh token persistido.
function refreshExpiresAt() {
  const date = new Date();
  date.setDate(date.getDate() + env.JWT_REFRESH_TTL_DAYS);
  return date;
}

// Guarda refresh tokens hasheados para que la DB no contenga tokens reutilizables.
export async function storeRefreshToken(userId: number, refreshToken: string, ip: string, userAgent: string, replacedBy: number | null = null) {
  const tokenHash = sha256Hex(refreshToken);
  const result = await query<{ insertId: number }>(
    `INSERT INTO refresh_tokens (usuario_id, token_hash, expires_at, replaced_by, ip, user_agent)
     VALUES (:userId, :tokenHash, :expiresAt, :replacedBy, :ip, :userAgent)`,
    { userId, tokenHash, expiresAt: refreshExpiresAt(), replacedBy, ip, userAgent }
  );
  return Number((result as any).insertId || 0);
}

// Revoca un refresh token puntual durante logout o rotacion.
export async function revokeRefreshToken(refreshToken: string) {
  await query(
    `UPDATE refresh_tokens SET revoked_at = NOW()
      WHERE token_hash = :tokenHash AND revoked_at IS NULL`,
    { tokenHash: sha256Hex(refreshToken) }
  );
}

// Revoca todas las sesiones de un usuario para logout global o incidente.
export async function revokeAllRefreshTokens(userId: number) {
  await query(
    `UPDATE refresh_tokens SET revoked_at = NOW()
      WHERE usuario_id = :userId AND revoked_at IS NULL`,
    { userId }
  );
}

// Valida el refresh actual, lo revoca y crea uno nuevo para evitar reutilizacion.
export async function rotateRefreshToken(refreshToken: string, ip: string, userAgent: string) {
  const claims = verifyRefreshToken(refreshToken);
  const userId = Number(claims.sub);
  const tokenHash = sha256Hex(refreshToken);
  const rows = await query<Array<{ id: number; usuario_id: number; revoked_at: Date | null; expires_at: Date }>>(
    `SELECT id, usuario_id, revoked_at, expires_at
       FROM refresh_tokens
      WHERE token_hash = :tokenHash
      LIMIT 1`,
    { tokenHash }
  );

  const row = rows[0];
  if (!row || row.usuario_id !== userId) throw new Error("Refresh invalido");
  if (row.revoked_at) {
    await revokeAllRefreshTokens(userId);
    throw new Error("Refresh reutilizado");
  }
  if (new Date(row.expires_at).getTime() < Date.now()) throw new Error("Refresh vencido");

  const nextRefreshToken = signRefreshToken(userId);
  const nextId = await storeRefreshToken(userId, nextRefreshToken, ip, userAgent, row.id);
  await query(
    `UPDATE refresh_tokens SET revoked_at = NOW(), replaced_by = :nextId WHERE id = :id`,
    { id: row.id, nextId }
  );

  return { userId, refreshToken: nextRefreshToken };
}
