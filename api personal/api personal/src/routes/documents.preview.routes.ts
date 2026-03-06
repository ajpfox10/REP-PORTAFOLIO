// src/routes/documents.preview.routes.ts
import { Router, Request, Response } from "express";
import { Sequelize } from "sequelize";
import fs from "fs";
import path from "path";
import { env } from "../config/env";
import { resolveSafeRealPath } from "../files/fileSecurity";
import { sniffFileMagic } from "../files/mimeSniffer";
import { logger } from "../logging/logger";
import { requirePermission } from "../middlewares/rbacCrud";

export function buildDocumentsPreviewRouter(sequelize: any) {
  const router = Router({ mergeParams: true });

  // GET /api/v1/documents/:id/preview
  router.get(
    '/',
    requirePermission('documentos:preview:read'),
    async (req: Request, res: Response) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
          return res.status(400).json({ ok: false, error: 'ID inválido' });
        }

        // 1. Obtener metadata del documento
        const [rows] = await sequelize.query(
          `SELECT id, nombre, nombre_archivo_original, mime_type 
           FROM documentos_versiones 
           WHERE documento_id = :id AND deleted_at IS NULL 
           ORDER BY version DESC LIMIT 1`,
          { replacements: { id } }
        );

        const version = (rows as any[])[0];
        if (!version) {
          return res.status(404).json({ ok: false, error: 'Documento no encontrado' });
        }

        // 2. Buscar el archivo físico
        const years = [new Date().getFullYear(), new Date().getFullYear() - 1];
        let filePath: string | null = null;

        for (const year of years) {
          const candidate = path.join(
            env.DOCUMENTS_BASE_DIR,
            'versiones',
            String(year),
            version.filename
          );
          if (fs.existsSync(candidate)) {
            filePath = candidate;
            break;
          }
        }

        if (!filePath) {
          return res.status(404).json({ ok: false, error: 'Archivo no encontrado en disco' });
        }

        // 3. Detectar MIME real
        const sniff = sniffFileMagic(filePath);
        const mime = sniff.mime || 'application/octet-stream';
        const filename = version.nombre || `documento-${id}`;

        // 4. Generar HTML con visor embebido
        let viewerHtml = '';

        if (mime.includes('pdf')) {
          // Visor PDF.js embebido
          viewerHtml = `
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8">
              <title>${filename}</title>
              <style>
                body, html { margin: 0; padding: 0; height: 100%; overflow: hidden; }
                #viewer { width: 100%; height: 100%; border: none; }
              </style>
            </head>
            <body>
              <iframe id="viewer" src="/api/v1/documents/${id}/file"></iframe>
            </body>
            </html>
          `;
        } else if (mime.includes('image/')) {
          // Visor de imágenes
          viewerHtml = `
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8">
              <title>${filename}</title>
              <style>
                body, html { margin: 0; padding: 0; height: 100%; display: flex; justify-content: center; align-items: center; background: #222; }
                img { max-width: 100%; max-height: 100%; object-fit: contain; box-shadow: 0 0 20px rgba(0,0,0,0.5); }
              </style>
            </head>
            <body>
              <img src="/api/v1/documents/${id}/file" alt="${filename}" />
            </body>
            </html>
          `;
        } else if (mime.includes('officedocument.wordprocessingml') || filename.endsWith('.docx')) {
          // DOCX -> Usar Mammoth.js + iframe
          viewerHtml = `
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8">
              <title>${filename}</title>
              <script src="https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.4.2/mammoth.browser.min.js"></script>
              <style>
                body { font-family: sans-serif; padding: 20px; line-height: 1.6; max-width: 800px; margin: 0 auto; }
                #content { white-space: pre-wrap; word-wrap: break-word; }
              </style>
            </head>
            <body>
              <div id="content">Cargando documento...</div>
              <script>
                fetch('/api/v1/documents/${id}/file')
                  .then(res => res.arrayBuffer())
                  .then(buffer => mammoth.convertToHtml({ arrayBuffer: buffer }))
                  .then(result => {
                    document.getElementById('content').innerHTML = result.value;
                  })
                  .catch(err => {
                    document.getElementById('content').innerHTML = 'Error al cargar el documento: ' + err.message;
                  });
              </script>
            </body>
            </html>
          `;
        } else {
          // Fallback: descarga directa
          return res.redirect(`/api/v1/documents/${id}/file`);
        }

        // 5. Enviar HTML
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'private, max-age=3600');
        return res.send(viewerHtml);

      } catch (err: any) {
        logger.error({ msg: 'Error generating preview', err });
        return res.status(500).json({ ok: false, error: 'Error al generar vista previa' });
      }
    }
  );

  return router;
}