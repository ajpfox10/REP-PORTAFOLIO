// src/routes/documents.ocr.routes.ts
import { Router, Request, Response } from "express";
import { Sequelize } from "sequelize";
import fs from "fs";
import path from "path";
import { env } from "../config/env";
import { resolveSafeRealPath } from "../files/fileSecurity";
import { sniffFileMagic } from "../files/mimeSniffer";
import { extractTextFromImage } from "../services/ocr.service";
import { logger } from "../logging/logger";
import { trackAction } from "../logging/track";
import { requirePermission } from "../middlewares/rbacCrud";

export function buildDocumentsOcrRouter(sequelize: any) {
  const router = Router({ mergeParams: true });

  // POST /api/v1/documents/:id/ocr
  router.post(
    '/',
    requirePermission('documentos:ocr:create'),
    async (req: Request, res: Response) => {
      try {
        const documentoId = parseInt(req.params.id, 10);
        if (isNaN(documentoId)) {
          return res.status(400).json({ ok: false, error: 'ID de documento inválido' });
        }

        // 1. Obtener la última versión del documento
        const [rows] = await sequelize.query(
          `SELECT 
            dv.id, dv.documento_id, dv.version, dv.filename, 
            dv.nombre_original, dv.mime_type, dv.metadata,
            a.dni
           FROM documentos_versiones dv
           JOIN tblarchivos a ON a.id = dv.documento_id
           WHERE dv.documento_id = :id AND dv.deleted_at IS NULL
           ORDER BY dv.version DESC
           LIMIT 1`,
          { replacements: { id: documentoId } }
        );

        const version = (rows as any[])[0];
        if (!version) {
          return res.status(404).json({ ok: false, error: 'Documento no encontrado' });
        }

        // 2. Verificar que sea una imagen
        const mime = version.mime_type || '';
        if (!mime.startsWith('image/')) {
          return res.status(400).json({ 
            ok: false, 
            error: 'El documento no es una imagen. Solo imágenes soportan OCR.' 
          });
        }

        // 3. Buscar el archivo físico
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

        // 4. Ejecutar OCR
        const ocrText = await extractTextFromImage(filePath);

        // 5. Actualizar metadata con el texto extraído
        let metadata = version.metadata || {};
        if (typeof metadata === 'string') {
          try { metadata = JSON.parse(metadata); } catch { metadata = {}; }
        }

        metadata.ocr_text = ocrText;
        metadata.ocr_date = new Date().toISOString();
        metadata.ocr_confidence = null; // Podríamos agregar confianza si la devolvemos

        await sequelize.query(
          `UPDATE documentos_versiones 
           SET metadata = :metadata
           WHERE id = :id`,
          {
            replacements: {
              id: version.id,
              metadata: JSON.stringify(metadata)
            }
          }
        );

        // 6. Auditoría
        (res.locals as any).audit = {
          action: 'documentos_ocr',
          table_name: 'documentos_versiones',
          record_pk: version.id,
          entity_table: 'documentos_versiones',
          entity_pk: version.id,
          request_json: { documentoId },
          response_json: { status: 200, text_length: ocrText.length }
        };

        trackAction('documentos_ocr_ok', {
          actor: (req as any).auth?.principalId,
          documentoId,
          version: version.version,
          text_length: ocrText.length
        });

        return res.json({
          ok: true,
          data: {
            id: version.id,
            documento_id: documentoId,
            version: version.version,
            text: ocrText,
            text_length: ocrText.length,
            processed_at: new Date().toISOString()
          }
        });

      } catch (err: any) {
        logger.error({ msg: 'Error processing OCR', err });
        return res.status(500).json({ 
          ok: false, 
          error: err?.message || 'Error al procesar OCR' 
        });
      }
    }
  );

  // GET /api/v1/documents/:id/ocr - Obtener texto OCR (si existe)
  router.get(
    '/',
    requirePermission('documentos:ocr:read'),
    async (req: Request, res: Response) => {
      try {
        const documentoId = parseInt(req.params.id, 10);
        if (isNaN(documentoId)) {
          return res.status(400).json({ ok: false, error: 'ID de documento inválido' });
        }

        const [rows] = await sequelize.query(
          `SELECT metadata FROM documentos_versiones
           WHERE documento_id = :id AND deleted_at IS NULL
           ORDER BY version DESC LIMIT 1`,
          { replacements: { id: documentoId } }
        );

        const version = (rows as any[])[0];
        if (!version) {
          return res.status(404).json({ ok: false, error: 'Documento no encontrado' });
        }

        let metadata = version.metadata || {};
        if (typeof metadata === 'string') {
          try { metadata = JSON.parse(metadata); } catch { metadata = {}; }
        }

        const ocrText = metadata.ocr_text || null;

        return res.json({
          ok: true,
          data: {
            documento_id: documentoId,
            has_ocr: !!ocrText,
            text: ocrText,
            processed_at: metadata.ocr_date || null
          }
        });

      } catch (err: any) {
        logger.error({ msg: 'Error getting OCR text', err });
        return res.status(500).json({ ok: false, error: 'Error al obtener texto OCR' });
      }
    }
  );

  return router;
}