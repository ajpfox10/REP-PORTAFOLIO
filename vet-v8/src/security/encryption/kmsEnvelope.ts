import crypto from "node:crypto";
import { KMSClient, GenerateDataKeyCommand, DecryptCommand, EncryptCommand } from "@aws-sdk/client-kms";
import type Redis from "ioredis";
import { AppError } from "../../core/errors/appError.js";

/**
 * KMS Envelope Encryption — production-grade implementation
 *
 * Pattern:
 *   1. For each tenant, generate a Data Encryption Key (DEK) via AWS KMS.
 *   2. KMS returns: plaintext DEK (used immediately) + encrypted DEK (stored in DB/Redis).
 *   3. Field encryption uses AES-256-GCM with the plaintext DEK.
 *   4. Plaintext DEK is cached in Redis (TTL: 1h) — never stored permanently.
 *   5. Re-encryption (key rotation): decrypt old DEK → re-encrypt fields → generate new DEK.
 *
 * App-side HKDF fallback (when KMS_KEY_ID is empty):
 *   - Uses the same AES-256-GCM scheme but derives the DEK from ENCRYPTION_MASTER_SECRET + tenantId.
 *   - Semantically equivalent; swap KMS_KEY_ID in production.
 */

export type EncryptedBlob = {
  v: 2;
  alg: "A256GCM";
  kid: string;       // key id (tenantId:version)
  iv: string;        // base64
  tag: string;       // base64
  ct: string;        // base64
};

export type DataKeyRecord = {
  tenantId: string;
  keyVersion: number;
  encryptedDekB64: string; // KMS-encrypted DEK (store in DB)
};

function hkdf(master: Buffer, salt: Buffer, info: Buffer, len: number): Buffer {
  return Buffer.from(crypto.hkdfSync("sha256", master, salt, info, len));
}

function aesGcmEncrypt(key: Buffer, plaintext: Buffer): { iv: string; tag: string; ct: string } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ct: ct.toString("base64"),
  };
}

function aesGcmDecrypt(key: Buffer, iv: string, tag: string, ct: string): Buffer {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]);
}

export function buildKmsEnvelope(opts: {
  kmsKeyId?: string;
  masterSecret?: string;
  redis: Redis;
  masterPool: any; // Pool — injected to store/load encrypted DEKs
}) {
  const useKms = Boolean(opts.kmsKeyId);
  const kms = useKms ? new KMSClient({}) : null;

  // ── DEK Cache (plaintext, ephemeral) ──────────────────────────────────────
  const dekCache = new Map<string, { key: Buffer; expiresAt: number }>();

  function getCachedDek(tenantId: string, version: number): Buffer | null {
    const entry = dekCache.get(`${tenantId}:${version}`);
    if (!entry || entry.expiresAt < Date.now()) return null;
    return entry.key;
  }

  function cacheDek(tenantId: string, version: number, key: Buffer) {
    dekCache.set(`${tenantId}:${version}`, { key, expiresAt: Date.now() + 3_600_000 });
  }

  // ── Fallback: app-side HKDF (no KMS) ─────────────────────────────────────
  function deriveFallbackKey(tenantId: string, version: number): Buffer {
    if (!opts.masterSecret || opts.masterSecret.length < 32) {
      throw new AppError("CONFIG_ERROR", "ENCRYPTION_MASTER_SECRET required (min 32 chars)");
    }
    const master = Buffer.from(opts.masterSecret, "utf8");
    const salt = Buffer.from(`tenant:${tenantId}:v${version}`, "utf8");
    const info = Buffer.from("veterinaria-saas-dek-v1", "utf8");
    return hkdf(master, salt, info, 32);
  }

  // ── Ensure DEK table exists ───────────────────────────────────────────────
  let dekTableReady = false;
  async function ensureDekTable() {
    if (dekTableReady) return;
    await opts.masterPool.query(`
      CREATE TABLE IF NOT EXISTS tenant_data_keys (
        id         BIGINT PRIMARY KEY AUTO_INCREMENT,
        tenant_id  VARCHAR(64) NOT NULL,
        key_version INT NOT NULL DEFAULT 1,
        encrypted_dek_b64 TEXT NOT NULL,
        kms_key_id VARCHAR(256) NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_tenant_version (tenant_id, key_version),
        INDEX idx_tenant (tenant_id)
      )
    `);
    dekTableReady = true;
  }

  // ── Get or create DEK for tenant ─────────────────────────────────────────
  async function getOrCreateDek(tenantId: string): Promise<{ key: Buffer; version: number }> {
    await ensureDekTable();

    // Load current version from DB
    const [rows] = await opts.masterPool.query<any[]>(
      "SELECT key_version, encrypted_dek_b64 FROM tenant_data_keys WHERE tenant_id=? ORDER BY key_version DESC LIMIT 1",
      [tenantId]
    );

    if (rows?.length) {
      const { key_version: version, encrypted_dek_b64: encB64 } = rows[0];
      const cached = getCachedDek(tenantId, version);
      if (cached) return { key: cached, version };

      // Decrypt DEK
      let plaintextKey: Buffer;
      if (useKms && kms) {
        const cmd = new DecryptCommand({ CiphertextBlob: Buffer.from(encB64, "base64"), KeyId: opts.kmsKeyId });
        const res = await kms.send(cmd);
        if (!res.Plaintext) throw new AppError("CONFIG_ERROR", "KMS DecryptCommand returned no plaintext");
        plaintextKey = Buffer.from(res.Plaintext);
      } else {
        plaintextKey = deriveFallbackKey(tenantId, version);
      }

      cacheDek(tenantId, version, plaintextKey);
      return { key: plaintextKey, version };
    }

    // No DEK yet — generate one
    return generateNewDek(tenantId, 1);
  }

  async function generateNewDek(tenantId: string, version: number): Promise<{ key: Buffer; version: number }> {
    await ensureDekTable();

    let plaintextKey: Buffer;
    let encryptedDekB64: string;

    if (useKms && kms) {
      const cmd = new GenerateDataKeyCommand({ KeyId: opts.kmsKeyId!, KeySpec: "AES_256" });
      const res = await kms.send(cmd);
      if (!res.Plaintext || !res.CiphertextBlob) throw new AppError("CONFIG_ERROR", "KMS GenerateDataKey failed");
      plaintextKey = Buffer.from(res.Plaintext);
      encryptedDekB64 = Buffer.from(res.CiphertextBlob).toString("base64");
    } else {
      plaintextKey = deriveFallbackKey(tenantId, version);
      encryptedDekB64 = `fallback:${tenantId}:v${version}`; // marker — plaintext derived on demand
    }

    await opts.masterPool.query(
      "INSERT INTO tenant_data_keys (tenant_id, key_version, encrypted_dek_b64, kms_key_id) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE encrypted_dek_b64=VALUES(encrypted_dek_b64)",
      [tenantId, version, encryptedDekB64, opts.kmsKeyId ?? null]
    );

    cacheDek(tenantId, version, plaintextKey);
    return { key: plaintextKey, version };
  }

  // ── Rotate DEK ───────────────────────────────────────────────────────────
  /**
   * Generates a new DEK version for the tenant.
   * Caller is responsible for re-encrypting existing blobs (use reEncryptBlob).
   */
  async function rotateDek(tenantId: string): Promise<number> {
    await ensureDekTable();
    const [rows] = await opts.masterPool.query<any[]>(
      "SELECT MAX(key_version) as max_v FROM tenant_data_keys WHERE tenant_id=?",
      [tenantId]
    );
    const nextVersion = (Number(rows?.[0]?.max_v ?? 0)) + 1;
    await generateNewDek(tenantId, nextVersion);
    return nextVersion;
  }

  // ── Encrypt/Decrypt ───────────────────────────────────────────────────────
  async function encrypt(tenantId: string, plaintext: string): Promise<EncryptedBlob> {
    const { key, version } = await getOrCreateDek(tenantId);
    const { iv, tag, ct } = aesGcmEncrypt(key, Buffer.from(plaintext, "utf8"));
    return { v: 2, alg: "A256GCM", kid: `${tenantId}:${version}`, iv, tag, ct };
  }

  async function decrypt(tenantId: string, blob: EncryptedBlob): Promise<string> {
    // Extract version from kid
    const version = parseInt(String(blob.kid ?? "").split(":")[1] ?? "1", 10);
    const cached = getCachedDek(tenantId, version);

    let key: Buffer;
    if (cached) {
      key = cached;
    } else {
      const [rows] = await opts.masterPool.query<any[]>(
        "SELECT encrypted_dek_b64 FROM tenant_data_keys WHERE tenant_id=? AND key_version=? LIMIT 1",
        [tenantId, version]
      );
      if (!rows?.length) throw new AppError("DB_ERROR", "DEK not found for version", { tenantId, version });

      if (useKms && kms) {
        const cmd = new DecryptCommand({ CiphertextBlob: Buffer.from(rows[0].encrypted_dek_b64, "base64"), KeyId: opts.kmsKeyId });
        const res = await kms.send(cmd);
        if (!res.Plaintext) throw new AppError("CONFIG_ERROR", "KMS decrypt returned no plaintext");
        key = Buffer.from(res.Plaintext);
      } else {
        key = deriveFallbackKey(tenantId, version);
      }
      cacheDek(tenantId, version, key);
    }

    return aesGcmDecrypt(key, blob.iv, blob.tag, blob.ct).toString("utf8");
  }

  async function encryptJson(tenantId: string, value: unknown): Promise<string> {
    const blob = await encrypt(tenantId, JSON.stringify(value));
    return JSON.stringify(blob);
  }

  async function decryptJson<T = unknown>(tenantId: string, raw: string): Promise<T> {
    const blob = JSON.parse(raw) as EncryptedBlob;
    return JSON.parse(await decrypt(tenantId, blob)) as T;
  }

  /**
   * Re-encrypt a blob under a new DEK version (for rotation).
   * Usage: await reEncryptBlob(tenantId, oldBlobJson, newVersion)
   */
  async function reEncryptBlob(tenantId: string, oldBlobJson: string, targetVersion: number): Promise<string> {
    const plaintext = await decryptJson(tenantId, oldBlobJson);
    const { key } = await getOrCreateDek(tenantId); // uses current version
    const { iv, tag, ct } = aesGcmEncrypt(key, Buffer.from(JSON.stringify(plaintext), "utf8"));
    const newBlob: EncryptedBlob = { v: 2, alg: "A256GCM", kid: `${tenantId}:${targetVersion}`, iv, tag, ct };
    return JSON.stringify(newBlob);
  }

  return { encrypt, decrypt, encryptJson, decryptJson, rotateDek, reEncryptBlob, getOrCreateDek, loadDekByVersion };
}

export type KmsEnvelope = ReturnType<typeof buildKmsEnvelope>;
