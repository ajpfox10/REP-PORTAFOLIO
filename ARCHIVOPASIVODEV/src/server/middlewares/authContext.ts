import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../auth/jwt.js";
import { loadPermissionsByRoleId } from "../auth/permissions.js";
import { findUserById } from "../auth/users.js";

export type AuthContext = {
  userId: number;
  roleId: number;
  permissions: string[];
};

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

// Extrae el Bearer token del header Authorization.
function bearer(req: Request) {
  const value = req.header("authorization") || "";
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

// Valida access token, usuario activo, version de sesion y permisos.
export async function authContext(req: Request, res: Response, next: NextFunction) {
  try {
    const token = bearer(req);
    if (!token) return res.status(401).json({ ok: false, error: "No autenticado" });

    const claims = verifyAccessToken(token);
    const user = await findUserById(Number(claims.sub));
    if (!user || !user.activo) return res.status(401).json({ ok: false, error: "Usuario inactivo" });
    if (Number(user.token_version) !== Number(claims.tokenVersion)) {
      return res.status(401).json({ ok: false, error: "Sesion invalidada" });
    }

    req.auth = {
      userId: user.id,
      roleId: user.rol_id,
      permissions: await loadPermissionsByRoleId(user.rol_id),
    };
    return next();
  } catch {
    return res.status(401).json({ ok: false, error: "Token invalido o vencido" });
  }
}
