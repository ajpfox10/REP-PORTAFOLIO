/**
 * Secure Token Generator — v10  (S-09)
 *
 * Centralizes generation of all short-lived tokens (reset, invite, portal)
 * using crypto.randomBytes(32) — 256 bits of CSPRNG entropy.
 *
 * Previously tokens used nanoid() (122 bits) or UUID v4 (122 bits).
 * While 122 bits is technically sufficient, explicit 256-bit tokens
 * are future-proof and consistent with NIST SP 800-132 recommendations.
 *
 * All tokens are URL-safe base64 (no +/=) for direct use in links.
 *
 * Usage:
 *   const token = generateSecureToken();           // 256-bit, URL-safe base64
 *   const hash  = hashSecureToken(token);          // SHA-256 hex, store in DB
 *   const valid = verifySecureToken(token, hash);  // constant-time compare
 */

import crypto from "node:crypto";

/** Generate a 256-bit URL-safe token (43 chars, base64url). */
export function generateSecureToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Hash a token for DB storage.
 * SHA-256 is acceptable here because tokens are already 256-bit random —
 * unlike passwords, they have no structure to attack.
 */
export function hashSecureToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Verify a token against its stored hash.
 * Uses timingSafeEqual to prevent timing oracle attacks.
 */
export function verifySecureToken(plainToken: string, storedHash: string): boolean {
  try {
    const expected = Buffer.from(storedHash, "hex");
    const actual   = Buffer.from(hashSecureToken(plainToken), "hex");
    if (expected.length !== actual.length) return false;
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
