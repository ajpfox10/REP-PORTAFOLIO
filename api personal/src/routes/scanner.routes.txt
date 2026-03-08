/**
 * @file routes/scanner.routes.ts
 * @description Endpoint que recibe notificaciones del Scanner API v3
 * cuando un documento fue escaneado y procesado.
 *
 * El scanner notifica vía POST /api/v1/scanner/document-ready
 * con la información del documento escaneado, vinculado a un DNI.
 *
 * Este endpoint guarda la referencia en la tabla tblarchivos
 * para que el documento aparezca en el legajo del agente.
 */

import { Router, Request, Response } from 'express';
import { Sequelize } from 'sequelize';
import { logger } from '../logging/logger';

export function buildScannerRouter(sequelize: Sequelize): Router {
  const router = Router();

  /**
   * POST /api/v1/scanner/document-ready
   * Recibido desde el Scanner API cuando un documento está listo.
   * Auth: x-api-key (API key del scanner tenant)
   */
  router.post('/document-ready', async (req: Request, res: Response) => {
    try {
      const {
        scanner_document_id,
        scanner_job_id,
        personal_dni,
        personal_ref,
        doc_class,
        page_count,
        storage_key,
        ocr_summary,
      } = req.body || {};

      if (!personal_dni || !scanner_document_id) {
        return res.status(400).json({ ok: false, error: 'missing_fields' });
      }

      // Verificar que el agente existe en nuestra DB
      const [agentes] = await sequelize.query(
        'SELECT id FROM personal WHERE dni = :dni LIMIT 1',
        { replacements: { dni: Number(personal_dni) } }
      );

      if (!(agentes as any[]).length) {
        // Agente no encontrado — guardamos igual para trazabilidad
        logger.warn({ msg: 'scanner document for unknown DNI', personal_dni, scanner_document_id });
      }

      // Guardar referencia en tblarchivos (tabla de documentos del personal)
      // La descripcion_archivo incluye el tipo y resumen OCR para búsquedas
      const descripcion = [
        doc_class ? `Tipo: ${doc_class}` : null,
        page_count ? `Páginas: ${page_count}` : null,
        personal_ref ? `Ref: ${personal_ref}` : null,
        ocr_summary ? `Extracto: ${ocr_summary.slice(0, 200)}` : null,
      ].filter(Boolean).join(' | ');

      await sequelize.query(
        `INSERT INTO tblarchivos
           (dni, nombre, tipo, descripcion_archivo, ruta, created_at)
         VALUES
           (:dni, :nombre, :tipo, :descripcion, :ruta, NOW())
         ON DUPLICATE KEY UPDATE
           descripcion_archivo = VALUES(descripcion_archivo),
           updated_at = NOW()`,
        {
          replacements: {
            dni:         Number(personal_dni),
            nombre:      `Scanner-${scanner_document_id}`,
            tipo:        doc_class || 'documento_escaneado',
            descripcion: descripcion || 'Documento escaneado',
            ruta:        `scanner://${storage_key}`,
          },
        }
      ).catch((e: any) => {
        // Si la tabla no tiene updated_at o alguna columna difiere, logueamos y seguimos
        logger.warn({ msg: 'scanner insert warning', error: e?.message });
      });

      logger.info({
        msg:                 'scanner document registered',
        personal_dni,
        scanner_document_id,
        scanner_job_id,
        doc_class,
      });

      return res.json({ ok: true });
    } catch (e: any) {
      logger.error({ msg: 'scanner route error', error: e?.message });
      return res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });

  /**
   * GET /api/v1/scanner/documents/:dni
   * Retorna los documentos escaneados de un agente por DNI.
   */
  router.get('/documents/:dni', async (req: Request, res: Response) => {
    try {
      const dni = Number(req.params.dni);
      if (!dni) return res.status(400).json({ error: 'invalid_dni' });

      const [rows] = await sequelize.query(
        `SELECT id, nombre, tipo, descripcion_archivo, ruta, created_at
         FROM tblarchivos
         WHERE dni = :dni AND tipo LIKE 'scanner%' OR ruta LIKE 'scanner://%'
         ORDER BY created_at DESC
         LIMIT 100`,
        { replacements: { dni } }
      ).catch(() => [[]] as any);

      return res.json({ data: rows });
    } catch (e: any) {
      return res.status(500).json({ error: 'internal_error' });
    }
  });

  return router;
}
