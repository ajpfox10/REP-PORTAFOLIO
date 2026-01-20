import { Router, Request, Response } from "express";
import { Sequelize } from "sequelize";
import { z } from "zod";
import { env } from "../config/env";
import { verifyPassword } from "../auth/password";
import { signAccessToken, signRefreshToken } from "../auth/jwt";
import { loadPermissionsByRoleId } from "../auth/permissionsRepo";
import { findUserByEmail, findUserById } from "../auth/usersRepo";
import { authContext } from "../middlewares/authContext";
import crypto from "crypto";
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

// Compat: si el refresh token viene en body (legacy) lo aceptamos,
// pero el modo "CIA" usa cookie HttpOnly.
const refreshSchema = z
  .object({
    refreshToken: z.string().min(1).optional(),
  })
  .optional();

const CSRF_COOKIE = "p5_csrf";
const REFRESH_COOKIE = "p5_refresh";

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (!k) continue;
    out[k] = decodeURIComponent(v);
  }
  return out;
}

function newCsrfToken() {
  return crypto.randomBytes(24).toString("hex");
}

function cookieBaseOpts(req: Request) {
  // En LAN puede ser http, pero si tenes TLS, ponelo en true.
  // Si TRUST_PROXY está habilitado, Express usa req.secure correctamente.
  const secure = env.COOKIE_SECURE ?? (req.secure || false);
  return {
    secure,
    sameSite: "strict" as const,
    // domain opcional (en LAN muchas veces conviene NO setearlo)
    domain: env.COOKIE_DOMAIN || undefined,
  };
}

function setAuthCookies(res: Response, req: Request, refreshToken: string) {
  const base = cookieBaseOpts(req);

  // refresh: HttpOnly
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...base,
    httpOnly: true,
    path: "/api/v1/auth",
    maxAge: env.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
  });

  // csrf: readable por JS (double submit)
  res.cookie(CSRF_COOKIE, newCsrfToken(), {
    ...base,
    httpOnly: false,
    path: "/",
    maxAge: env.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
}

function getRefreshTokenFromRequest(req: Request): string | null {
  const cookies = parseCookies(req);
  const fromCookie = cookies[REFRESH_COOKIE];
  if (fromCookie && String(fromCookie).trim()) return String(fromCookie).trim();
  // legacy: body
  const bodyAny = req.body as any;
  const fromBody = bodyAny?.refreshToken;
  if (fromBody && String(fromBody).trim()) return String(fromBody).trim();
  return null;
}

function clearAuthCookies(res: Response, req: Request) {
  const base = cookieBaseOpts(req);
  res.clearCookie(REFRESH_COOKIE, { ...base, path: "/api/v1/auth" });
  res.clearCookie(CSRF_COOKIE, { ...base, path: "/" });
}

function requireCsrf(req: Request, res: Response): boolean {
  const cookies = parseCookies(req);
  const csrfCookie = cookies[CSRF_COOKIE];
  const csrfHeader = String(req.header("x-csrf-token") || "").trim();
  if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
    res.status(403).json({ ok: false, error: "CSRF inválido" });
    return false;
  }
  return true;
}

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

    // ✅ CIA: refresh en cookie HttpOnly + CSRF (double submit)
    if (env.AUTH_REFRESH_COOKIE) {
      setAuthCookies(res, req, refreshToken);
    }

    return res.json({
      ok: true,
      data: {
        accessToken,
        // Si AUTH_REFRESH_COOKIE=true, el refresh viaja en cookie HttpOnly.
        refreshToken: env.AUTH_REFRESH_COOKIE ? undefined : refreshToken,
        user: { id: user.id, email: user.email, nombre: user.nombre, roleId: user.roleId },
        permissions,
      },
    });
  });

  router.post("/refresh", async (req: Request, res: Response) => {
    // En modo cookie, exigimos CSRF.
    if (env.AUTH_REFRESH_COOKIE && !requireCsrf(req, res)) return;

    const refreshToken = getRefreshTokenFromRequest(req);
    if (!refreshToken) return res.status(400).json({ ok: false, error: "Falta refreshToken" });

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

    if (env.AUTH_REFRESH_COOKIE) {
      // rotación también en cookie
      setAuthCookies(res, req, newRefresh);
    }

    return res.json({
      ok: true,
      data: {
        accessToken: newAccess,
        refreshToken: env.AUTH_REFRESH_COOKIE ? undefined : newRefresh,
      },
    });
  });

  router.post("/logout", async (req: Request, res: Response) => {
    if (env.AUTH_REFRESH_COOKIE && !requireCsrf(req, res)) return;

    const refreshToken = getRefreshTokenFromRequest(req);
    if (!refreshToken) {
      clearAuthCookies(res, req);
      return res.status(200).json({ ok: true });
    }

    const valid = await validateRefreshToken(sequelize, refreshToken);
    if (!valid.ok) return res.status(200).json({ ok: true });

    await revokeAllRefreshTokensForUser(sequelize, valid.usuarioId);
    clearAuthCookies(res, req);
    return res.json({ ok: true });
  });

  // ✅ Who am I (para hardening del front)
  router.get("/me", authContext(sequelize), async (req: Request, res: Response) => {
    const auth = (req as any).auth;
    if (!auth?.principalId) return res.status(401).json({ ok: false, error: "No auth" });

    const user = await findUserById(sequelize, auth.principalId);
    if (!user || !user.active) return res.status(401).json({ ok: false, error: "Usuario inválido" });

    const permissions = await loadPermissionsByRoleId(sequelize, user.roleId);
    return res.json({
      ok: true,
      data: { user: { id: user.id, email: user.email, nombre: user.nombre, roleId: user.roleId }, permissions },
    });
  });

  return router;
};
