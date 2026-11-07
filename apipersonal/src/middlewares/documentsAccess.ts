// src/middlewares/documentsAccess.ts
// Quién puede listar / descargar documentos escaneados (tblarchivos).
//
// Antes bastaba con estar logueado: cualquiera abría cualquier archivo cambiando el id.
// Ahora:
//   - admin (crud:*:*) o tblarchivos:read  → todo, como siempre.
//   - permiso de tareas livianas (Salud Laboral) → solo dictámenes de junta médica.
//   - jefe (app:jefe_servicio:access) → solo el dictamen vinculado a una tarea liviana
//     de un agente con pase abierto en SU servicio (usuarios.servicio_id).
//   - el resto → 403.

import { Request, Response, NextFunction } from 'express';
import { Sequelize, QueryTypes } from 'sequelize';
import { can } from './rbacCrud';
import { env } from '../config/env';
import { logger } from '../logging/logger';

function perms(req: Request): string[] {
  return ((req as any).auth?.permissions ?? []).map((p: string) => String(p).trim().toLowerCase());
}

function accesoTotal(p: string[]): boolean {
  return p.includes('crud:*:*') || p.includes('tblarchivos:read') || can(p, 'tblarchivos', 'read');
}

function deny(res: Response, motivo: string) {
  (res.locals as any).audit = { action: 'documents_denied', table_name: 'tblarchivos', request_json: { motivo } };
  return res.status(403).json({ ok: false, error: 'No tenés permiso para ver este documento.' });
}

/** POST /documents/upload y /documents/:id/versions: admin o tblarchivos:write (admin y reader, mig 111). */
export function requireDocumentsUpload() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!env.RBAC_ENABLE || !env.AUTH_ENABLE) return next();
    const p = perms(req);
    if (p.includes('crud:*:*') || p.includes('tblarchivos:write')) return next();
    (res.locals as any).audit = { action: 'documents_upload_denied', table_name: 'tblarchivos' };
    return res.status(403).json({ ok: false, error: 'No tenés permiso para subir documentos.' });
  };
}

/** GET /documents (listado): solo acceso total. */
export function requireDocumentsList() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!env.RBAC_ENABLE || !env.AUTH_ENABLE) return next();
    if (accesoTotal(perms(req))) return next();
    return deny(res, 'list_sin_permiso');
  };
}

/** GET /documents/:id/file: acceso total, o junta médica según rol. */
export function requireDocumentFile(sequelize: Sequelize) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!env.RBAC_ENABLE || !env.AUTH_ENABLE) return next();
    const p = perms(req);
    if (accesoTotal(p)) return next();

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, error: 'ID invalido' });

    try {
      // Salud Laboral (tareas livianas): dictámenes de junta (mismo criterio que /tareas-livianas/junta-medica)
      if (can(p, 'tareas_livianas', 'read')) {
        const [doc] = await sequelize.query<any>(
          `SELECT id FROM tblarchivos
            WHERE id = ? AND deleted_at IS NULL
              AND (tipo LIKE '%junta%' OR nombre LIKE '%junta%' OR tipo LIKE '%dictamen%'
                   OR id IN (SELECT junta_medica_doc_id FROM tareas_livianas WHERE activo = 1))`,
          { type: QueryTypes.SELECT, replacements: [id] },
        );
        if (doc) return next();
      }

      // Jefe: solo dictámenes de junta de agentes de su servicio que tienen tarea liviana
      // (el vinculado a la tarea, o una junta escaneada de ese mismo agente)
      const auth = (req as any).auth ?? {};
      if (p.includes('app:jefe_servicio:access') && auth.principalType === 'user' && auth.principalId) {
        const [ok] = await sequelize.query<any>(
          `SELECT t.id
             FROM tblarchivos a
             JOIN tareas_livianas t ON t.activo = 1 AND t.agente_dni = CAST(a.dni AS CHAR)
             JOIN usuarios u ON u.id = ? AND u.deleted_at IS NULL AND u.servicio_id IS NOT NULL
             JOIN servicios srv ON srv.id = u.servicio_id
            WHERE a.id = ? AND a.deleted_at IS NULL
              AND (t.junta_medica_doc_id = a.id
                   OR a.tipo LIKE '%junta%' OR a.nombre LIKE '%junta%' OR a.tipo LIKE '%dictamen%')
              AND t.agente_dni IN (
                SELECT CAST(ags.dni AS CHAR) FROM agentes_servicios ags
                 WHERE ags.fecha_hasta IS NULL AND ags.deleted_at IS NULL
                   AND (ags.servicio_id = srv.id
                        OR (ags.servicio_id IS NULL AND TRIM(ags.nombre) = TRIM(srv.nombre))))
            LIMIT 1`,
          { type: QueryTypes.SELECT, replacements: [auth.principalId, id] },
        );
        if (ok) return next();
      }

      return deny(res, 'file_sin_permiso');
    } catch (e: any) {
      logger.error({ msg: 'documentsAccess: error verificando acceso', id, error: e?.message });
      return res.status(500).json({ ok: false, error: 'Error verificando permisos' });
    }
  };
}
