/**
 * @file domains/personalv5/routes/documents.routes.ts
 *
 * Rutas de documentos. Solo define rutas → llama controllers.
 * Sin lógica de negocio acá.
 */

import { Router } from 'express';
import { uploadMiddleware }    from '../../../middlewares/upload';
import { cacheMiddleware }     from '../../../infra/cache';
import { buildDocumentsVersionsRouter }  from '../../../routes/documents.versions.routes';
import { buildDocumentsPreviewRouter }   from '../../../routes/documents.preview.routes';
import { buildDocumentsOcrRouter }       from '../../../routes/documents.ocr.routes';
import {
  listDocuments, downloadFile, uploadDocument, listOrphans,
} from '../controllers/documents.controller';

export function buildDocumentsRouterV2(sequelize: any): Router {
  const router = Router();

  // Inyecto sequelize en req para que los controllers puedan usarlo
  router.use((req: any, _res, next) => {
    req.sequelize = sequelize;
    next();
  });

  // GET /documents — lista paginada
  router.get('/', cacheMiddleware({ ttl: 60, tags: () => ['documents:list'] }), listDocuments);

  // GET /documents/orphans — registros sin archivo físico (admin)
  router.get('/orphans', listOrphans);

  // Subir nuevo documento
  router.post('/upload', uploadMiddleware, uploadDocument);

  // Sub-routers de OCR, preview y versiones (mantengo los existentes)
  router.use('/:id/ocr',     buildDocumentsOcrRouter(sequelize));
  router.use('/:id/preview', buildDocumentsPreviewRouter(sequelize));
  router.use('/:id/versions', buildDocumentsVersionsRouter(sequelize));

  // GET /documents/:id/file — descargar archivo
  router.get('/:id/file', downloadFile);

  return router;
}
