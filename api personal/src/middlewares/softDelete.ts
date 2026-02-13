// src/middlewares/softDelete.ts
import { Request, Response, NextFunction } from 'express';
import { Sequelize } from 'sequelize';

/**
 * Middleware para filtrar automáticamente registros eliminados (deleted_at IS NULL)
 * en endpoints CRUD y otros endpoints que usen modelos de Sequelize.
 * 
 * ✅ Funciona sin modificar controllers existentes.
 * ✅ Solo afecta GET /:table y GET /:table/:id
 * ✅ Se puede deshabilitar por query param ?withDeleted=true
 */
export function softDeleteMiddleware(sequelize: Sequelize) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Solo afecta métodos GET
    if (req.method !== 'GET') {
      return next();
    }

    // Verificar si es una ruta de tabla
    const table = req.params.table;
    if (!table) {
      return next();
    }

    // Verificar que el modelo existe y tiene deleted_at
    const model = (sequelize.models as any)[table];
    if (!model) {
      return next();
    }

    // Verificar si el modelo tiene el campo deleted_at en sus atributos
    const hasDeletedAt = model.rawAttributes && model.rawAttributes.deleted_at;
    if (!hasDeletedAt) {
      return next();
    }

    // Si el usuario explícitamente pide ver eliminados, lo permitimos
    const withDeleted = req.query.withDeleted === 'true';
    
    // Guardamos en locals para que el controller pueda acceder
    (res.locals as any).softDelete = {
      enabled: !withDeleted,
      table,
      hasDeletedAt: true
    };

    // ✅ INTERCEPTAMOS los métodos del modelo para agregar el filtro automáticamente
    const originalFindAll = model.findAll;
    const originalFindOne = model.findOne;
    const originalFindAndCountAll = model.findAndCountAll;

    if (!withDeleted) {
      // Override findAll
      model.findAll = async function(options: any = {}) {
        const where = options.where || {};
        where.deleted_at = null;
        options.where = where;
        return originalFindAll.call(this, options);
      };

      // Override findOne
      model.findOne = async function(options: any = {}) {
        const where = options.where || {};
        where.deleted_at = null;
        options.where = where;
        return originalFindOne.call(this, options);
      };

      // Override findAndCountAll
      model.findAndCountAll = async function(options: any = {}) {
        const where = options.where || {};
        where.deleted_at = null;
        options.where = where;
        return originalFindAndCountAll.call(this, options);
      };
    }

    // Restauramos después de la request (para no afectar otras requests)
    res.once('finish', () => {
      model.findAll = originalFindAll;
      model.findOne = originalFindOne;
      model.findAndCountAll = originalFindAndCountAll;
    });

    next();
  };
}