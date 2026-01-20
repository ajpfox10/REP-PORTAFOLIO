import { Router, Request, Response } from "express";
import path from "path";
import fs from "fs";
import { env } from "../config/env";

/**
 * Resuelve un path de DB dentro de DOCUMENTS_BASE_DIR de forma segura.
 * Bloquea path traversal (.., etc).
 */
function resolveSafe(baseDir: string, dbPath: string) {
  const base = path.resolve(baseDir);
  const full = path.resolve(base, dbPath || "");

  const baseWithSep = base.endsWith(path.sep) ? base : base + path.sep;
  if (full !== base && !full.startsWith(baseWithSep)) {
    const err: any = new Error("Forbidden path");
    err.status = 403;
    throw err;
  }

  return full;
}

export function buildDocumentsRouter(sequelize: any) {
  const router = Router();

  // GET /api/v1/documents?page=&limit=&q=
  router.get("/", async (req: Request, res: Response) => {
    try {
      const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
      const limit = Math.min(
        100,
        Math.max(1, parseInt(String(req.query.limit ?? "50"), 10) || 50)
      );
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
          tamanio,
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
          replacements: {
            q: `%${q}%`,
            limit,
            offset,
          },
          type: sequelize.QueryTypes.SELECT,
        }
      );

      const data = (rows as any[]).map((r) => ({
        id: r.id,
        nombre: r.nombre,
        numero: r.numero,
        tipo: r.tipo,
        tamanio: r.tamano,
        fecha: r.fecha,
        descripcion: r.descripcion_archivo,
        created_at: r.created_at,
        created_by: r.created_by,
        fileUrl: `/api/v1/documents/${r.id}/file`,
      }));

      return res.json({ ok: true, data, page, limit });
    } catch (err: any) {
      const status = err?.status || 500;
      return res.status(status).json({
        ok: false,
        error: err?.message || "Error",
      });
    }
  });

  // GET /api/v1/documents/:id/file
  router.get("/:id/file", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id || Number.isNaN(id)) {
        return res.status(400).json({ ok: false, error: "Invalid id" });
      }

      const rows = await sequelize.query(
        `
        SELECT id, ruta, nombre
        FROM tblarchivos
        WHERE id = :id AND deleted_at IS NULL
        LIMIT 1
        `,
        {
          replacements: { id },
          type: sequelize.QueryTypes.SELECT,
        }
      );

      const row = (rows as any[])[0];
      if (!row) return res.status(404).json({ ok: false, error: "Not found" });

      const fullPath = resolveSafe(env.DOCUMENTS_BASE_DIR, String(row.ruta || ""));

      if (!fs.existsSync(fullPath)) {
        return res.status(404).json({ ok: false, error: "File not found" });
      }

      const safeName = String(row.nombre || `document-${id}.pdf`).replace(/[\\/]/g, "_");
      res.setHeader("Content-Disposition", `inline; filename="${safeName}"`);

      return res.sendFile(fullPath);
    } catch (err: any) {
      const status = err?.status || 500;
      return res.status(status).json({
        ok: false,
        error: err?.message || "Error",
      });
    }
  });

  return router;
}

