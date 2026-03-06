/**
 * @file domains/personalv5/controllers/document.controller.ts
 * @description Controller de documentos: orquesta entre HTTP y el servicio.
 *
 * Responsabilidad UNICA: recibir la request HTTP, validar input,
 * llamar al DocumentService, y devolver la respuesta HTTP correcta.
 * NO contiene logica de negocio (eso es del service).
 */

import { Request, Response } from 'express';
import { z } from 'zod';
import fs from 'fs';
import { DocumentService } from '../services/document.service';
import { logger } from '../../../logging/logger';
import { trackAction } from '../../../logging/track';
import { documentsBlockedTotal } from '../../../metrics/domain';
import { FileSecurityError } from '../../../files/fileSecurity';
import { VirusFoundError } from '../../../files/fileScanner';

// ─── Schemas de validacion ────────────────────────────────────────────────────

const listSchema = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  q:     z.string().max(200).optional(),
  dni:   z.coerce.number().int().positive().optional(),
});

const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

// ─── Controller ───────────────────────────────────────────────────────────────

export class DocumentController {
  constructor(private readonly service: DocumentService) {}

  /** GET /api/v1/documents */
  list = async (req: Request, res: Response): Promise<void> => {
    const parsed = listSchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.flatten() });
      return;
    }
    try {
      const result = await this.service.list(parsed.data);
      res.json({ ok: true, ...result });
    } catch (err: any) {
      res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error' });
    }
  };

  /** GET /api/v1/documents/:id/file */
  getFile = async (req: Request, res: Response): Promise<void> => {
    const paramParsed = idParamSchema.safeParse(req.params);
    if (!paramParsed.success) {
      res.status(400).json({ ok: false, error: 'ID invalido' });
      return;
    }

    const { id } = paramParsed.data;

    try {
      const doc = await this.service.findById(id);
      if (!doc) {
        res.status(404).json({ ok: false, error: `Documento ID ${id} no encontrado.` });
        return;
      }

      const resolved = await this.service.resolveFile(doc);

      // Headers de seguridad y cache
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, max-age=0, no-store');
      res.setHeader('Content-Type', resolved.mime);
      res.setHeader('Content-Disposition', `inline; filename="${resolved.filename}"`);
      res.setHeader('Content-Length', String(resolved.stat.size));

      // Audit
      (res.locals as any).audit = {
        action: 'documents_download',
        table_name: 'tblarchivos',
        record_pk: id,
        request_json: { id, mime: resolved.mime, size: resolved.stat.size },
        response_json: { status: 200 },
      };

      trackAction('document_open_ok', { id, mime: resolved.mime });

      const stream = fs.createReadStream(resolved.fullPath);
      stream.on('error', () => {
        if (!res.headersSent) res.status(500).json({ ok: false, error: 'Error al leer el archivo' });
      });
      stream.pipe(res);

    } catch (err: any) {
      if (err instanceof VirusFoundError) {
        try { documentsBlockedTotal.labels('virus_detected').inc(1); } catch {}
        res.status(err.status ?? 423).json({ ok: false, error: err.message });
        return;
      }
      if (err instanceof FileSecurityError) {
        try { documentsBlockedTotal.labels(err.code || 'other').inc(1); } catch {}
        res.status(err.status || 400).json({ ok: false, error: err.message });
        return;
      }
      // Errores de negocio (legacy, not found)
      const status = err?.status || 500;
      const isUserError = status < 500;
      if (!isUserError) {
        logger.error({ msg: 'Error en getFile', id, err: err?.message, stack: err?.stack });
      }
      trackAction('gestion_document_open_error', { id, error: err?.message, code: err?.code });
      res.status(status).json({
        ok: false,
        error: err?.message || 'Error',
        code: err?.code,
        identifier: String(id),
      });
    }
  };

  /** DELETE /api/v1/documents/:id */
  delete = async (req: Request, res: Response): Promise<void> => {
    const paramParsed = idParamSchema.safeParse(req.params);
    if (!paramParsed.success) {
      res.status(400).json({ ok: false, error: 'ID invalido' });
      return;
    }
    try {
      const userId = (req as any).auth?.principalId ?? 0;
      await this.service.softDelete(paramParsed.data.id, userId);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Error' });
    }
  };
}
