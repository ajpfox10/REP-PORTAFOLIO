/**
 * File Upload Validation — v10  (S-08)
 *
 * Problems solved:
 *   1. MIME type validation by magic bytes (not Content-Type header — trivially spoofed)
 *   2. Per-tenant storage quota enforcement (prevents S3 DoS)
 *   3. SHA-256 fingerprint generation for integrity verification
 *   4. File extension allowlist
 *
 * Usage in filesRouter:
 *   const validation = await validateUpload(buffer, originalName, tenantId, pool, config);
 *   // validation.mimeType, validation.sha256, validation.sizeBytes
 */

import crypto from "node:crypto";
import { AppError } from "../../core/errors/appError.js";
import type { Pool } from "mysql2/promise";

// ── Magic byte signatures ─────────────────────────────────────────────────────

type MagicEntry = { mime: string; ext: string[]; bytes: number[]; offset?: number };

const MAGIC_SIGNATURES: MagicEntry[] = [
  { mime: "image/jpeg",      ext: ["jpg","jpeg"], bytes: [0xFF, 0xD8, 0xFF] },
  { mime: "image/png",       ext: ["png"],        bytes: [0x89, 0x50, 0x4E, 0x47] },
  { mime: "image/gif",       ext: ["gif"],        bytes: [0x47, 0x49, 0x46] },
  { mime: "image/webp",      ext: ["webp"],       bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 },
  { mime: "application/pdf", ext: ["pdf"],        bytes: [0x25, 0x50, 0x44, 0x46] },
  { mime: "application/zip", ext: ["zip","docx","xlsx","pptx"], bytes: [0x50, 0x4B, 0x03, 0x04] },
];

// Allowed MIME types for veterinary platform
const ALLOWED_MIMES = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp",
  "application/pdf",
  "application/zip",  // covers docx/xlsx
]);

// Max file size: 20 MB
const MAX_FILE_BYTES = 20 * 1024 * 1024;

// Per-tenant quota (configurable, default 5 GB)
const DEFAULT_TENANT_QUOTA_BYTES = 5 * 1024 * 1024 * 1024;

// ── Validation ────────────────────────────────────────────────────────────────

export type FileValidationResult = {
  mimeType: string;
  sha256: string;
  sizeBytes: number;
  extension: string;
};

/**
 * Validate an upload buffer. Throws VALIDATION_ERROR on any violation.
 */
export async function validateUpload(
  buffer: Buffer,
  originalName: string,
  tenantId: string,
  pool: Pool,
  opts: { quotaBytes?: number } = {}
): Promise<FileValidationResult> {
  // 1. Size check
  if (buffer.length > MAX_FILE_BYTES) {
    throw new AppError("VALIDATION_ERROR",
      `El archivo supera el tamaño máximo permitido (${MAX_FILE_BYTES / 1024 / 1024} MB).`);
  }

  // 2. Magic bytes detection (not Content-Type)
  const detectedMime = detectMimeFromMagic(buffer);
  if (!detectedMime || !ALLOWED_MIMES.has(detectedMime)) {
    throw new AppError("VALIDATION_ERROR",
      "Tipo de archivo no permitido. Se aceptan: imágenes (JPG, PNG, GIF, WebP), PDF y documentos Office.");
  }

  // 3. Extension consistency (defense-in-depth)
  const ext = originalName.split(".").pop()?.toLowerCase() ?? "";
  const entry = MAGIC_SIGNATURES.find(e => e.mime === detectedMime);
  if (entry && !entry.ext.includes(ext)) {
    throw new AppError("VALIDATION_ERROR",
      "La extensión del archivo no coincide con su contenido real.");
  }

  // 4. Tenant quota check
  const quotaBytes = opts.quotaBytes ?? DEFAULT_TENANT_QUOTA_BYTES;
  await checkTenantQuota(pool, tenantId, buffer.length, quotaBytes);

  // 5. SHA-256 fingerprint
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");

  return {
    mimeType:  detectedMime,
    sha256,
    sizeBytes: buffer.length,
    extension: ext,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function detectMimeFromMagic(buf: Buffer): string | null {
  for (const sig of MAGIC_SIGNATURES) {
    const offset = sig.offset ?? 0;
    if (buf.length < offset + sig.bytes.length) continue;
    const matches = sig.bytes.every((b, i) => buf[offset + i] === b);
    if (matches) return sig.mime;
  }
  return null;
}

async function checkTenantQuota(
  pool: Pool,
  tenantId: string,
  incomingBytes: number,
  quotaBytes: number
): Promise<void> {
  const [rows] = await pool.query<any[]>(
    `SELECT COALESCE(SUM(size_bytes), 0) AS used_bytes
     FROM files
     WHERE tenant_id=? AND status != 'deleted'`,
    [tenantId]
  );
  const usedBytes = Number(rows?.[0]?.used_bytes ?? 0);
  if (usedBytes + incomingBytes > quotaBytes) {
    const usedMB  = Math.round(usedBytes / 1024 / 1024);
    const quotaMB = Math.round(quotaBytes / 1024 / 1024);
    throw new AppError("VALIDATION_ERROR",
      `Cuota de almacenamiento excedida (${usedMB} MB / ${quotaMB} MB). Eliminá archivos o actualizá tu plan.`);
  }
}
