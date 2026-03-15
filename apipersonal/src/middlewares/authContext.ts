import { NextFunction, Request, Response } from "express";
import { Sequelize } from "sequelize";
import crypto from "crypto";
import { env } from "../config/env";
import { looksLikeJwt, verifyAccessToken } from "../auth/jwt";
import { loadPermissionsByRoleId } from "../auth/permissionsRepo";

export type AuthContext = {
  principalType: "api_key" | "user" | "dev";
  principalId: number | null;
  roleId: number | null;
  permissions: string[];
};

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

const sha256Hex = (s: string) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

const getXApiKey = (req: Request): string | null => {
  const x = req.header("x-api-key");
  if (x && x.trim()) return x.trim();
  return null;
};

const getBearer = (req: Request): string | null => {
  const auth = req.header("authorization");
  if (!auth) return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m?.[1]) return m[1].trim();
  return null;
};

async function resolveApiKey(sequelize: Sequelize, plaintext: string) {
  const keyHash = sha256Hex(plaintext);

  const [rows] = await sequelize.query(
    `
    SELECT
      ak.id                AS apiKeyId,
      ak.role_id           AS roleId,
      p.clave              AS perm
    FROM api_keys ak
    LEFT JOIN roles_permisos rp ON rp.rol_id = ak.role_id AND rp.deleted_at IS NULL
    LEFT JOIN permisos p        ON p.id = rp.permiso_id AND p.deleted_at IS NULL
    WHERE ak.key_hash = :keyHash
      AND ak.revoked_at IS NULL
    `,
    { replacements: { keyHash } }
  );

  const list = rows as any[];
  if (!list.length) return null;

  const roleId = list[0]?.roleId ?? null;
  const perms = Array.from(
    new Set(list.map((r) => r.perm).filter((x) => typeof x === "string" && x.length > 0))
  );

  return {
    principalId: Number(list[0]?.apiKeyId ?? 0) || null,
    roleId: roleId === null ? null : Number(roleId),
    permissions: perms,
  };
}

export const authContext =
  (sequelize: Sequelize) =>
  async (req: Request, res: Response, next: NextFunction) => {
    if (!env.AUTH_ENABLE) return next();

    // DEV shortcut opcional (solo si habilitado y no prod)
    if (env.AUTH_ALLOW_DEV_USER_ID_HEADER && env.NODE_ENV !== "production") {
      const devUserId = req.header("x-user-id") || req.header("x-dev-user-id");
      if (devUserId && String(devUserId).trim()) {
        const idNum = Number(devUserId);
        req.auth = {
          principalType: "dev",
          principalId: Number.isFinite(idNum) ? idNum : null,
          roleId: null,
          permissions: ["crud:*:*"],
        };
        return next();
      }
    }

    const xApiKey = getXApiKey(req);
    if (xApiKey) {
      const apiKeyAuth = await resolveApiKey(sequelize, xApiKey);
      if (!apiKeyAuth) return res.status(401).json({ ok: false, error: "API key inválida o revocada" });

      req.auth = {
        principalType: "api_key",
        principalId: apiKeyAuth.principalId,
        roleId: apiKeyAuth.roleId,
        permissions: apiKeyAuth.permissions,
      };
      return next();
    }

    const bearer = getBearer(req);
    if (!bearer) {
      return res.status(401).json({ ok: false, error: "Falta credencial (X-Api-Key o Authorization: Bearer)" });
    }

    const mode = env.AUTH_BEARER_MODE;

    const shouldTreatAsJwt =
      mode === "jwt" ? true : mode === "api_key" ? false : looksLikeJwt(bearer);

    if (shouldTreatAsJwt) {
      try {
        const claims = verifyAccessToken(bearer);
        const userId = Number(claims.sub);
        const roleId = claims.roleId ?? null;

        const perms = await loadPermissionsByRoleId(sequelize, roleId);

        req.auth = {
          principalType: "user",
          principalId: Number.isFinite(userId) ? userId : null,
          roleId: roleId === null ? null : Number(roleId),
          permissions: perms,
        };
        return next();
      } catch (e: any) {
        return res.status(401).json({ ok: false, error: "JWT inválido o expirado" });
      }
    }

    // Compat legado: Bearer usado como API key
    const apiKeyAuth = await resolveApiKey(sequelize, bearer);
    if (!apiKeyAuth) return res.status(401).json({ ok: false, error: "API key inválida o revocada" });

    req.auth = {
      principalType: "api_key",
      principalId: apiKeyAuth.principalId,
      roleId: apiKeyAuth.roleId,
      permissions: apiKeyAuth.permissions,
    };
    return next();
  };
