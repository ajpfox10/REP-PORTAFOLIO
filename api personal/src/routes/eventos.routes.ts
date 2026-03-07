// src/routes/eventos.routes.ts
import { Router, Request, Response } from "express";
import { Sequelize } from "sequelize";
import { z } from "zod";
import { requirePermission } from "../middlewares/rbacCrud";
import { logger } from "../logging/logger";
import { trackAction } from "../logging/track";
import { emitEventoCreated, emitEventoUpdated } from '../socket/handlers/eventos';
import { buildEventosTimelineRouter } from './eventos.timeline.routes'; // ✅ MOVED TO TOP

// ============================================
// SCHEMAS DE VALIDACIÓN
// ============================================
const eventoSchema = z.object({
  dni: z.number().int().positive(),
  tipo: z.enum(['LICENCIA', 'CITACION', 'SANCION']),
  estado: z.enum(['ABIERTO', 'CERRADO', 'PENDIENTE']).default('ABIERTO'),
  fecha_inicio: z.string().optional(),
  fecha_fin: z.string().optional(),
  titulo: z.string().max(255).optional(),
  descripcion: z.string().optional(),
  metadata: z.any().optional(),
});

const cerrarEventoSchema = z.object({
  estado: z.enum(['CERRADO', 'FINALIZADO']).default('CERRADO'),
  observaciones: z.string().optional()
});

export function buildEventosRouter(sequelize: Sequelize) {
  const router = Router();

  // GET /api/v1/eventos/dni/:dni - Listar eventos por DNI
  router.get(
    '/dni/:dni',
    requirePermission('eventos:read'),
    async (req: Request, res: Response) => {
      try {
        const dni = Number(req.params.dni);
        if (isNaN(dni)) {
          return res.status(400).json({ ok: false, error: 'DNI inválido' });
        }

        const withDeleted = req.query.withDeleted === 'true';
        const deletedFilter = withDeleted ? '' : 'AND e.deleted_at IS NULL';

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
            e.metadata,
            e.created_at,
            e.updated_at,
            e.deleted_at,
            CONCAT(p.apellido, ', ', p.nombre) AS agente_nombre
          FROM eventos e
          JOIN personal p ON p.dni = e.dni AND p.deleted_at IS NULL
          WHERE e.dni = :dni
            ${deletedFilter}
          ORDER BY e.created_at DESC
          LIMIT 200
          `,
          { replacements: { dni } }
        );

        trackAction('eventos_list', {
          actor: (req as any).auth?.principalId,
          dni,
          count: (rows as any[]).length
        });

        return res.json({ ok: true, data: rows });
      } catch (err: any) {
        logger.error({ msg: 'Error listing eventos', err });
        return res.status(500).json({ ok: false, error: 'Error al listar eventos' });
      }
    }
  );

  // GET /api/v1/eventos/:id - Obtener evento por ID
  router.get(
    '/:id',
    requirePermission('eventos:read'),
    async (req: Request, res: Response) => {
      try {
        const id = Number(req.params.id);
        if (isNaN(id)) {
          return res.status(400).json({ ok: false, error: 'ID inválido' });
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
            e.metadata,
            e.created_at,
            e.updated_at,
            e.deleted_at,
            CONCAT(p.apellido, ', ', p.nombre) AS agente_nombre
          FROM eventos e
          JOIN personal p ON p.dni = e.dni AND p.deleted_at IS NULL
          WHERE e.id = :id AND e.deleted_at IS NULL
          LIMIT 1
          `,
          { replacements: { id } }
        );

        const evento = (rows as any[])[0];
        if (!evento) {
          return res.status(404).json({ ok: false, error: 'Evento no encontrado' });
        }

        return res.json({ ok: true, data: evento });
      } catch (err: any) {
        logger.error({ msg: 'Error getting evento', err });
        return res.status(500).json({ ok: false, error: 'Error al obtener evento' });
      }
    }
  );

  // POST /api/v1/eventos/licencias
  router.post(
    '/licencias',
    requirePermission('eventos:create'),
    async (req: Request, res: Response) => {
      return createEvento('LICENCIA', req, res, sequelize);
    }
  );

  // POST /api/v1/eventos/citaciones
  router.post(
    '/citaciones',
    requirePermission('eventos:create'),
    async (req: Request, res: Response) => {
      return createEvento('CITACION', req, res, sequelize);
    }
  );

  // POST /api/v1/eventos/sanciones
  router.post(
    '/sanciones',
    requirePermission('eventos:create'),
    async (req: Request, res: Response) => {
      return createEvento('SANCION', req, res, sequelize);
    }
  );

  // PUT /api/v1/eventos/:id/cerrar - Cerrar evento
  router.put(
    '/:id/cerrar',
    requirePermission('eventos:update'),
    async (req: Request, res: Response) => {
      try {
        const id = Number(req.params.id);
        if (isNaN(id)) {
          return res.status(400).json({ ok: false, error: 'ID inválido' });
        }

        const parseResult = cerrarEventoSchema.safeParse(req.body);
        if (!parseResult.success) {
          return res.status(400).json({
            ok: false,
            error: 'Datos inválidos',
            details: parseResult.error.flatten()
          });
        }

        const [checkRows] = await sequelize.query(
          `SELECT id, dni, tipo, estado FROM eventos WHERE id = :id AND deleted_at IS NULL LIMIT 1`,
          { replacements: { id } }
        );

        const evento = (checkRows as any[])[0];
        if (!evento) {
          return res.status(404).json({ ok: false, error: 'Evento no encontrado' });
        }

        if (evento.estado === 'CERRADO') {
          return res.status(400).json({ ok: false, error: 'Evento ya está cerrado' });
        }

        const actor = (req as any).auth?.principalId ?? null;
        const now = new Date();

        await sequelize.query(
          `UPDATE eventos 
           SET estado = :estado, 
               updated_at = :now, 
               updated_by = :actor
           WHERE id = :id`,
          {
            replacements: {
              id,
              estado: parseResult.data.estado,
              now,
              actor
            }
          }
        );

        const [updatedRows] = await sequelize.query(
          `SELECT * FROM eventos WHERE id = :id LIMIT 1`,
          { replacements: { id } }
        );

        // ✅ SOCKET - Notificar evento actualizado
        emitEventoUpdated(evento.dni, (updatedRows as any[])[0]);

        (res.locals as any).audit = {
          action: 'evento_cerrar',
          table_name: 'eventos',
          record_pk: id,
          entity_table: 'eventos',
          entity_pk: id,
          request_json: { estado: parseResult.data.estado },
          response_json: { status: 200 }
        };

        trackAction('eventos_cerrar', {
          actor,
          evento_id: id,
          dni: evento.dni,
          tipo: evento.tipo
        });

        return res.json({
          ok: true,
          data: (updatedRows as any[])[0]
        });

      } catch (err: any) {
        logger.error({ msg: 'Error closing evento', err });
        return res.status(500).json({ ok: false, error: 'Error al cerrar evento' });
      }
    }
  );

  // DELETE /api/v1/eventos/:id - Soft delete
  router.delete(
    '/:id',
    requirePermission('eventos:delete'),
    async (req: Request, res: Response) => {
      try {
        const id = Number(req.params.id);
        if (isNaN(id)) {
          return res.status(400).json({ ok: false, error: 'ID inválido' });
        }

        const [checkRows] = await sequelize.query(
          `SELECT id, dni, tipo, estado, deleted_at FROM eventos WHERE id = :id LIMIT 1`,
          { replacements: { id } }
        );

        const evento = (checkRows as any[])[0];
        if (!evento) {
          return res.status(404).json({ ok: false, error: 'Evento no encontrado' });
        }

        if (evento.deleted_at) {
          return res.status(400).json({ ok: false, error: 'Evento ya está eliminado' });
        }

        const actor = (req as any).auth?.principalId ?? null;
        const now = new Date();

        await sequelize.query(
          `UPDATE eventos 
           SET deleted_at = :now, updated_at = :now, updated_by = :actor
           WHERE id = :id`,
          { replacements: { id, now, actor } }
        );

        (res.locals as any).audit = {
          action: 'evento_delete',
          table_name: 'eventos',
          record_pk: id,
          entity_table: 'eventos',
          entity_pk: id
        };

        trackAction('eventos_delete', {
          actor,
          evento_id: id,
          dni: evento.dni
        });

        return res.json({
          ok: true,
          data: { id, deleted: true, deleted_at: now }
        });

      } catch (err: any) {
        logger.error({ msg: 'Error deleting evento', err });
        return res.status(500).json({ ok: false, error: 'Error al eliminar evento' });
      }
    }
  );

  // ✅ TIMELINE ROUTER - AGREGADO AQUÍ (DESPUÉS DE LAS RUTAS PRINCIPALES)
  router.use('/timeline', buildEventosTimelineRouter(sequelize));

  return router;
}

// ============================================
// FUNCIÓN AUXILIAR PARA CREAR EVENTOS
// ============================================
async function createEvento(
  tipo: 'LICENCIA' | 'CITACION' | 'SANCION',
  req: Request,
  res: Response,
  sequelize: Sequelize
) {
  try {
    const parseResult = eventoSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        ok: false,
        error: 'Datos inválidos',
        details: parseResult.error.flatten()
      });
    }

    const data = parseResult.data;
    const auth = (req as any).auth;
    
    const [personalRows] = await sequelize.query(
      `SELECT dni FROM personal WHERE dni = :dni AND deleted_at IS NULL LIMIT 1`,
      { replacements: { dni: data.dni } }
    );

    if ((personalRows as any[]).length === 0) {
      return res.status(404).json({ ok: false, error: 'DNI no encontrado en personal' });
    }

    const createdBy = auth?.principalType === 'api_key' ? auth?.principalId : null;
    const now = new Date();

    const [result] = await sequelize.query(
      `INSERT INTO eventos 
       (dni, tipo, estado, fecha_inicio, fecha_fin, titulo, descripcion, metadata, created_by_api_key_id, created_at, updated_at)
       VALUES 
       (:dni, :tipo, :estado, :fecha_inicio, :fecha_fin, :titulo, :descripcion, :metadata, :createdBy, :now, :now)`,
      {
        replacements: {
          dni: data.dni,
          tipo,
          estado: data.estado,
          fecha_inicio: data.fecha_inicio || null,
          fecha_fin: data.fecha_fin || null,
          titulo: data.titulo || null,
          descripcion: data.descripcion || null,
          metadata: data.metadata ? JSON.stringify(data.metadata) : null,
          createdBy,
          now
        }
      }
    );

    const insertId = (result as any)?.insertId;
    const [newRows] = await sequelize.query(
      `SELECT * FROM eventos WHERE id = :id LIMIT 1`,
      { replacements: { id: insertId } }
    );

    // ✅ SOCKET - Notificar evento creado
    emitEventoCreated(data.dni, (newRows as any[])[0]);

    (res.locals as any).audit = {
      action: 'evento_create',
      table_name: 'eventos',
      record_pk: insertId,
      entity_table: 'eventos',
      entity_pk: insertId,
      request_json: { ...data, tipo },
      response_json: { status: 201, id: insertId }
    };

    trackAction('eventos_crear', {
      actor: auth?.principalId,
      evento_id: insertId,
      dni: data.dni,
      tipo
    });

    return res.status(201).json({
      ok: true,
      data: (newRows as any[])[0]
    });

  } catch (err: any) {
    logger.error({ msg: `Error creating ${tipo}`, err });
    return res.status(500).json({ ok: false, error: `Error al crear ${tipo.toLowerCase()}` });
  }
}