/**
 * JWKS router — v9
 *
 * CHANGES vs v8:
 *  - Added Cache-Control: public, max-age=3600 header.
 *  - Added ETag based on SHA-256 of serialized keys (conditional GET support).
 *  - Clients (Prometheus, API gateways, partner services) can cache the
 *    public key for 1 hour and avoid hammering the endpoint.
 *  - On key rotation: bump the TTL down temporarily then restore it.
 *    The ETag ensures clients that poll will detect the change immediately.
 *
 * WHY: Without Cache-Control, every JWT verification in distributed validators
 * hits this endpoint. With ETag + 1h TTL, only changed keys trigger a reload.
 */

import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { exportJWK, importPKCS8, type JWK } from "jose";
import { type AppConfig } from "../../config/types.js";

/** Cache TTL in seconds served to clients. Decrease before key rotation. */
const JWKS_CACHE_TTL_SECONDS = 3600;

export async function buildJwksRouter(config: AppConfig) {
  const router = Router();

  router.get("/.well-known/jwks.json", async (_req: Request, res: Response) => {
    let keys: JWK[] = [];

    if (config.jwksPublicKeysJson?.trim()) {
      try {
        const parsed = JSON.parse(config.jwksPublicKeysJson);
        keys = Array.isArray(parsed) ? parsed : (parsed?.keys ?? []);
      } catch {
        keys = [];
      }
    }

    // Derive public key from PEM if no JWKS was configured and RS256 is active
    if (!keys.length && config.jwtAlgorithm === "RS256" && config.jwtPrivateKeyPem) {
      const pub = crypto.createPublicKey(config.jwtPrivateKeyPem);
      const jwk = (await exportJWK(pub as any)) as JWK;
      keys = [{ ...jwk, kid: config.jwtKeyId, alg: "RS256", use: "sig" }];
    }

    const body = JSON.stringify({ keys });

    // ETag: SHA-256 of the serialized key set (weak etag for content equality)
    const etag = `"${crypto.createHash("sha256").update(body).digest("hex").slice(0, 16)}"`;

    res.set({
      "Cache-Control": `public, max-age=${JWKS_CACHE_TTL_SECONDS}`,
      "ETag": etag,
      "Content-Type": "application/json",
    });

    // Support conditional GET (If-None-Match)
    if (_req.headers["if-none-match"] === etag) {
      res.status(304).end();
      return;
    }

    res.status(200).send(body);
  });

  return router;
}
