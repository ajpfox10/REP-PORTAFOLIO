// src/routes/personal.historial.routes.ts
import { Router, Request, Response } from "express";
import { Sequelize } from "sequelize";
import { requirePermission } from "../middlewares/rbacCrud";
import { logger } from "../logging/logger";

export function buildPersonalHistorialRouter(sequelize: Sequelize) {
  const router = Router();

  // GET /api/v1/personal/:dni/historial
  router.get(
    '/:dni/historial',
    requirePermission('personal:historial:read'),
    async (req: Request, res: Response) => {
      try {
        const dni = Number(req.params.dni);
        if (isNaN(dni)) {
          return res.status(400).json({ ok: false, error: 'DNI inválido' });
        }

        const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
        const limit = Math.min(50, parseInt(req.query.limit as string, 10) || 20);
        const offset = (page - 1) * limit;

        // Buscar en audit_log cambios relacionados a este DNI
        const [rows] = await sequelize.query(
          `SELECT 
            id,
            action,
            table_name,
            record_pk,
            before_json,
            after_json,
            created_at,
            actor_type,
            actor_id,
            request_id
           FROM audit_log
           WHERE (table_name = 'personal' AND record_pk = :dni)
              OR (table_name IN ('agentes', 'agentes_servicios') 
                  AND JSON_EXTRACT(request_json, '$.dni') = :dni)
           ORDER BY created_at DESC
           LIMIT :limit OFFSET :offset`,
          { replacements: { dni, limit, offset } }
        );

        const [countRows] = await sequelize.query(
          `SELECT COUNT(1) as total
           FROM audit_log
           WHERE (table_name = 'personal' AND record_pk = :dni)
              OR (table_name IN ('agentes', 'agentes_servicios') 
                  AND JSON_EXTRACT(request_json, '$.dni') = :dni)`,
          { replacements: { dni } }
        );

        const total = (countRows as any[])[0]?.total || 0;

        return res.json({
          ok: true,
          data: rows,
          meta: { page, limit, total }
        });

      } catch (err: any) {
        logger.error({ msg: 'Error fetching personal history', err });
        return res.status(500).json({ ok: false, error: 'Error al obtener historial' });
      }
    }
  );

  // GET /api/v1/personal/:dni/historial/:id
  router.get(
    '/:dni/historial/:id',
    requirePermission('personal:historial:read'),
    async (req: Request, res: Response) => {
      try {
        const dni = Number(req.params.dni);
        const id = Number(req.params.id);
        
        if (isNaN(dni) || isNaN(id)) {
          return res.status(400).json({ ok: false, error: 'Parámetros inválidos' });
        }

        const [rows] = await sequelize.query(
          `SELECT * FROM audit_log WHERE id = :id LIMIT 1`,
          { replacements: { id } }
        );

        const entry = (rows as any[])[0];
        if (!entry) {
          return res.status(404).json({ ok: false, error: 'Registro no encontrado' });
        }

        return res.json({ ok: true, data: entry });

      } catch (err: any) {
        logger.error({ msg: 'Error fetching history entry', err });
        return res.status(500).json({ ok: false, error: 'Error al obtener registro' });
      }
    }
  );

  return router;
}