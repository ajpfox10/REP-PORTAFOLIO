// src/routes/documents.versions.routes.ts
import { Router, Request, Response } from "express";
import { Sequelize } from "sequelize";
import fs from "fs";
import { requirePermission } from "../middlewares/rbacCrud";
import { logger } from "../logging/logger";
import { trackAction } from "../logging/track";
import { getVersions, getVersionFile } from "../services/documentVersion.service";

export function buildDocumentsVersionsRouter(sequelize: Sequelize) {
  const router = Router({ mergeParams: true });

  // ------------------------------------------------------------------------
  // GET /api/v1/documents/:id/versions - Listar versiones
  // ------------------------------------------------------------------------
  router.get(
    '/',
    requirePermission('documentos:versiones:read'),
    async (req: Request, res: Response) => {
      try {
        const documentoId = parseInt(req.params.id, 10);
        if (isNaN(documentoId)) {
          return res.status(400).json({ ok: false, error: 'ID de documento inválido' });
        }

        // Verificar que el documento existe
        const [docRows] = await sequelize.query(
          `SELECT id FROM tblarchivos WHERE id = :id AND deleted_at IS NULL LIMIT 1`,
          { replacements: { id: documentoId } }
        );

        if (!(docRows as any[]).length) {
          return res.status(404).json({ ok: false, error: 'Documento no encontrado' });
        }

        const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
        const limit = Math.min(50, parseInt(req.query.limit as string, 10) || 20);
        const offset = (page - 1) * limit;

        const { versions, total } = await getVersions(sequelize, documentoId, limit, offset);

        trackAction('documentos_versiones_list', {
          actor: (req as any).auth?.principalId,
          documentoId,
          count: versions.length
        });

        return res.json({
          ok: true,
          data: versions,
          meta: { page, limit, total }
        });

      } catch (err: any) {
        logger.error({ msg: 'Error listing document versions', err });
        return res.status(500).json({ ok: false, error: 'Error al obtener versiones' });
      }
    }
  );

  // ------------------------------------------------------------------------
  // GET /api/v1/documents/:id/versions/:version/file - Descargar versión
  // ------------------------------------------------------------------------
  router.get(
    '/:version/file',
    requirePermission('documentos:versiones:download'),
    async (req: Request, res: Response) => {
      try {
        const documentoId = parseInt(req.params.id, 10);
        const version = parseInt(req.params.version, 10);

        if (isNaN(documentoId) || isNaN(version)) {
          return res.status(400).json({ ok: false, error: 'Parámetros inválidos' });
        }

        const { filePath, versionInfo } = await getVersionFile(
          sequelize,
          documentoId,
          version
        );

        const filename = versionInfo.nombre_original || `documento_v${version}.bin`;

        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'private, max-age=3600');
        res.setHeader('Content-Type', versionInfo.mime_type);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', String(versionInfo.tamanio));
        res.setHeader('X-Document-Version', String(version));

        // Auditoría
        (res.locals as any).audit = {
          action: 'documento_version_download',
          table_name: 'documentos_versiones',
          record_pk: versionInfo.id,
          entity_table: 'documentos_versiones',
          entity_pk: versionInfo.id,
          request_json: { documentoId, version },
          response_json: { status: 200 }
        };

        trackAction('documentos_version_download', {
          actor: (req as any).auth?.principalId,
          documentoId,
          version,
          size: versionInfo.tamanio
        });

        const stream = fs.createReadStream(filePath);
        stream.on('error', () => {
          if (!res.headersSent) {
            res.status(500).json({ ok: false, error: 'Error al leer el archivo' });
          }
        });

        return stream.pipe(res);

      } catch (err: any) {
        if (err.message === 'Version not found') {
          return res.status(404).json({ ok: false, error: 'Versión no encontrada' });
        }
        if (err.message === 'Version file not found on disk') {
          return res.status(404).json({ ok: false, error: 'Archivo de versión no encontrado' });
        }
        logger.error({ msg: 'Error downloading version', err });
        return res.status(500).json({ ok: false, error: 'Error al descargar versión' });
      }
    }
  );

  return router;
}