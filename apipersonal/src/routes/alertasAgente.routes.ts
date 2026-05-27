// src/routes/alertasAgente.routes.ts
import { Router, Request, Response } from 'express';
import { Sequelize }                  from 'sequelize';
import { z }                          from 'zod';
import { requirePermission }          from '../middlewares/rbacCrud';
import { logger }                     from '../logging/logger';
import { trackAction }                from '../logging/track';

const createSchema = z.object({
  dni:     z.number().int().positive(),
  titulo:  z.string().min(1).max(255),
  mensaje: z.string().min(1),
  urgente: z.boolean().default(false),
});

export function buildAlertasAgenteRouter(sequelize: Sequelize) {
  const router = Router();

  // GET /alertas-agente/agente/:dni — alertas activas de un agente (para banner)
  router.get(
    '/agente/:dni',
    requirePermission('api:access'),
    async (req: Request, res: Response) => {
      try {
        const dni      = Number(req.params.dni);
        const userId   = (req as any).auth?.principalId ?? null;
        if (isNaN(dni)) return res.status(400).json({ ok: false, error: 'DNI inválido' });

        const [rows] = await sequelize.query(
          `SELECT
             a.id, a.dni, a.titulo, a.mensaje, a.urgente, a.activa,
             a.creado_por, a.created_at,
             COALESCE(NULLIF(usr.nombre, ''), usr.email) AS creado_por_nombre,
             u.visto_at,
             u.cerrado_at
           FROM alertas_agente a
           LEFT JOIN alertas_agente_usuarios u
             ON u.alerta_id = a.id AND u.usuario_id = :userId
           LEFT JOIN usuarios usr ON usr.id = a.creado_por
           WHERE a.dni = :dni
             AND a.activa = 1
             AND a.deleted_at IS NULL
           ORDER BY a.urgente DESC, a.created_at DESC`,
          { replacements: { dni, userId } }
        );

        return res.json({ ok: true, data: rows });
      } catch (err: any) {
        logger.error({ msg: 'Error listando alertas agente', err });
        return res.status(500).json({ ok: false, error: 'Error al obtener alertas' });
      }
    }
  );

  // GET /alertas-agente — todas las alertas (gestión)
  router.get(
    '/',
    requirePermission('api:access'),
    async (req: Request, res: Response) => {
      try {
        const dni    = req.query.dni ? Number(req.query.dni) : null;
        const soloActivas = req.query.activas !== 'false';

        const [rows] = await sequelize.query(
          `SELECT
             a.id, a.dni, a.titulo, a.mensaje, a.urgente, a.activa,
             a.creado_por, a.created_at, a.updated_at,
             CONCAT(per.apellido, ', ', per.nombre) AS agente_nombre,
             COALESCE(NULLIF(usr.nombre, ''), usr.email) AS creado_por_nombre,
             (SELECT COUNT(*) FROM alertas_agente_usuarios u2
               WHERE u2.alerta_id = a.id AND u2.visto_at IS NOT NULL)   AS visto_count,
             (SELECT COUNT(*) FROM alertas_agente_usuarios u3
               WHERE u3.alerta_id = a.id AND u3.cerrado_at IS NOT NULL) AS cerrado_count
           FROM alertas_agente a
           LEFT JOIN personal per ON per.dni = a.dni AND per.deleted_at IS NULL
           LEFT JOIN usuarios  usr ON usr.id = a.creado_por
           WHERE a.deleted_at IS NULL
             ${soloActivas ? 'AND a.activa = 1' : ''}
             ${dni ? 'AND a.dni = :dni' : ''}
           ORDER BY a.urgente DESC, a.created_at DESC
           LIMIT 500`,
          { replacements: { ...(dni ? { dni } : {}) } }
        );

        return res.json({ ok: true, data: rows });
      } catch (err: any) {
        logger.error({ msg: 'Error listando alertas', err });
        return res.status(500).json({ ok: false, error: 'Error al listar alertas' });
      }
    }
  );

  // GET /alertas-agente/:id/estados — quién vio y cerró una alerta
  router.get(
    '/:id/estados',
    requirePermission('api:access'),
    async (req: Request, res: Response) => {
      try {
        const id = Number(req.params.id);
        if (isNaN(id)) return res.status(400).json({ ok: false, error: 'ID inválido' });

        const [rows] = await sequelize.query(
          `SELECT
             u.usuario_id,
             usr.email,
             usr.nombre,
             u.visto_at,
             u.cerrado_at
           FROM alertas_agente_usuarios u
           JOIN usuarios  usr ON usr.id = u.usuario_id
           WHERE u.alerta_id = :id
           ORDER BY u.visto_at ASC`,
          { replacements: { id } }
        );

        return res.json({ ok: true, data: rows });
      } catch (err: any) {
        logger.error({ msg: 'Error obteniendo estados alerta', err });
        return res.status(500).json({ ok: false, error: 'Error al obtener estados' });
      }
    }
  );

  // POST /alertas-agente — crear alerta
  router.post(
    '/',
    requirePermission('api:access'),
    async (req: Request, res: Response) => {
      try {
        const parsed = createSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ ok: false, error: 'Datos inválidos', details: parsed.error.flatten() });
        }

        const { dni, titulo, mensaje, urgente } = parsed.data;
        const userId = (req as any).auth?.principalId ?? null;
        const now    = new Date();

        const [checkRows] = await sequelize.query(
          `SELECT dni FROM personal WHERE dni = :dni AND deleted_at IS NULL LIMIT 1`,
          { replacements: { dni } }
        );
        if ((checkRows as any[]).length === 0) {
          return res.status(404).json({ ok: false, error: 'DNI no encontrado en personal' });
        }

        const [result] = await sequelize.query(
          `INSERT INTO alertas_agente (dni, titulo, mensaje, urgente, activa, creado_por, created_at, updated_at)
           VALUES (:dni, :titulo, :mensaje, :urgente, 1, :userId, :now, :now)`,
          { replacements: { dni, titulo, mensaje, urgente: urgente ? 1 : 0, userId, now } }
        );

        const insertId = (result as any)?.insertId;

        trackAction('alerta_agente_crear', { actor: userId, alerta_id: insertId, dni, urgente });

        return res.status(201).json({ ok: true, data: { id: insertId } });
      } catch (err: any) {
        logger.error({ msg: 'Error creando alerta agente', err });
        return res.status(500).json({ ok: false, error: 'Error al crear alerta' });
      }
    }
  );

  // POST /alertas-agente/:id/ver — marcar como vista por el usuario actual
  router.post(
    '/:id/ver',
    requirePermission('api:access'),
    async (req: Request, res: Response) => {
      try {
        const id     = Number(req.params.id);
        const userId = (req as any).auth?.principalId ?? null;
        if (isNaN(id) || !userId) return res.status(400).json({ ok: false, error: 'Parámetros inválidos' });

        const now = new Date();
        await sequelize.query(
          `INSERT INTO alertas_agente_usuarios (alerta_id, usuario_id, visto_at, created_at)
           VALUES (:id, :userId, :now, :now)
           ON DUPLICATE KEY UPDATE
             visto_at = COALESCE(visto_at, :now)`,
          { replacements: { id, userId, now } }
        );

        return res.json({ ok: true });
      } catch (err: any) {
        logger.error({ msg: 'Error marcando alerta como vista', err });
        return res.status(500).json({ ok: false, error: 'Error al registrar vista' });
      }
    }
  );

  // POST /alertas-agente/:id/cerrar — cerrar para el usuario actual (individual)
  router.post(
    '/:id/cerrar',
    requirePermission('api:access'),
    async (req: Request, res: Response) => {
      try {
        const id     = Number(req.params.id);
        const userId = (req as any).auth?.principalId ?? null;
        if (isNaN(id) || !userId) return res.status(400).json({ ok: false, error: 'Parámetros inválidos' });

        const now = new Date();
        await sequelize.query(
          `INSERT INTO alertas_agente_usuarios (alerta_id, usuario_id, visto_at, cerrado_at, created_at)
           VALUES (:id, :userId, :now, :now, :now)
           ON DUPLICATE KEY UPDATE
             visto_at   = COALESCE(visto_at, :now),
             cerrado_at = COALESCE(cerrado_at, :now)`,
          { replacements: { id, userId, now } }
        );

        trackAction('alerta_agente_cerrar', { actor: userId, alerta_id: id });

        return res.json({ ok: true });
      } catch (err: any) {
        logger.error({ msg: 'Error cerrando alerta', err });
        return res.status(500).json({ ok: false, error: 'Error al cerrar alerta' });
      }
    }
  );

  // DELETE /alertas-agente/:id — desactivar alerta (admin/creador)
  router.delete(
    '/:id',
    requirePermission('api:access'),
    async (req: Request, res: Response) => {
      try {
        const id     = Number(req.params.id);
        const userId = (req as any).auth?.principalId ?? null;
        if (isNaN(id)) return res.status(400).json({ ok: false, error: 'ID inválido' });

        const now = new Date();
        await sequelize.query(
          `UPDATE alertas_agente SET deleted_at = :now, activa = 0, updated_at = :now WHERE id = :id`,
          { replacements: { id, now } }
        );

        trackAction('alerta_agente_eliminar', { actor: userId, alerta_id: id });

        return res.json({ ok: true });
      } catch (err: any) {
        logger.error({ msg: 'Error eliminando alerta', err });
        return res.status(500).json({ ok: false, error: 'Error al eliminar alerta' });
      }
    }
  );

  return router;
}
