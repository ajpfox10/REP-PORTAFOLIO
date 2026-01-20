import jwt from "jsonwebtoken";
import crypto from "crypto";
import { env } from "../config/env";

export type AccessTokenClaims = {
  sub: string; // userId
  typ: "access";
  roleId: number | null;
};

export type RefreshTokenClaims = {
  sub: string; // userId
  typ: "refresh";
  jti: string; // id aleatorio para refresh
};

export function looksLikeJwt(token: string) {
  const parts = token.split(".");
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

export function signAccessToken(userId: number, roleId: number | null) {
  if (!env.JWT_ACCESS_SECRET) throw new Error("JWT_ACCESS_SECRET vacío");
  const claims: AccessTokenClaims = { sub: String(userId), typ: "access", roleId };
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, { expiresIn: env.JWT_ACCESS_TTL_SECONDS });
}

export function signRefreshToken(userId: number) {
  if (!env.JWT_REFRESH_SECRET) throw new Error("JWT_REFRESH_SECRET vacío");
  const jti = crypto.randomBytes(16).toString("hex");
  const claims: RefreshTokenClaims = { sub: String(userId), typ: "refresh", jti };
  // Expira en días (ej 14)
  return jwt.sign(claims, env.JWT_REFRESH_SECRET, { expiresIn: `${env.JWT_REFRESH_TTL_DAYS}d` });
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  if (!env.JWT_ACCESS_SECRET) throw new Error("JWT_ACCESS_SECRET vacío");
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as any;
  if (decoded?.typ !== "access") throw new Error("Token no es access");
  return decoded as AccessTokenClaims;
}

export function verifyRefreshToken(token: string): RefreshTokenClaims {
  if (!env.JWT_REFRESH_SECRET) throw new Error("JWT_REFRESH_SECRET vacío");
  const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET) as any;
  if (decoded?.typ !== "refresh") throw new Error("Token no es refresh");
  return decoded as RefreshTokenClaims;
}
