import { Router } from "express";
import { nanoid } from "nanoid";
import { AppError } from "../../core/errors/appError.js";
import { type AppConfig } from "../../config/types.js";
import { buildS3, presignPutObject } from "../../infra/storage/s3Client.js";

/**
 * Files module
 * - Stores metadata in tenant DB
 * - Uploads to S3 using presigned URLs
 */
export function buildFilesRouter(config: AppConfig) {
  const router = Router();
  const s3 = buildS3(config);

  // Ensure metadata table exists (created during provisioning). This router assumes it exists.

  /**
   * POST /api/v1/files/presign
   * Body: { contentType, filename?, purpose? }
   */
  router.post("/presign", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      const { contentType, filename, purpose } = req.body ?? {};
      if (!contentType) throw new AppError("VALIDATION_ERROR", "contentType required");

      const id = nanoid(18);
      const safeName = String(filename ?? "file").replace(/[^a-z0-9._-]/gi, "_");
      const key = `${ctx.tenantId}/${purpose ?? "general"}/${id}_${safeName}`;

      const uploadUrl = await presignPutObject({
        s3,
        bucket: config.s3Bucket,
        key,
        contentType: String(contentType),
        expiresInSeconds: 120
      });

      await ctx.tenantPool.query(
        `INSERT INTO files (tenant_id, id, s3_key, content_type, original_name, purpose, created_by) VALUES (?,?,?,?,?,?,?)`,
        [ctx.tenantId, id, key, String(contentType), safeName, String(purpose ?? "general"), ctx.userId ?? null]
      );

      res.json({
        data: { id, key, uploadUrl },
        meta: { requestId: (req as any).id },
        errors: []
      });
    } catch (e) { next(e); }
  });

  /**
   * GET /api/v1/files
   */
  router.get("/", async (req, res, next) => {
    try {
      const ctx = (req as any).ctx;
      const [rows] = await ctx.tenantPool.query<any[]>(
        `SELECT id, s3_key, content_type, original_name, purpose, created_at FROM files WHERE tenant_id=? ORDER BY created_at DESC LIMIT 200`,
        [ctx.tenantId]
      );
      res.json({ data: rows, meta: { requestId: (req as any).id }, errors: [] });
    } catch (e) { next(e); }
  });

  return router;
}
