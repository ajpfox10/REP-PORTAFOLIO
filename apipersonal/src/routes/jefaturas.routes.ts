import { Router } from 'express';
import { QueryTypes } from 'sequelize';

export function buildJefaturasRouter(sequelize: any) {
  const r = Router();

  // GET /jefaturas — devuelve jefaturas enriquecidas con nombre real desde personal
  r.get('/', async (req, res) => {
    try {
      const limit  = Math.min(Number(req.query.limit)  || 500, 2000);
      const offset = (Math.max(Number(req.query.page) || 1, 1) - 1) * limit;

      const rows = await sequelize.query(`
        SELECT
          j.id,
          j.dni,
          j.servicio_id,
          j.fecha_desde,
          j.fecha_hasta,
          j.deleted_at,
          COALESCE(
            CONCAT(p.apellido, ', ', p.nombre),
            j.jefe
          ) AS jefe,
          p.apellido,
          p.nombre,
          s.nombre AS servicio_nombre
        FROM jefaturas j
        LEFT JOIN personal p ON p.dni = j.dni
        LEFT JOIN servicios s ON s.id = j.servicio_id
        WHERE j.deleted_at IS NULL
        ORDER BY s.nombre
        LIMIT :limit OFFSET :offset
      `, {
        replacements: { limit, offset },
        type: QueryTypes.SELECT,
      });

      const [countResult] = await sequelize.query(
        'SELECT COUNT(*) AS total FROM jefaturas WHERE deleted_at IS NULL',
        { type: QueryTypes.SELECT }
      ) as any[];

      res.json({
        ok:   true,
        data: rows,
        meta: { total: Number(countResult.total), limit, page: Math.floor(offset / limit) + 1 },
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // PATCH /jefaturas/:id — actualiza campos (jefe text, dni, servicio_id, fechas)
  r.patch('/:id', async (req, res) => {
    try {
      const allowed = ['jefe', 'dni', 'servicio_id', 'fecha_desde', 'fecha_hasta'];
      const sets: string[] = [];
      const vals: any = {};
      for (const key of allowed) {
        if (key in req.body) {
          sets.push(`${key} = :${key}`);
          vals[key] = req.body[key];
        }
      }
      if (!sets.length) return res.status(400).json({ ok: false, error: 'Sin campos a actualizar' });
      vals.id = req.params.id;
      await sequelize.query(
        `UPDATE jefaturas SET ${sets.join(', ')} WHERE id = :id`,
        { replacements: vals, type: QueryTypes.UPDATE }
      );
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  return r;
}
