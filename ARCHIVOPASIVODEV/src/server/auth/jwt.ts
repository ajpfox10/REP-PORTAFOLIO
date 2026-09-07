import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { randomHex } from "../utils/hash.js";

export type AccessClaims = {
  sub: string;
  typ: "access";
  roleId: number;
  tokenVersion: number;
};

export type RefreshClaims = {
  sub: string;
  typ: "refresh";
  jti: string;
};

// Firma un access token corto para autenticar requests.
export function signAccessToken(userId: number, roleId: number, tokenVersion: number) {
  const claims: AccessClaims = { sub: String(userId), typ: "access", roleId, tokenVersion };
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, { expiresIn: env.JWT_ACCESS_TTL_SECONDS });
}

// Firma un refresh token largo para renovar sesiones desde la DB.
export function signRefreshToken(userId: number) {
  const claims: RefreshClaims = { sub: String(userId), typ: "refresh", jti: randomHex(16) };
  return jwt.sign(claims, env.JWT_REFRESH_SECRET, { expiresIn: `${env.JWT_REFRESH_TTL_DAYS}d` });
}

// Verifica que el token recibido sea access y tenga firma valida.
export function verifyAccessToken(token: string) {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessClaims;
  if (decoded.typ !== "access") throw new Error("Token no es access");
  return decoded;
}

// Verifica que el token recibido sea refresh y tenga firma valida.
export function verifyRefreshToken(token: string) {
  const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET) as RefreshClaims;
  if (decoded.typ !== "refresh") throw new Error("Token no es refresh");
  return decoded;
}
