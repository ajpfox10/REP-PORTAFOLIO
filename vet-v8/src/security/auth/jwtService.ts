/**
 * JWT Service — v10
 *
 * S-01: Added issuer (iss) and audience (aud) claims on sign + verification.
 *   - signAccess/signRefresh: .setIssuer(JWT_ISSUER).setAudience(JWT_AUDIENCE)
 *   - verifyAccess/verifyRefresh: issuer + audience validated by jose
 *   - A staging token is now REJECTED in production (different issuer values)
 *   - A token from a compromised side-service is REJECTED (different audience)
 *
 * Configure via env:
 *   JWT_ISSUER   = vetpro:api:v1        (or per-env: vetpro:api:v1:staging)
 *   JWT_AUDIENCE = vetpro:client
 */

import { AppError } from "../../core/errors/appError.js";
import { nanoid } from "nanoid";
import crypto from "node:crypto";
import {
  SignJWT,
  jwtVerify,
  importPKCS8,
  importJWK,
  exportJWK,
  type JWK,
  type KeyLike,
} from "jose";

export const JWT_ISSUER   = process.env.JWT_ISSUER   ?? "vetpro:api:v1";
export const JWT_AUDIENCE = process.env.JWT_AUDIENCE ?? "vetpro:client";

export type JwtPayload = {
  sub: string;
  tid: string;
  roles: string[];
  sucursal_id?: string;
  veterinario_id?: string;
  sid?: string;
  fid?: string;
  act?: string;
  jti: string;
  tkv?: number;
  imp?: boolean;
  iat: number;
  exp: number;
  kid?: string;
  iss?: string;
  aud?: string | string[];
};

type JwtOpts = {
  algorithm: "HS256" | "RS256";
  keyId: string;
  secret?: string;
  refreshSecret?: string;
  privateKeyPem?: string;
  jwksPublicKeysJson?: string;
};

function asBuf(v: string) {
  return new TextEncoder().encode(v);
}

async function buildKeyMaterial(opts: JwtOpts) {
  if (opts.algorithm === "HS256") {
    if (!opts.secret || !opts.refreshSecret) {
      throw new AppError("CONFIG_ERROR", "JWT secrets missing for HS256");
    }
    return {
      alg: "HS256" as const,
      accessSignKey: asBuf(opts.secret),
      accessVerifyKeys: [asBuf(opts.secret)] as Array<KeyLike | Uint8Array>,
      refreshSignKey: asBuf(opts.refreshSecret),
      refreshVerifyKeys: [asBuf(opts.refreshSecret)] as Array<KeyLike | Uint8Array>,
    };
  }

  if (!opts.privateKeyPem) throw new AppError("CONFIG_ERROR", "JWT_PRIVATE_KEY_PEM required for RS256");
  const accessSignKey = await importPKCS8(opts.privateKeyPem, "RS256");
  const verifyKeys: Array<{ kid?: string; key: KeyLike }> = [];

  if (opts.jwksPublicKeysJson?.trim()) {
    let jwks: any;
    try { jwks = JSON.parse(opts.jwksPublicKeysJson); }
    catch { throw new AppError("CONFIG_ERROR", "JWKS_PUBLIC_KEYS_JSON must be valid JSON"); }
    const arr = Array.isArray(jwks) ? jwks : jwks?.keys;
    if (!Array.isArray(arr) || !arr.length) throw new AppError("CONFIG_ERROR", "JWKS_PUBLIC_KEYS_JSON must contain keys");
    for (const jwk of arr) {
      verifyKeys.push({ kid: (jwk as any).kid, key: await importJWK(jwk as JWK, "RS256") });
    }
  } else {
    const pub = crypto.createPublicKey(opts.privateKeyPem);
    const jwk = await exportJWK(pub as any);
    verifyKeys.push({ kid: opts.keyId, key: await importJWK({ ...jwk, kid: opts.keyId } as any, "RS256") });
  }

  return {
    alg: "RS256" as const,
    accessSignKey,
    accessVerifyKeys: verifyKeys,
    refreshSignKey: accessSignKey,
    refreshVerifyKeys: verifyKeys,
  };
}

export function buildJwtService(opts: JwtOpts) {
  const materialPromise = buildKeyMaterial(opts);

  // ── Sign ──────────────────────────────────────────────────────────────────

  async function signAccess(payload: Omit<JwtPayload, "jti" | "iat" | "exp" | "kid" | "iss" | "aud">) {
    const material = await materialPromise;
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ ...payload, jti: nanoid() })
      .setProtectedHeader({ alg: material.alg, kid: opts.keyId, typ: "JWT" })
      .setIssuedAt(now)
      .setExpirationTime(now + 15 * 60)
      .setIssuer(JWT_ISSUER)        // S-01
      .setAudience(JWT_AUDIENCE)    // S-01
      .sign(material.accessSignKey as any);
  }

  async function signRefresh(optsRt: {
    userId: string; tenantId: string; tokenVersion?: number; sessionId: string; familyId: string;
  }) {
    const material = await materialPromise;
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({
      sub: optsRt.userId,
      tid: optsRt.tenantId,
      sid: optsRt.sessionId,
      fid: optsRt.familyId,
      jti: nanoid(),
      tkv: optsRt.tokenVersion ?? 0,
    })
      .setProtectedHeader({ alg: material.alg, kid: opts.keyId, typ: "JWT" })
      .setIssuedAt(now)
      .setExpirationTime(now + 7 * 24 * 60 * 60)
      .setIssuer(JWT_ISSUER)        // S-01
      .setAudience(JWT_AUDIENCE)    // S-01
      .sign(material.refreshSignKey as any);
  }

  // ── Verify ────────────────────────────────────────────────────────────────

  const verifyOpts = {
    issuer:   JWT_ISSUER,      // S-01: reject tokens from other environments
    audience: JWT_AUDIENCE,    // S-01: reject tokens meant for other services
    clockTolerance: 5,
  };

  async function verifyAccess(token: string): Promise<JwtPayload> {
    const material = await materialPromise;
    try {
      if (material.alg === "HS256") {
        const { payload } = await jwtVerify(token, material.accessVerifyKeys[0] as any,
          { ...verifyOpts, algorithms: ["HS256"] });
        return payload as any;
      }
      const { protectedHeader } = await jwtVerify(token, material.accessVerifyKeys[0].key as any,
        { ...verifyOpts, algorithms: ["RS256"] });
      const key = material.accessVerifyKeys.find(k => k.kid === protectedHeader.kid)?.key
        ?? material.accessVerifyKeys[0].key;
      const { payload } = await jwtVerify(token, key as any,
        { ...verifyOpts, algorithms: ["RS256"] });
      return payload as any;
    } catch (e: any) {
      if (e?.code === "ERR_JWT_EXPIRED" || e?.name === "JWTExpired") throw new AppError("TOKEN_EXPIRED", "Access token expired");
      throw new AppError("AUTH_REQUIRED", "Invalid access token");
    }
  }

  async function verifyRefresh(token: string): Promise<{
    sub: string; tid: string; jti: string; tkv?: number; sid?: string; fid?: string; act?: string; imp?: boolean;
  }> {
    const material = await materialPromise;
    try {
      if (material.alg === "HS256") {
        const { payload } = await jwtVerify(token, material.refreshVerifyKeys[0] as any,
          { ...verifyOpts, algorithms: ["HS256"] });
        return payload as any;
      }
      const { protectedHeader } = await jwtVerify(token, material.refreshVerifyKeys[0].key as any,
        { ...verifyOpts, algorithms: ["RS256"] });
      const key = material.refreshVerifyKeys.find(k => k.kid === protectedHeader.kid)?.key
        ?? material.refreshVerifyKeys[0].key;
      const { payload } = await jwtVerify(token, key as any,
        { ...verifyOpts, algorithms: ["RS256"] });
      return payload as any;
    } catch {
      throw new AppError("AUTH_REQUIRED", "Invalid refresh token");
    }
  }

  function extractFromRequest(authHeader?: string): string {
    if (!authHeader?.startsWith("Bearer ")) throw new AppError("AUTH_REQUIRED", "Missing Authorization header");
    return authHeader.slice(7);
  }

  return { signAccess, signRefresh, verifyAccess, verifyRefresh, extractFromRequest, algorithm: opts.algorithm };
}

export type JwtService = ReturnType<typeof buildJwtService>;
