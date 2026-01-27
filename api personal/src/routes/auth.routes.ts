import { Router, Request, Response } from "express";
import { Sequelize } from "sequelize";
import { z } from "zod";
import { env } from "../config/env";
import { verifyPassword } from "../auth/password";
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

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const buildAuthRouter = (sequelize: Sequelize) => {
  const router = Router();

  router.post("/login", async (req: Request, res: Response) => {
    if (!env.AUTH_ENABLE) return res.status(400).json({ ok: false, error: "AUTH_ENABLE=false" });
    if (!env.JWT_ACCESS_SECRET || !env.JWT_REFRESH_SECRET) {
      return res.status(500).json({ ok: false, error: "Faltan JWT_*_SECRET en env" });
    }

    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

    const { email, password } = parsed.data;

    const user = await findUserByEmail(sequelize, email);
    if (!user || !user.active) return res.status(401).json({ ok: false, error: "Credenciales inválidas" });

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) return res.status(401).json({ ok: false, error: "Credenciales inválidas" });

    const accessToken = signAccessToken(user.id, user.roleId);
    const refreshToken = signRefreshToken(user.id);

    const ip = req.ip ? String(req.ip) : null;
    const ua = req.header("user-agent") ? String(req.header("user-agent")) : null;
    const expiresAt = refreshTokenExpiresAtFromNow(env.JWT_REFRESH_TTL_DAYS);

    await storeRefreshToken(sequelize, user.id, refreshToken, null, expiresAt, ip, ua);

    const permissions = await loadPermissionsByRoleId(sequelize, user.roleId);

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

  router.post("/refresh", async (req: Request, res: Response) => {
    const parsed = refreshSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

    const { refreshToken } = parsed.data;

    const valid = await validateRefreshToken(sequelize, refreshToken);
    if (!valid.ok) return res.status(401).json({ ok: false, error: valid.error });

    // rotación: revoco el viejo y creo uno nuevo
    await revokeRefreshTokenByHash(sequelize, refreshToken);

    const user = await findUserById(sequelize, valid.usuarioId);
    if (!user || !user.active) return res.status(401).json({ ok: false, error: "Usuario inválido" });

    const newAccess = signAccessToken(user.id, user.roleId);
    const newRefresh = signRefreshToken(user.id);

    const ip = req.ip ? String(req.ip) : null;
    const ua = req.header("user-agent") ? String(req.header("user-agent")) : null;
    const expiresAt = refreshTokenExpiresAtFromNow(env.JWT_REFRESH_TTL_DAYS);

    await storeRefreshToken(sequelize, user.id, newRefresh, valid.rowId, expiresAt, ip, ua);

    return res.json({
      ok: true,
      data: { accessToken: newAccess, refreshToken: newRefresh },
    });
  });

  router.post("/logout", async (req: Request, res: Response) => {
    const parsed = refreshSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

    const { refreshToken } = parsed.data;

    const valid = await validateRefreshToken(sequelize, refreshToken);
    if (!valid.ok) return res.status(200).json({ ok: true });

    await revokeAllRefreshTokensForUser(sequelize, valid.usuarioId);
    return res.json({ ok: true });
  });

  return router;
};
