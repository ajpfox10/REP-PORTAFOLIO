// src/routes/eventos.timeline.routes.ts
import { Router, Request, Response } from "express";
import { Sequelize } from "sequelize";
import { requirePermission } from "../middlewares/rbacCrud";
import { logger } from "../logging/logger";

export function buildEventosTimelineRouter(sequelize: Sequelize) {
  const router = Router();

  // GET /api/v1/eventos/timeline/:dni
  router.get(
    '/:dni',
    requirePermission('eventos:read'),
    async (req: Request, res: Response) => {
      try {
        const dni = Number(req.params.dni);
        if (isNaN(dni)) {
          return res.status(400).json({ ok: false, error: 'DNI inválido' });
        }

        const year = req.query.year ? Number(req.query.year) : new Date().getFullYear();
        const month = req.query.month ? Number(req.query.month) : null;

        let dateFilter = `YEAR(e.fecha_inicio) = :year`;
        if (month) {
          dateFilter += ` AND MONTH(e.fecha_inicio) = :month`;
        }

        const [rows] = await sequelize.query(
          `
          SELECT 
            e.id,
            e.dni,
            e.tipo,
            e.estado,
            e.fecha_inicio,
            e.fecha_fin,
            e.titulo,
            e.descripcion,
            e.created_at,
            CONCAT(p.apellido, ', ', p.nombre) AS agente_nombre,
            DATEDIFF(e.fecha_fin, e.fecha_inicio) AS duracion_dias
          FROM eventos e
          JOIN personal p ON p.dni = e.dni AND p.deleted_at IS NULL
          WHERE e.dni = :dni
            AND e.deleted_at IS NULL
            AND ${dateFilter}
          ORDER BY e.fecha_inicio ASC
          `,
          { replacements: { dni, year, month } }
        );

        // Agrupar por mes para timeline
        const timeline: any = {};
        
        for (const ev of (rows as any[])) {
          if (!ev.fecha_inicio) continue;
          const date = new Date(ev.fecha_inicio);
          const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          
          if (!timeline[monthKey]) {
            timeline[monthKey] = [];
          }
          timeline[monthKey].push(ev);
        }

        return res.json({
          ok: true,
          data: {
            dni,
            year,
            month,
            total: (rows as any[]).length,
            timeline,
            events: rows
          }
        });

      } catch (err: any) {
        logger.error({ msg: 'Error building timeline', err });
        return res.status(500).json({ ok: false, error: 'Error al generar timeline' });
      }
    }
  );

  return router;
}