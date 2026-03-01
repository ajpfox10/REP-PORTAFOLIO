/**
 * @file routes/documents.routes.ts
 * @description Rutas de documentos - usa DocumentService para logica de negocio.
 * Las rutas /api/v1/documents/* pasan por aqui y delegan en el servicio.
 * 
 * FIX: la resolucion de rutas esta en DocumentService.resolveFile()
 * que maneja correctamente rutas Windows absolutas tipo "D:\G\RESOLUCIONES Y VARIOS\...".
 */

import { Router } from 'express';
import { cacheMiddleware } from '../infra/cache';
import { DocumentService } from '../domains/personalv5/services/document.service';
import { DocumentController } from '../domains/personalv5/controllers/document.controller';
import { buildDocumentsVersionsRouter } from './documents.versions.routes';
import { buildDocumentsPreviewRouter } from './documents.preview.routes';
import { buildDocumentsOcrRouter } from './documents.ocr.routes';

export function buildDocumentsRouter(sequelize: any) {
  const router = Router();

  const service = new DocumentService(sequelize);
  const ctrl = new DocumentController(service);

  // GET /api/v1/documents?page=&limit=&q=&dni=
  router.get(
    '/',
    cacheMiddleware({
      ttl: 60,
      tags: (req: any) => {
        // Tag especifico por DNI si se filtra, o tag general de lista
        const tags = ['documents:list'];
        if (req.query.dni) tags.push(`documents:dni:${req.query.dni}`);
        return tags;
      },
      condition: (req: any) => !req.query.noCache,
    }),
    ctrl.list
  );

  // Sub-routers de OCR y preview (antes del /:id/file para no colisionar)
  router.use('/:id/ocr',     buildDocumentsOcrRouter(sequelize));
  router.use('/:id/preview', buildDocumentsPreviewRouter(sequelize));

  // GET /api/v1/documents/:id/file  ← ESTE ES EL FIX PRINCIPAL
  // Ahora usa DocumentService.resolveFile() que maneja todas las variantes de ruta
  router.get('/:id/file', ctrl.getFile);

  // DELETE /api/v1/documents/:id
  router.delete('/:id', ctrl.delete);

  // Sub-router de versiones
  router.use('/:id/versions', buildDocumentsVersionsRouter(sequelize));

  return router;
}
