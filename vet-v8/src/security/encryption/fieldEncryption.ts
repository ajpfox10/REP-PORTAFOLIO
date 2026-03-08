import crypto from "node:crypto";
import { AppError } from "../../core/errors/appError.js";

/**
 * Field-level encryption (app-side)
 * - Uses AES-256-GCM
 * - Derives a per-tenant data key using HKDF from a master secret.
 * - For AWS KMS envelope encryption, plug-in can replace deriveKey().
 */

export type EncryptedBlob = {
  v: 1;
  alg: "A256GCM";
  iv: string;   // base64
  tag: string;  // base64
  ct: string;   // base64
};

function hkdf(master: Buffer, salt: Buffer, info: Buffer, len: number) {
  return crypto.hkdfSync("sha256", master, salt, info, len);
}

export function buildFieldEncryption(opts: { masterSecret: string }) {
  if (!opts.masterSecret || opts.masterSecret.length < 32) {
    throw new AppError("CONFIG_ERROR", "ENCRYPTION_MASTER_SECRET must be at least 32 chars");
  }

  const master = Buffer.from(opts.masterSecret);

  function deriveKey(tenantId: string): Buffer {
    const salt = Buffer.from(`tenant:${tenantId}`);
    const info = Buffer.from("veterinaria-saas-field-encryption");
    return hkdf(master, salt, info, 32);
  }

  function encrypt(tenantId: string, plaintext: string): EncryptedBlob {
    const key = deriveKey(tenantId);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ct = Buffer.concat([cipher.update(Buffer.from(plaintext, "utf8")), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
      v: 1,
      alg: "A256GCM",
      iv: iv.toString("base64"),
      tag: tag.toString("base64"),
      ct: ct.toString("base64")
    };
  }

  function decrypt(tenantId: string, blob: EncryptedBlob): string {
    const key = deriveKey(tenantId);
    const iv = Buffer.from(blob.iv, "base64");
    const tag = Buffer.from(blob.tag, "base64");
    const ct = Buffer.from(blob.ct, "base64");

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString("utf8");
  }

  function encryptJson(tenantId: string, value: any): string {
    const blob = encrypt(tenantId, JSON.stringify(value));
    return JSON.stringify(blob);
  }

  function decryptJson<T = any>(tenantId: string, value: string): T {
    const blob = JSON.parse(value) as EncryptedBlob;
    return JSON.parse(decrypt(tenantId, blob)) as T;
  }

  return { encrypt, decrypt, encryptJson, decryptJson };
}
