import crypto from "crypto";
import { Sequelize } from "sequelize";
import { verifyRefreshToken } from "./jwt";

function sha256Hex(s: string) {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

export function refreshTokenExpiresAtFromNow(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

export async function storeRefreshToken(
  sequelize: Sequelize,
  usuarioId: number,
  refreshToken: string,
  replacedBy: number | null,
  expiresAt: Date,
  ip: string | null,
  userAgent: string | null
) {
  const tokenHash = sha256Hex(refreshToken);

  const [result] = await sequelize.query(
    `
    INSERT INTO refresh_tokens (usuario_id, token_hash, expires_at, revoked_at, replaced_by, ip, user_agent)
    VALUES (:usuarioId, :tokenHash, :expiresAt, NULL, :replacedBy, :ip, :userAgent)
    `,
    {
      replacements: { usuarioId, tokenHash, expiresAt, replacedBy, ip, userAgent },
    }
  );

  const insertId = (result as any)?.insertId;
  return insertId ? Number(insertId) : null;
}

export async function revokeRefreshTokenByHash(sequelize: Sequelize, refreshToken: string) {
  const tokenHash = sha256Hex(refreshToken);

  await sequelize.query(
    `
    UPDATE refresh_tokens
    SET revoked_at = NOW()
    WHERE token_hash = :tokenHash
      AND revoked_at IS NULL
    `,
    { replacements: { tokenHash } }
  );
}

export async function revokeAllRefreshTokensForUser(sequelize: Sequelize, usuarioId: number) {
  await sequelize.query(
    `
    UPDATE refresh_tokens
    SET revoked_at = NOW()
    WHERE usuario_id = :usuarioId
      AND revoked_at IS NULL
    `,
    { replacements: { usuarioId } }
  );
}

export async function findRefreshRow(sequelize: Sequelize, refreshToken: string) {
  const tokenHash = sha256Hex(refreshToken);

  const [rows] = await sequelize.query(
    `
    SELECT
      id,
      usuario_id AS usuarioId,
      token_hash AS tokenHash,
      expires_at AS expiresAt,
      revoked_at AS revokedAt,
      replaced_by AS replacedBy
    FROM refresh_tokens
    WHERE token_hash = :tokenHash
    LIMIT 1
    `,
    { replacements: { tokenHash } }
  );

  const list = rows as any[];
  if (!list.length) return null;

  const r = list[0];
  return {
    id: Number(r.id),
    usuarioId: Number(r.usuarioId),
    tokenHash: String(r.tokenHash),
    expiresAt: new Date(r.expiresAt),
    revokedAt: r.revokedAt ? new Date(r.revokedAt) : null,
    replacedBy: r.replacedBy === null || r.replacedBy === undefined ? null : Number(r.replacedBy),
  };
}

/**
 * Valida refresh JWT + valida que exista en DB y no esté revocado/expirado.
 *
 * IMPORTANTES:
 * - Nunca lanzar exceptions al caller (el handler de /auth/refresh debe poder responder 401 prolijo)
 * - Detección de reuse: si está revocado Y tiene replaced_by, es un refresh rotado que se está reusando.
 */
export async function validateRefreshToken(sequelize: Sequelize, refreshToken: string) {
  let claims: any;
  try {
    claims = verifyRefreshToken(refreshToken);
  } catch {
    // firma inválida / token malformado / token vencido
    return { ok: false as const, kind: "invalid" as const, error: "Refresh token inválido o vencido" };
  }

  const row = await findRefreshRow(sequelize, refreshToken);
  if (!row) return { ok: false as const, kind: "not_registered" as const, error: "Refresh token no registrado" };

  // 👇 Si está revocado y tenía replaced_by -> es candidato a reuse
  if (row.revokedAt && row.replacedBy) {
    return {
      ok: false as const,
      kind: "reuse" as const,
      error: "Refresh token reutilizado",
      usuarioId: row.usuarioId,
      rowId: row.id,
    };
  }

  if (row.revokedAt) return { ok: false as const, kind: "revoked" as const, error: "Refresh token revocado" };
  if (row.expiresAt.getTime() < Date.now())
    return { ok: false as const, kind: "expired" as const, error: "Refresh token expirado" };

  const usuarioId = Number(claims.sub);
  if (!Number.isFinite(usuarioId) || usuarioId <= 0)
    return { ok: false as const, kind: "invalid" as const, error: "Refresh inválido" };

  if (usuarioId !== row.usuarioId)
    return { ok: false as const, kind: "invalid" as const, error: "Refresh inconsistente" };

  return { ok: true as const, usuarioId, rowId: row.id };
}
