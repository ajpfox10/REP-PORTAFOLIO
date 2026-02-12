import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { env } from "../config/env";
import { documentsBlockedTotal } from "../metrics/domain";
import { alertOnSpike } from "../alerts/thresholds";
import { resolveSafeRealPath, validateDownloadFile, FileSecurityError } from "../files/fileSecurity";
import { scanFileOrThrow, VirusFoundError } from "../files/fileScanner";

/**
 * Sanitiza nombre para Content-Disposition (evita path o comillas raras).
 */
function safeFilename(name: string) {
  return String(name || "document")
    .replace(/[\\/]/g, "_")
    .replace(/[\r\n"]/g, "_")
    .trim() || "document";
}

export function buildDocumentsRouter(sequelize: any) {
  const router = Router();

  // GET /api/v1/documents?page=&limit=&q=
  router.get("/", async (req: Request, res: Response) => {
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
  });

  // GET /api/v1/documents/:id/file
  router.get("/:id/file", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id || Number.isNaN(id)) return res.status(400).json({ ok: false, error: "Invalid id" });

      const rows = await sequelize.query(
        `
        SELECT id, ruta, nombre, nombre_archivo_original
        -- ✅ CAMBIO: agregamos nombre_archivo_original porque es el filename real en disco
        FROM tblarchivos
        WHERE id = :id AND deleted_at IS NULL
        LIMIT 1
        `,
        { replacements: { id }, type: sequelize.QueryTypes.SELECT }
      );

      const row = (rows as any[])[0];
      if (!row) return res.status(404).json({ ok: false, error: "Not found" });

      // ✅ CAMBIO: el archivo físico se abre con nombre_archivo_original (no con ruta)
      // ⛔ ANTES era:
      // const fullPath = resolveSafeRealPath(env.DOCUMENTS_BASE_DIR, String(row.ruta || ""));
      // Eso fallaba porque row.ruta era una carpeta/UNC (o no era el archivo).
      const fileOnDisk = String(row.nombre_archivo_original || "").trim();
      if (!fileOnDisk) {
        return res.status(500).json({ ok: false, error: "Missing nombre_archivo_original" });
      }

      // ✅ path seguro + anti-symlink escape
      // DOCUMENTS_BASE_DIR debe ser algo como: D:\G\RESOLUCIONES Y VARIOS
      const fullPath = resolveSafeRealPath(env.DOCUMENTS_BASE_DIR, fileOnDisk);

      // ✅ validar tamaño + MIME por magic bytes
      const { stat, sniff } = validateDownloadFile(fullPath);
      await scanFileOrThrow(fullPath);

      // ✅ CAMBIO (opcional pero recomendado):
      // Para el nombre que ve el usuario, usamos el filename real (y si no, el "nombre" lógico).
      // Evita que "nombre" (tipo "Resolución 123") genere un PDF con nombre raro.
      const nameFromDb = safeFilename(String(row.nombre_archivo_original || row.nombre || `document-${id}`));
      const filename = nameFromDb.includes(".") ? nameFromDb : `${nameFromDb}.${sniff.ext || "bin"}`;

      // Headers seguros
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "private, max-age=0, no-store");
      res.setHeader("Content-Type", sniff.mime);
      res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
      res.setHeader("Content-Length", String(stat.size));

      // ✅ Auditoría (para auditAllApi)
      // No metemos el path real en auditoría (info sensible)
      (res.locals as any).audit = {
        action: "documents_download",
        table_name: "tblarchivos",
        record_pk: id,
        entity_table: "tblarchivos",
        entity_pk: id,
        request_json: {
          id,
          mime: sniff.mime,
          size: stat.size,
        },
        response_json: { status: 200 },
      };

      // Streaming seguro
      const stream = fs.createReadStream(fullPath);
      stream.on("error", () => {
        if (!res.headersSent) res.status(500).json({ ok: false, error: "Stream error" });
      });
      return stream.pipe(res);
    } catch (err: any) {
      const status = err?.status || 500;

      // 🚨 Virus detectado (scanner)
      if (err instanceof VirusFoundError) {
        try { documentsBlockedTotal.labels("virus_detected").inc(1); } catch {}
        try { alertOnSpike("documents_blocked", 10, 60_000, "Spike documentos bloqueados", { reason: "virus_detected" }); } catch {}

        (res.locals as any).audit = {
          action: "documents_blocked",
          table_name: "tblarchivos",
          record_pk: parseInt(req.params.id || "0", 10) || null,
          entity_table: "tblarchivos",
          entity_pk: parseInt(req.params.id || "0", 10) || null,
          request_json: {
            reason: "virus_detected",
            signature: (err as any).signature ?? null,
            message: err.message,
          },
          response_json: { status: err.status ?? 423 },
        };

        return res.status(err.status ?? 423).json({ ok: false, error: err.message });
      }

      // Auditoría de bloqueo
      if (err instanceof FileSecurityError) {
        try { documentsBlockedTotal.labels(err.code || "other").inc(1); } catch {}
        try { alertOnSpike("documents_blocked", 10, 60_000, "Spike documentos bloqueados", { reason: err.code || "other" }); } catch {}

        (res.locals as any).audit = {
          action: "documents_blocked",
          table_name: "tblarchivos",
          record_pk: parseInt(req.params.id || "0", 10) || null,
          entity_table: "tblarchivos",
          entity_pk: parseInt(req.params.id || "0", 10) || null,
          request_json: {
            reason: err.code,
            message: err.message,
          },
          response_json: { status },
        };
      }

      return res.status(status).json({ ok: false, error: err?.message || "Error" });
    }
  });

  return router;
}
