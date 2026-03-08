import { Router } from "express";
import { nanoid } from "nanoid";
import { AppError } from "../../core/errors/appError.js";
import { type AppConfig } from "../../config/types.js";
import { buildS3, presignPutObject } from "../../infra/storage/s3Client.js";
import { getCtx } from "../../core/http/requestCtx.js";

export function buildFilesRouter(config: AppConfig) {
  const router = Router();
  const s3 = buildS3(config);

  router.post("/presign", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      const { contentType, filename, purpose, fileSize, sha256 } = req.body ?? {};
      if (!contentType) throw new AppError("VALIDATION_ERROR", "contentType required");
      if (!fileSize || !Number.isFinite(Number(fileSize)) || Number(fileSize) <= 0) {
        throw new AppError("VALIDATION_ERROR", "fileSize required");
      }
      if (Number(fileSize) > config.filesMaxUploadBytes) {
        throw new AppError("VALIDATION_ERROR", `fileSize exceeds max allowed (${config.filesMaxUploadBytes} bytes)`);
      }
      const normalizedType = String(contentType).toLowerCase().trim();
      if (!config.filesAllowedMimeTypes.includes(normalizedType)) {
        throw new AppError("VALIDATION_ERROR", `contentType not allowed: ${normalizedType}`);
      }
      const normalizedPurpose = String(purpose ?? "general").toLowerCase().trim();
      if (!config.filesAllowedPurposes.includes(normalizedPurpose)) {
        throw new AppError("VALIDATION_ERROR", `purpose not allowed: ${normalizedPurpose}`);
      }
      if (config.filesRequireSha256 && !/^[a-f0-9]{64}$/i.test(String(sha256 ?? ""))) {
        throw new AppError("VALIDATION_ERROR", "sha256 required and must be a hex digest");
      }

      const id = nanoid(18);
      const safeName = String(filename ?? "file").replace(/[^a-z0-9._-]/gi, "_");
      const key = `${ctx.tenantId}/${normalizedPurpose}/${id}_${safeName}`;
      const uploadUrl = await presignPutObject({
        s3,
        bucket: config.s3Bucket,
        key,
        contentType: normalizedType,
        expiresInSeconds: 60
      });

      await ctx.tenantPool.query(
        `INSERT INTO files (tenant_id, id, s3_key, content_type, original_name, purpose, created_by, size_bytes, sha256, status) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [ctx.tenantId, id, key, normalizedType, safeName, normalizedPurpose, ctx.userId ?? null, Number(fileSize), String(sha256 ?? ""), "pending_upload"]
      );

      res.json({
        data: {
          id,
          key,
          uploadUrl,
          requiredHeaders: {
            "Content-Type": normalizedType,
          },
          constraints: {
            maxBytes: config.filesMaxUploadBytes,
            sha256Required: config.filesRequireSha256,
          }
        },
        meta: { requestId: (req as any).id },
        errors: []
      });
    } catch (e) { next(e); }
  });

  router.get("/", async (req, res, next) => {
    try {
      const ctx = getCtx(req);
      const [rows] = await ctx.tenantPool.query<any[]>(
        `SELECT id, s3_key, content_type, original_name, purpose, size_bytes, sha256, status, created_at FROM files WHERE tenant_id=? ORDER BY created_at DESC LIMIT 200`,
        [ctx.tenantId]
      );
      res.json({ data: rows, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  return router;
}
