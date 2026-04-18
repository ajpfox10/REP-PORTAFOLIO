// src/routes/bajas.routes.ts
// Bajas por estructura — agentes con estado_empleo = 'BAJA', agrupados por servicio
// Acceso: crud:*:* (admin) o crud:agentexdni1:read (user)

import { Router, Request, Response } from 'express';
import { Sequelize, QueryTypes } from 'sequelize';
import { requirePermission } from '../middlewares/rbacCrud';
import { can } from '../middlewares/rbacCrud';

export function buildBajasRouter(sequelize: Sequelize) {
  const router = Router();

  // ── GET /bajas-estructura ──────────────────────────────────────────────────
  router.get('/', requirePermission('api:access'), async (req: Request, res: Response) => {
    const auth = (req as any).auth ?? {};
    const perms: string[] = auth.permissions ?? [];
    const isAdmin = perms.some((p: string) => p === 'crud:*:*' || p.endsWith(':*:*'));
    const canRead = isAdmin || can(perms, 'agentexdni1', 'read');
    if (!canRead) return res.status(403).json({ ok: false, error: 'Sin permiso' });

    const { anio, servicio, q } = req.query as any;

    try {
      const conds: string[] = ['a.estado_empleo = ?', 'p.deleted_at IS NULL', 'a.deleted_at IS NULL'];
      const vals: any[] = ['BAJA'];

      if (anio) {
        conds.push('YEAR(a.fecha_egreso) = ?');
        vals.push(Number(anio));
      }
      if (q?.trim()) {
        conds.push('(p.apellido LIKE ? OR p.nombre LIKE ? OR p.dni LIKE ?)');
        const like = `%${q.trim()}%`;
        vals.push(like, like, like);
      }

      const rows = await sequelize.query<any>(
        `SELECT
           p.dni,
           p.apellido,
           p.nombre,
           a.fecha_egreso,
           YEAR(a.fecha_egreso) AS anio,
           COALESCE(
             (SELECT ags.servicio_nombre
              FROM agentes_servicios ags
              WHERE ags.dni = p.dni
                AND ags.deleted_at IS NULL
              ORDER BY ags.fecha_desde DESC
              LIMIT 1),
             'Sin servicio asignado'
           ) AS servicio_nombre
         FROM agentes a
         JOIN personal p ON p.dni = a.dni
         WHERE ${conds.join(' AND ')}
         ORDER BY servicio_nombre, p.apellido, p.nombre`,
        { type: QueryTypes.SELECT, replacements: vals },
      );

      // Filtrar por servicio después de construir (para no complicar el subquery)
      const filtrados = servicio?.trim()
        ? rows.filter((r: any) =>
            (r.servicio_nombre ?? '').toLowerCase().includes(servicio.trim().toLowerCase()))
        : rows;

      // Años disponibles para el selector
      const aniosRows = await sequelize.query<any>(
        `SELECT DISTINCT YEAR(a.fecha_egreso) AS anio
         FROM agentes a
         WHERE a.estado_empleo = 'BAJA' AND a.fecha_egreso IS NOT NULL AND a.deleted_at IS NULL
         ORDER BY anio DESC`,
        { type: QueryTypes.SELECT },
      );
      const anios = aniosRows.map((r: any) => r.anio).filter(Boolean);

      return res.json({ ok: true, data: filtrados, total: filtrados.length, anios });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: e?.message });
    }
  });

  return router;
}
