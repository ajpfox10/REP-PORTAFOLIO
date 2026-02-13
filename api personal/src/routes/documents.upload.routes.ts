// src/routes/documents.upload.routes.ts
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { Sequelize } from 'sequelize';
import { env } from '../config/env';
import { uploadMiddleware } from '../middlewares/upload';
import { scanFileOrThrow } from '../files/fileScanner';
import { sniffFileMagic } from '../files/mimeSniffer';
import { logger } from '../logging/logger';
import { trackAction } from '../logging/track';
import { cacheInvalidateTags } from '../infra/cache';
import { createVersion } from '../services/documentVersion.service';
import { emitDocumentoUploaded } from '../webhooks/emitters';

export function buildDocumentsUploadRouter(sequelize: Sequelize) {
  const router = Router();

  // ------------------------------------------------------------------------
  // POST /api/v1/documents/upload - Subir nuevo documento
  // ------------------------------------------------------------------------
  router.post('/upload', uploadMiddleware, async (req: any, res: any) => {
    try {
      if (!req.file) {
        return res.status(400).json({ ok: false, error: 'No se envió ningún archivo' });
      }

      const { dni, nombre, numero, tipo, descripcion } = req.body;
      
      const dniNum = Number(dni);
      if (!dni || Number.isNaN(dniNum)) {
        return res.status(400).json({ ok: false, error: 'DNI requerido y debe ser numérico' });
      }

      const [personalRows] = await sequelize.query(
        `SELECT dni FROM personal WHERE dni = :dni AND deleted_at IS NULL LIMIT 1`,
        { replacements: { dni: dniNum } }
      );
      
      if ((personalRows as any[]).length === 0) {
        return res.status(404).json({ ok: false, error: 'DNI no encontrado en personal' });
      }

      const filePath = req.file.path;
      const originalName = req.file.originalname;
      const mimeType = req.file.mimetype;

      await scanFileOrThrow(filePath);
      const sniff = sniffFileMagic(filePath);

      const year = new Date().getFullYear();
      const destDir = path.join(env.DOCUMENTS_BASE_DIR, String(year));
      
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      const ext = path.extname(originalName);
      const fileName = `${Date.now()}_${dni}${ext}`;
      const destPath = path.join(destDir, fileName);
      fs.renameSync(filePath, destPath);

      const actor = (req as any).auth?.principalId ?? null;
      const now = new Date();

      const [result] = await sequelize.query(
        `INSERT INTO tblarchivos 
         (dni, ruta, nombre, numero, tipo, tamanio, anio, fecha, descripcion_archivo, nombre_archivo_original, created_by, created_at)
         VALUES 
         (:dni, :ruta, :nombre, :numero, :tipo, :tamanio, :anio, :fecha, :descripcion, :originalName, :createdBy, :createdAt)`,
        {
          replacements: {
            dni: dniNum,
            ruta: String(year),
            nombre: nombre || originalName,
            numero: numero || null,
            tipo: tipo || sniff.kind || 'documento',
            tamanio: String(req.file.size),
            anio: year,
            fecha: now.toISOString().split('T')[0],
            descripcion: descripcion || null,
            originalName,
            createdBy: actor,
            createdAt: now
          }
        }
      );

      const insertId = (result as any)?.insertId;

      // ✅ Crear versión 1 del documento
      await createVersion(
        sequelize,
        insertId,
        destPath,
        originalName,
        actor,
        {
          anio: year,
          numero: numero || null,
          tipo: tipo || sniff.kind || 'documento',
          descripcion: descripcion || null
        }
      );

      // ✅ Invalidar cache
      try {
        await cacheInvalidateTags(['documents:list']);
        await cacheInvalidateTags([`documents:dni:${dniNum}`]);
        logger.info({ msg: 'Cache invalidated after upload', dni: dniNum, fileId: insertId });
      } catch (cacheErr) {
        logger.warn({ msg: 'Cache invalidation failed', err: cacheErr });
      }

      // ✅ Webhook
      await emitDocumentoUploaded(
        dniNum,
        {
          id: insertId,
          nombre: nombre || originalName,
          filename: originalName,
          version: 1,
          fileUrl: `/api/v1/documents/${insertId}/file`
        },
        { id: actor, type: 'user' }
      );

      (res.locals as any).audit = {
        action: 'documents_upload',
        table_name: 'tblarchivos',
        record_pk: insertId,
        entity_table: 'tblarchivos',
        entity_pk: insertId,
        request_json: { dni: dniNum, filename: originalName, size: req.file.size, mime: mimeType },
        response_json: { status: 201, id: insertId }
      };

      trackAction('documents_upload_ok', {
        dni: dniNum,
        fileId: insertId,
        filename: originalName
      });

      return res.status(201).json({
        ok: true,
        data: {
          id: insertId,
          dni: dniNum,
          nombre: nombre || originalName,
          filename: originalName,
          fileUrl: `/api/v1/documents/${insertId}/file`
        }
      });

    } catch (err: any) {
      if (req.file?.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      logger.error({ msg: 'Upload failed', err: err?.message || err });
      const status = err?.status || 500;
      const message = err?.message || 'Error al subir el archivo';
      return res.status(status).json({ ok: false, error: message });
    }
  });

  // ------------------------------------------------------------------------
  // POST /api/v1/documents/:id/versions - Subir nueva versión
  // ------------------------------------------------------------------------
  router.post('/:id/versions', uploadMiddleware, async (req: any, res: any) => {
    try {
      const documentoId = parseInt(req.params.id, 10);
      if (isNaN(documentoId)) {
        return res.status(400).json({ ok: false, error: 'ID de documento inválido' });
      }

      if (!req.file) {
        return res.status(400).json({ ok: false, error: 'No se envió ningún archivo' });
      }

      const [docRows] = await sequelize.query(
        `SELECT id, dni, nombre FROM tblarchivos WHERE id = :id AND deleted_at IS NULL LIMIT 1`,
        { replacements: { id: documentoId } }
      );

      const documento = (docRows as any[])[0];
      if (!documento) {
        return res.status(404).json({ ok: false, error: 'Documento no encontrado' });
      }

      const filePath = req.file.path;
      const originalName = req.file.originalname;

      await scanFileOrThrow(filePath);

      const actor = (req as any).auth?.principalId ?? null;
      const version = await createVersion(
        sequelize,
        documentoId,
        filePath,
        originalName,
        actor,
        { subida_por: 'nueva_version' }
      );

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      (res.locals as any).audit = {
        action: 'documento_version_create',
        table_name: 'documentos_versiones',
        record_pk: version.id,
        entity_table: 'documentos_versiones',
        entity_pk: version.id,
        request_json: { documentoId, filename: originalName },
        response_json: { status: 201, version: version.version }
      };

      trackAction('documentos_version_upload', {
        actor,
        documentoId,
        version: version.version,
        filename: originalName
      });

      return res.status(201).json({
        ok: true,
        data: {
          id: version.id,
          version: version.version,
          filename: version.nombre_original,
          tamanio: version.tamanio,
          mime_type: version.mime_type,
          created_at: version.created_at
        }
      });

    } catch (err: any) {
      if (req.file?.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      logger.error({ msg: 'Error creating document version', err });
      return res.status(500).json({ ok: false, error: 'Error al subir nueva versión' });
    }
  });

  return router;
}