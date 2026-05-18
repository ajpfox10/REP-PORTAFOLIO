// Consultas WhatsApp — registro diario de cantidad de consultas por WhatsApp.
// GET    /whatsapp              → lista (filtros: desde, hasta, year, month)
// POST   /whatsapp              → crea o actualiza por fecha (upsert)
// PUT    /whatsapp/:id          → actualiza cantidad
// DELETE /whatsapp/:id          → elimina

import { Router, Request, Response } from 'express';
import { Sequelize, QueryTypes } from 'sequelize';
import { z } from 'zod';
import { requirePermission } from '../middlewares/rbacCrud';

const bodySchema = z.object({
  fecha:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD'),
  cantidad: z.number().int().min(0),
});

const updateSchema = z.object({
  fecha:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  cantidad: z.number().int().min(0),
});

export function buildWhatsappRouter(sequelize: Sequelize): Router {
  const router = Router();
  const perm   = requirePermission('crud:*:*');

  // GET /whatsapp?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&year=YYYY&month=MM
  router.get('/', perm, async (req: Request, res: Response) => {
    try {
      const { desde, hasta, year, month } = req.query as Record<string, string>;
      const conds: string[] = [];
      const replacements: Record<string, string> = {};

      if (desde) { conds.push('fecha >= :desde'); replacements.desde = desde; }
      if (hasta) { conds.push('fecha <= :hasta'); replacements.hasta = hasta; }
      if (year)  { conds.push('YEAR(fecha) = :year');  replacements.year  = year;  }
      if (month) { conds.push('MONTH(fecha) = :month'); replacements.month = month; }

      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      const rows = await sequelize.query<any>(
        `SELECT id, fecha, cantidad, created_at, updated_at
         FROM consultas_whatsapp ${where} ORDER BY fecha ASC`,
        { type: QueryTypes.SELECT, replacements }
      );
      return res.json({ ok: true, data: rows, meta: { total: rows.length } });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  });

  // POST /whatsapp — upsert por fecha
  router.post('/', perm, async (req: Request, res: Response) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.errors });
    try {
      const { fecha, cantidad } = parsed.data;
      await sequelize.query(
        `INSERT INTO consultas_whatsapp (fecha, cantidad)
         VALUES (:fecha, :cantidad)
         ON DUPLICATE KEY UPDATE cantidad = :cantidad, updated_at = NOW()`,
        { replacements: { fecha, cantidad } }
      );
      const [row] = await sequelize.query<any>(
        'SELECT * FROM consultas_whatsapp WHERE fecha = :fecha',
        { type: QueryTypes.SELECT, replacements: { fecha } }
      );
      return res.status(201).json({ ok: true, data: row });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  });

  // PUT /whatsapp/:id
  router.put('/:id', perm, async (req: Request, res: Response) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.errors });
    try {
      const { id } = req.params;
      const { fecha, cantidad } = parsed.data;
      const sets: string[] = ['cantidad = :cantidad'];
      if (fecha) sets.push('fecha = :fecha');
      await sequelize.query(
        `UPDATE consultas_whatsapp SET ${sets.join(', ')} WHERE id = :id`,
        { replacements: { id, cantidad, fecha: fecha ?? null } }
      );
      const [row] = await sequelize.query<any>(
        'SELECT * FROM consultas_whatsapp WHERE id = :id',
        { type: QueryTypes.SELECT, replacements: { id } }
      );
      if (!row) return res.status(404).json({ ok: false, error: 'No encontrado' });
      return res.json({ ok: true, data: row });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  });

  // DELETE /whatsapp/:id
  router.delete('/:id', perm, async (req: Request, res: Response) => {
    try {
      await sequelize.query(
        'DELETE FROM consultas_whatsapp WHERE id = :id',
        { replacements: { id: req.params.id } }
      );
      return res.json({ ok: true });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  });

  return router;
}
