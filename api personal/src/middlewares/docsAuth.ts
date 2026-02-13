// src/middlewares/docsAuth.ts
import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';

/**
 * Middleware de autorización para documentación OpenAPI.
 * 
 * - En producción: requiere permiso 'docs:read' O 'crud:*:*'
 * - En desarrollo: abierto por defecto (si DOCS_PROTECT=false)
 */
export function docsAuth(req: Request, res: Response, next: NextFunction) {
  // Si la documentación está deshabilitada, 404
  if (!env.DOCS_ENABLE) {
    return res.status(404).json({ ok: false, error: 'Docs disabled' });
  }

  // En desarrollo, podemos dejarlo abierto
  if (env.NODE_ENV !== 'production' && !env.DOCS_PROTECT) {
    return next();
  }

  // Verificar autenticación
  const auth = (req as any).auth;
  if (!auth) {
    return res.status(401).json({ 
      ok: false, 
      error: 'No autenticado',
      details: 'Se requiere autenticación para ver la documentación'
    });
  }

  // Verificar permisos
  const permissions = auth.permissions || [];
  const hasDocsPerm = 
    permissions.includes('docs:read') ||
    permissions.includes('crud:*:*') ||
    permissions.includes('admin:*');

  if (!hasDocsPerm) {
    return res.status(403).json({ 
      ok: false, 
      error: 'No autorizado',
      details: 'Se requiere permiso docs:read para acceder a la documentación'
    });
  }

  return next();
}