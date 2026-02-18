// src/routes/webhooks.routes.ts
import { Router, Request, Response } from "express";
import { Sequelize } from "sequelize";
import { z } from "zod";
import crypto from "crypto";
import { requirePermission } from "../middlewares/rbacCrud";
import { logger } from "../logging/logger";
import { trackAction } from "../logging/track";

// ============================================
// SCHEMAS DE VALIDACIÓN CON FILTROS
// ============================================
const filterConditionSchema = z.object({
  field: z.string(),
  operator: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'startsWith', 'endsWith']),
  value: z.any()
});

const webhookSchema = z.object({
  nombre: z.string().min(3).max(100),
  url: z.string().url(),
  eventos: z.array(z.enum([
    'pedidos.created', 'pedidos.updated', 'pedidos.deleted',
    'documentos.uploaded', 'documentos.deleted',
    'eventos.created', 'eventos.updated', 'eventos.deleted',
    'certificados.generated'
  ])).min(1),
  // ✅ NUEVO: Filtros por campo
  filters: z.array(filterConditionSchema).optional().default([]),
  timeout_ms: z.number().int().min(1000).max(30000).default(5000),
  retry_policy: z.object({
    max_attempts: z.number().int().min(1).max(10).default(3),
    backoff_ms: z.number().int().min(100).max(10000).default(1000)
  }).default({ max_attempts: 3, backoff_ms: 1000 })
});

const webhookUpdateSchema = webhookSchema.partial();

function generateSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

// ============================================
// FUNCIÓN PARA EVALUAR FILTROS
// ============================================
function evaluateFilters(payload: any, filters: any[]): boolean {
  if (!filters || filters.length === 0) return true;

  const data = payload.data || payload;

  for (const f of filters) {
    const fieldValue = data[f.field];
    
    switch (f.operator) {
      case 'eq': if (fieldValue != f.value) return false; break;
      case 'neq': if (fieldValue == f.value) return false; break;
      case 'gt': if (!(fieldValue > f.value)) return false; break;
      case 'gte': if (!(fieldValue >= f.value)) return false; break;
      case 'lt': if (!(fieldValue < f.value)) return false; break;
      case 'lte': if (!(fieldValue <= f.value)) return false; break;
      case 'contains': 
        if (!String(fieldValue).includes(String(f.value))) return false; 
        break;
      case 'startsWith':
        if (!String(fieldValue).startsWith(String(f.value))) return false;
        break;
      case 'endsWith':
        if (!String(fieldValue).endsWith(String(f.value))) return false;
        break;
      default: return false;
    }
  }
  
  return true;
}

export function buildWebhooksRouter(sequelize: Sequelize) {
  const router = Router();

  // ------------------------------------------------------------------------
  // GET /api/v1/webhooks - Listar webhooks
  // ------------------------------------------------------------------------
  router.get(
    '/',
    requirePermission('webhooks:read'),
    async (req: Request, res: Response) => {
      try {
        const withDeleted = req.query.withDeleted === 'true';
        const deletedFilter = withDeleted ? '' : 'AND deleted_at IS NULL';

        const [rows] = await sequelize.query(
          `SELECT 
            id, nombre, url, eventos, estado, timeout_ms, retry_policy, filters,
            ultima_ejecucion, ultimo_status, created_at, updated_at
           FROM webhooks
           WHERE 1=1 ${deletedFilter}
           ORDER BY created_at DESC`,
          { replacements: {} }
        );

        return res.json({ ok: true, data: rows });
      } catch (err: any) {
        logger.error({ msg: 'Error listing webhooks', err });
        return res.status(500).json({ ok: false, error: 'Error al listar webhooks' });
      }
    }
  );

  // ------------------------------------------------------------------------
  // GET /api/v1/webhooks/:id - Ver webhook
  // ------------------------------------------------------------------------
  router.get(
    '/:id',
    requirePermission('webhooks:read'),
    async (req: Request, res: Response) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
          return res.status(400).json({ ok: false, error: 'ID inválido' });
        }

        const [rows] = await sequelize.query(
          `SELECT 
            id, nombre, url, eventos, estado, timeout_ms, retry_policy, filters,
            ultima_ejecucion, ultimo_status, created_at, updated_at
           FROM webhooks
           WHERE id = :id AND deleted_at IS NULL
           LIMIT 1`,
          { replacements: { id } }
        );

        const webhook = (rows as any[])[0];
        if (!webhook) {
          return res.status(404).json({ ok: false, error: 'Webhook no encontrado' });
        }

        return res.json({ ok: true, data: webhook });
      } catch (err: any) {
        logger.error({ msg: 'Error getting webhook', err });
        return res.status(500).json({ ok: false, error: 'Error al obtener webhook' });
      }
    }
  );

  // ------------------------------------------------------------------------
  // POST /api/v1/webhooks - Crear webhook con filtros
  // ------------------------------------------------------------------------
  router.post(
    '/',
    requirePermission('webhooks:create'),
    async (req: Request, res: Response) => {
      try {
        const parseResult = webhookSchema.safeParse(req.body);
        if (!parseResult.success) {
          return res.status(400).json({
            ok: false,
            error: 'Datos inválidos',
            details: parseResult.error.flatten()
          });
        }

        const data = parseResult.data;
        const secret = generateSecret();
        const actor = (req as any).auth?.principalId ?? null;

        const [result] = await sequelize.query(
          `INSERT INTO webhooks 
           (nombre, url, secret, eventos, timeout_ms, retry_policy, filters, created_by, created_at)
           VALUES
           (:nombre, :url, :secret, :eventos, :timeout_ms, :retry_policy, :filters, :createdBy, NOW())`,
          {
            replacements: {
              nombre: data.nombre,
              url: data.url,
              secret,
              eventos: JSON.stringify(data.eventos),
              timeout_ms: data.timeout_ms,
              retry_policy: JSON.stringify(data.retry_policy),
              filters: JSON.stringify(data.filters),
              createdBy: actor
            }
          }
        );

        const insertId = (result as any).insertId;

        (res.locals as any).audit = {
          action: 'webhook_create',
          table_name: 'webhooks',
          record_pk: insertId,
          entity_table: 'webhooks',
          entity_pk: insertId,
          request_json: { ...data, secret: '[REDACTED]' },
          response_json: { status: 201, id: insertId }
        };

        trackAction('webhook_created', {
          actor,
          webhookId: insertId,
          nombre: data.nombre,
          eventos: data.eventos.length,
          filters: data.filters.length
        });

        return res.status(201).json({
          ok: true,
          data: {
            id: insertId,
            nombre: data.nombre,
            url: data.url,
            secret,
            eventos: data.eventos,
            filters: data.filters,
            timeout_ms: data.timeout_ms,
            retry_policy: data.retry_policy,
            estado: 'activo',
            created_at: new Date()
          }
        });

      } catch (err: any) {
        logger.error({ msg: 'Error creating webhook', err });
        return res.status(500).json({ ok: false, error: 'Error al crear webhook' });
      }
    }
  );

  // ------------------------------------------------------------------------
  // PUT /api/v1/webhooks/:id - Actualizar webhook
  // ------------------------------------------------------------------------
  router.put(
    '/:id',
    requirePermission('webhooks:update'),
    async (req: Request, res: Response) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
          return res.status(400).json({ ok: false, error: 'ID inválido' });
        }

        const parseResult = webhookUpdateSchema.safeParse(req.body);
        if (!parseResult.success) {
          return res.status(400).json({
            ok: false,
            error: 'Datos inválidos',
            details: parseResult.error.flatten()
          });
        }

        const data = parseResult.data;
        const actor = (req as any).auth?.principalId ?? null;

        const [checkRows] = await sequelize.query(
          `SELECT id FROM webhooks WHERE id = :id AND deleted_at IS NULL LIMIT 1`,
          { replacements: { id } }
        );

        if (!(checkRows as any[]).length) {
          return res.status(404).json({ ok: false, error: 'Webhook no encontrado' });
        }

        const sets: string[] = [];
        const repl: any = { id, updatedBy: actor };

        if (data.nombre !== undefined) {
          sets.push('nombre = :nombre');
          repl.nombre = data.nombre;
        }
        if (data.url !== undefined) {
          sets.push('url = :url');
          repl.url = data.url;
        }
        if (data.eventos !== undefined) {
          sets.push('eventos = :eventos');
          repl.eventos = JSON.stringify(data.eventos);
        }
        if (data.timeout_ms !== undefined) {
          sets.push('timeout_ms = :timeout_ms');
          repl.timeout_ms = data.timeout_ms;
        }
        if (data.retry_policy !== undefined) {
          sets.push('retry_policy = :retry_policy');
          repl.retry_policy = JSON.stringify(data.retry_policy);
        }
        if (data.filters !== undefined) {
          sets.push('filters = :filters');
          repl.filters = JSON.stringify(data.filters);
        }

        sets.push('updated_at = NOW(), updated_by = :updatedBy');

        if (sets.length > 0) {
          await sequelize.query(
            `UPDATE webhooks SET ${sets.join(', ')} WHERE id = :id`,
            { replacements: repl }
          );
        }

        const [updatedRows] = await sequelize.query(
          `SELECT id, nombre, url, eventos, estado, timeout_ms, retry_policy, filters,
                  ultima_ejecucion, ultimo_status, created_at, updated_at
           FROM webhooks WHERE id = :id LIMIT 1`,
          { replacements: { id } }
        );

        (res.locals as any).audit = {
          action: 'webhook_update',
          table_name: 'webhooks',
          record_pk: id,
          entity_table: 'webhooks',
          entity_pk: id,
          request_json: { ...data },
          response_json: { status: 200 }
        };

        trackAction('webhook_updated', {
          actor,
          webhookId: id
        });

        return res.json({ ok: true, data: (updatedRows as any[])[0] });

      } catch (err: any) {
        logger.error({ msg: 'Error updating webhook', err });
        return res.status(500).json({ ok: false, error: 'Error al actualizar webhook' });
      }
    }
  );

  // ------------------------------------------------------------------------
  // DELETE /api/v1/webhooks/:id - Eliminar webhook
  // ------------------------------------------------------------------------
  router.delete(
    '/:id',
    requirePermission('webhooks:delete'),
    async (req: Request, res: Response) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
          return res.status(400).json({ ok: false, error: 'ID inválido' });
        }

        const actor = (req as any).auth?.principalId ?? null;

        await sequelize.query(
          `UPDATE webhooks 
           SET estado = 'eliminado', deleted_at = NOW(), updated_at = NOW(), updated_by = :updatedBy
           WHERE id = :id AND deleted_at IS NULL`,
          { replacements: { id, updatedBy: actor } }
        );

        (res.locals as any).audit = {
          action: 'webhook_delete',
          table_name: 'webhooks',
          record_pk: id,
          entity_table: 'webhooks',
          entity_pk: id
        };

        trackAction('webhook_deleted', {
          actor,
          webhookId: id
        });

        return res.json({ ok: true, data: { id, deleted: true } });

      } catch (err: any) {
        logger.error({ msg: 'Error deleting webhook', err });
        return res.status(500).json({ ok: false, error: 'Error al eliminar webhook' });
      }
    }
  );

  // ------------------------------------------------------------------------
  // GET /api/v1/webhooks/:id/deliveries - Historial de entregas
  // ------------------------------------------------------------------------
  router.get(
    '/:id/deliveries',
    requirePermission('webhooks:deliveries:read'),
    async (req: Request, res: Response) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
          return res.status(400).json({ ok: false, error: 'ID inválido' });
        }

        const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
        const limit = Math.min(100, parseInt(req.query.limit as string, 10) || 50);
        const offset = (page - 1) * limit;

        const [rows] = await sequelize.query(
          `SELECT 
            id, evento, response_status, error, attempts, duration_ms, created_at
           FROM webhook_deliveries
           WHERE webhook_id = :id
           ORDER BY created_at DESC
           LIMIT :limit OFFSET :offset`,
          { replacements: { id, limit, offset } }
        );

        const [countRows] = await sequelize.query(
          `SELECT COUNT(1) as total FROM webhook_deliveries WHERE webhook_id = :id`,
          { replacements: { id } }
        );

        const total = (countRows as any[])[0]?.total || 0;

        return res.json({
          ok: true,
          data: rows,
          meta: { page, limit, total }
        });

      } catch (err: any) {
        logger.error({ msg: 'Error listing deliveries', err });
        return res.status(500).json({ ok: false, error: 'Error al obtener entregas' });
      }
    }
  );

  return router;
}