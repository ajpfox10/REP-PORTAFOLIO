// src/routes/documents.routes.ts
import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { env } from "../config/env";
import { documentsBlockedTotal } from "../metrics/domain";
import { alertOnSpike } from "../alerts/thresholds";
import { resolveSafeRealPath, validateDownloadFile, FileSecurityError } from "../files/fileSecurity";
import { scanFileOrThrow, VirusFoundError } from "../files/fileScanner";
import { cacheMiddleware } from "../infra/cache";
import { buildDocumentsVersionsRouter } from './documents.versions.routes'; // ✅ AGREGADO

function safeFilename(name: string) {
  return String(name || "document")
    .replace(/[\\/]/g, "_")
    .replace(/[\r\n"]/g, "_")
    .trim() || "document";
}

export function buildDocumentsRouter(sequelize: any) {
  const router = Router();

  // GET /api/v1/documents?page=&limit=&q= - CON CACHE
  router.get(
    "/", 
    cacheMiddleware({
      ttl: 60,
      tags: (req) => ['documents:list'],
      condition: (req) => !req.query.noCache
    }),
    async (req: Request, res: Response) => {
      try {
        const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10) || 50));
        const q = String(req.query.q ?? "").trim();
        const offset = (page - 1) * limit;

        const whereQ = q
          ? `AND (
              nombre LIKE :q OR
              numero LIKE :q OR
              tipo LIKE :q OR
              descripcion_archivo LIKE :q
            )`
          : "";

        const rows = await sequelize.query(
          `
          SELECT
            id,
            nombre,
            numero,
            tipo,
            tamano,
            fecha,
            descripcion_archivo,
            created_at,
            created_by
          FROM tblarchivos
          WHERE deleted_at IS NULL
          ${whereQ}
          ORDER BY created_at DESC
          LIMIT :limit OFFSET :offset
          `,
          {
            replacements: { q: `%${q}%`, limit, offset },
            type: sequelize.QueryTypes.SELECT,
          }
        );

        const data = (rows as any[]).map((r) => ({
          id: r.id,
          nombre: r.nombre,
          numero: r.numero,
          tipo: r.tipo,
          tamano: r.tamano,
          fecha: r.fecha,
          descripcion: r.descripcion_archivo,
          created_at: r.created_at,
          created_by: r.created_by,
          fileUrl: `/api/v1/documents/${r.id}/file`,
        }));

        return res.json({ ok: true, data, page, limit });
      } catch (err: any) {
        const status = err?.status || 500;
        return res.status(status).json({ ok: false, error: err?.message || "Error" });
      }
    }
  );

  // GET /api/v1/documents/:id/file - NO CACHE
  router.get("/:id/file", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id || Number.isNaN(id)) return res.status(400).json({ ok: false, error: "Invalid id" });

      const rows = await sequelize.query(
        `
        SELECT id, ruta, nombre, nombre_archivo_original
        FROM tblarchivos
        WHERE id = :id AND deleted_at IS NULL
        LIMIT 1
        `,
        { replacements: { id }, type: sequelize.QueryTypes.SELECT }
      );

      const row = (rows as any[])[0];
      if (!row) return res.status(404).json({ ok: false, error: "Not found" });

      const fileOnDisk = String(row.nombre_archivo_original || "").trim();
      if (!fileOnDisk) {
        return res.status(500).json({ ok: false, error: "Missing nombre_archivo_original" });
      }

      const fullPath = resolveSafeRealPath(env.DOCUMENTS_BASE_DIR, fileOnDisk);
      const { stat, sniff } = validateDownloadFile(fullPath);
      await scanFileOrThrow(fullPath);

      const nameFromDb = safeFilename(String(row.nombre_archivo_original || row.nombre || `document-${id}`));
      const filename = nameFromDb.includes(".") ? nameFromDb : `${nameFromDb}.${sniff.ext || "bin"}`;

      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "private, max-age=0, no-store");
      res.setHeader("Content-Type", sniff.mime);
      res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
      res.setHeader("Content-Length", String(stat.size));

      (res.locals as any).audit = {
        action: "documents_download",
        table_name: "tblarchivos",
        record_pk: id,
        entity_table: "tblarchivos",
        entity_pk: id,
        request_json: { id, mime: sniff.mime, size: stat.size },
        response_json: { status: 200 },
      };

      const stream = fs.createReadStream(fullPath);
      stream.on("error", () => {
        if (!res.headersSent) res.status(500).json({ ok: false, error: "Stream error" });
      });
      return stream.pipe(res);
    } catch (err: any) {
      const status = err?.status || 500;
      
      if (err instanceof VirusFoundError) {
        try { documentsBlockedTotal.labels("virus_detected").inc(1); } catch {}
        return res.status(err.status ?? 423).json({ ok: false, error: err.message });
      }
      
      if (err instanceof FileSecurityError) {
        try { documentsBlockedTotal.labels(err.code || "other").inc(1); } catch {}
        return res.status(status).json({ ok: false, error: err?.message || "Error" });
      }

      return res.status(status).json({ ok: false, error: err?.message || "Error" });
    }
  });

  // ✅ SUBROUTER DE VERSIONES - AGREGADO AQUÍ
  router.use('/:id/versions', buildDocumentsVersionsRouter(sequelize));

  return router;
}