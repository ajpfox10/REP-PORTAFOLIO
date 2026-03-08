import { Router } from "express";
import crypto from "node:crypto";
import { exportJWK, importPKCS8, type JWK } from "jose";
import { type AppConfig } from "../../config/types.js";

export async function buildJwksRouter(config: AppConfig) {
  const router = Router();

  router.get("/.well-known/jwks.json", async (_req, res) => {
    let keys: any[] = [];

    if (config.jwksPublicKeysJson?.trim()) {
      try {
        const parsed = JSON.parse(config.jwksPublicKeysJson);
        keys = Array.isArray(parsed) ? parsed : (parsed?.keys ?? []);
      } catch {
        keys = [];
      }
    }

    // If no JWKS provided and RS256 enabled, derive from private key
    if (!keys.length && config.jwtAlgorithm === "RS256" && config.jwtPrivateKeyPem) {
      const pub = crypto.createPublicKey(config.jwtPrivateKeyPem);
      const jwk = (await exportJWK(pub as any)) as JWK;
      keys = [{ ...jwk, kid: config.jwtKeyId, alg: "RS256", use: "sig" }];
    }

    res.json({ keys });
  });

  return router;
}
