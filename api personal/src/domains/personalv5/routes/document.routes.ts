/**
 * @file domains/personalv5/routes/document.routes.ts
 * Rutas de documentos del dominio. Patron: Route -> Controller -> Service -> DB
 */
import { Router } from 'express';
import type { Sequelize } from 'sequelize';
import { DocumentController } from '../controllers/document.controller';
import { DocumentService } from '../services/document.service';
import { cacheMiddleware } from '../../../infra/cache';
import { requirePermission } from '../../../middlewares/rbacCrud';
import { buildDocumentsVersionsRouter } from '../../../routes/documents.versions.routes';
import { buildDocumentsPreviewRouter } from '../../../routes/documents.preview.routes';
import { buildDocumentsOcrRouter } from '../../../routes/documents.ocr.routes';

export function buildDocumentRoutes(sequelize: Sequelize): Router {
  const router = Router();
  const ctrl = new DocumentController(new DocumentService(sequelize));

  router.get(
    '/',
    cacheMiddleware({ ttl: 60, tags: () => ['documents:list'], condition: (r: any) => !r.query.noCache }),
    ctrl.list
  );

  router.get('/:id/file', ctrl.getFile);
  router.delete('/:id',   requirePermission('documents:write'), ctrl.delete);

  router.use('/:id/ocr',      buildDocumentsOcrRouter(sequelize));
  router.use('/:id/preview',  buildDocumentsPreviewRouter(sequelize));
  router.use('/:id/versions', buildDocumentsVersionsRouter(sequelize));

  return router;
}
