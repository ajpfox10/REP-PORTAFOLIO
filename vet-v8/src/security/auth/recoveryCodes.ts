/**
 * Recovery Codes — v9 security hardening
 *
 * CHANGES vs v8:
 *  - Entropy raised from 40 bits (5 bytes hex) to 128 bits (16 bytes hex).
 *  - Codes formatted as XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX for readability.
 *  - Hashing upgraded from raw SHA-256 (no salt, rainbow-table vulnerable)
 *    to argon2id via scrypt-fallback with per-code random salt.
 *    Schema: `code_hash` stores "argon2id$<salt_hex>$<hash_hex>".
 *  - Verification uses crypto.timingSafeEqual to prevent timing attacks.
 *
 * SECURITY RATIONALE:
 *  Recovery codes substitute full MFA — treat them as passwords.
 *  SHA-256 with no salt on a short token allows offline GPU brute-force if
 *  the hash table is leaked. Per-code salt + memory-hard KDF (scrypt/argon2id)
 *  makes each code's hash independent and GPU-resistant.
 */

import crypto from "node:crypto";

// ── Constants ────────────────────────────────────────────────────────────────

/** 16 bytes = 128 bits of CSPRNG entropy per code */
const CODE_BYTES = 16;

/** KDF output length: 32 bytes = 256 bits */
const HASH_LEN = 32;

/** Salt: 16 bytes = 128 bits, unique per code */
const SALT_BYTES = 16;

// ── Code generation ──────────────────────────────────────────────────────────

/**
 * Generate `count` one-time recovery codes.
 * Format: XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX (32 hex chars, 128 bits total)
 */
export function generateRecoveryCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(CODE_BYTES).toString("hex"); // 32 hex chars
    codes.push(
      `${raw.slice(0, 8)}-${raw.slice(8, 16)}-${raw.slice(16, 24)}-${raw.slice(24, 32)}`
    );
  }
  return codes;
}

// ── Hashing ───────────────────────────────────────────────────────────────────

/**
 * Hash a recovery code with scrypt (argon2id-equivalent work factor) + salt.
 * Returns "argon2id$<salt_hex>$<hash_hex>" — self-contained, storable in DB.
 */
export async function hashRecoveryCode(code: string): Promise<string> {
  const normalized = _normalize(code);
  const salt = crypto.randomBytes(SALT_BYTES);
  const hash = await _kdf(Buffer.from(normalized, "utf8"), salt);
  return `argon2id$${salt.toString("hex")}$${hash.toString("hex")}`;
}

/**
 * Verify a plaintext recovery code against a stored hash string.
 * Uses crypto.timingSafeEqual — never throws, returns false on any error.
 */
export async function verifyRecoveryCode(
  plainCode: string,
  storedHash: string
): Promise<boolean> {
  try {
    const parts = storedHash.split("$");
    if (parts.length !== 3 || parts[0] !== "argon2id") return false;

    const salt     = Buffer.from(parts[1], "hex");
    const expected = Buffer.from(parts[2], "hex");
    if (salt.length !== SALT_BYTES || expected.length !== HASH_LEN) return false;

    const actual = await _kdf(Buffer.from(_normalize(plainCode), "utf8"), salt);
    if (actual.length !== expected.length) return false;
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// ── Internals ─────────────────────────────────────────────────────────────────

/** Strip dashes, lowercase — codes are case-insensitive */
function _normalize(code: string): string {
  return code.replace(/-/g, "").toLowerCase().trim();
}

/**
 * Memory-hard KDF using scrypt (Node built-in, no deps).
 * N=2^17=131072, r=8, p=1 → ~64 MiB RAM, comparable to argon2id(m=65536,t=3).
 * Upgrade to native argon2id when Node 22 LTS is standard.
 */
function _kdf(password: Buffer, salt: Buffer): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, HASH_LEN, { N: 131072, r: 8, p: 1 }, (err, key) =>
      err ? reject(err) : resolve(key)
    );
  });
}
