// src/routes/apiKeys.routes.ts
import { Router, Request, Response } from 'express';
import { Sequelize } from 'sequelize';
import crypto from 'crypto';
import { z } from 'zod';
import { requirePermission } from '../middlewares/rbacCrud'; // ✅ YA EXISTE
import { logger } from '../logging/logger';
import { trackAction } from '../logging/track';

// Schema de validación
const createApiKeySchema = z.object({
  name: z.string().min(3).max(128),
  role_id: z.number().int().positive().nullable().optional()
});

function generateApiKey(): { plaintext: string; hash: string } {
  const plaintext = `pk_${crypto.randomBytes(24).toString('hex')}`;
  const hash = crypto.createHash('sha256').update(plaintext, 'utf8').digest('hex');
  return { plaintext, hash };
}

export function buildApiKeysRouter(sequelize: Sequelize) {
  const router = Router();

  // ------------------------------------------------------------------------
  // GET /api/v1/api-keys - Listar todas las API keys
  // ------------------------------------------------------------------------
  router.get(
    '/',
    requirePermission('api_keys:read'), // ✅ PERMISO ESPECÍFICO
    async (req: Request, res: Response) => {
      try {
        const [rows] = await sequelize.query(
          `SELECT 
            id, 
            name, 
            role_id,
            created_at,
            revoked_at,
            CASE 
              WHEN revoked_at IS NOT NULL THEN 'revoked'
              ELSE 'active'
            END as status
          FROM api_keys
          ORDER BY created_at DESC
          LIMIT 100`
        );

        return res.json({ ok: true, data: rows });
      } catch (err: any) {
        logger.error({ msg: 'Failed to list API keys', err });
        return res.status(500).json({ ok: false, error: 'Error al listar API keys' });
      }
    }
  );

  // ------------------------------------------------------------------------
  // GET /api/v1/api-keys/:id - Ver detalle de una API key
  // ------------------------------------------------------------------------
  router.get(
    '/:id',
    requirePermission('api_keys:read'),
    async (req: Request, res: Response) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
          return res.status(400).json({ ok: false, error: 'ID inválido' });
        }

        const [rows] = await sequelize.query(
          `SELECT 
            id, 
            name, 
            role_id,
            created_at,
            revoked_at,
            CASE 
              WHEN revoked_at IS NOT NULL THEN 'revoked'
              ELSE 'active'
            END as status
          FROM api_keys
          WHERE id = :id
          LIMIT 1`,
          { replacements: { id } }
        );

        const key = (rows as any[])[0];
        if (!key) {
          return res.status(404).json({ ok: false, error: 'API key no encontrada' });
        }

        return res.json({ ok: true, data: key });
      } catch (err: any) {
        logger.error({ msg: 'Failed to get API key', err });
        return res.status(500).json({ ok: false, error: 'Error al obtener API key' });
      }
    }
  );

  // ------------------------------------------------------------------------
  // POST /api/v1/api-keys - Crear nueva API key
  // ------------------------------------------------------------------------
  router.post(
    '/',
    requirePermission('api_keys:create'),
    async (req: Request, res: Response) => {
      try {
        const parseResult = createApiKeySchema.safeParse(req.body);
        if (!parseResult.success) {
          return res.status(400).json({
            ok: false,
            error: 'Datos inválidos',
            details: parseResult.error.flatten()
          });
        }

        const { name, role_id } = parseResult.data;
        const { plaintext, hash } = generateApiKey();

        // Verificar que el rol existe si se especificó
        if (role_id) {
          const [roleRows] = await sequelize.query(
            `SELECT id FROM roles WHERE id = :role_id AND deleted_at IS NULL LIMIT 1`,
            { replacements: { role_id } }
          );
          if ((roleRows as any[]).length === 0) {
            return res.status(400).json({ ok: false, error: 'Rol no encontrado' });
          }
        }

        // Insertar en DB
        const [result] = await sequelize.query(
          `INSERT INTO api_keys (name, key_hash, role_id, created_at)
           VALUES (:name, :hash, :role_id, NOW())`,
          {
            replacements: {
              name,
              hash,
              role_id: role_id || null
            }
          }
        );

        const insertId = (result as any)?.insertId;

        // Auditoría
        (res.locals as any).audit = {
          action: 'api_key_create',
          table_name: 'api_keys',
          record_pk: insertId,
          entity_table: 'api_keys',
          entity_pk: insertId,
          request_json: { name, role_id },
          response_json: { status: 201, id: insertId }
        };

        trackAction('api_key_created', {
          actor: (req as any).auth?.principalId,
          keyId: insertId,
          name
        });

        // ✅ SOLO SE MUESTRA UNA VEZ
        return res.status(201).json({
          ok: true,
          data: {
            id: insertId,
            name,
            role_id,
            api_key: plaintext, // <-- ÚNICA VEZ
            created_at: new Date().toISOString(),
            status: 'active'
          }
        });

      } catch (err: any) {
        logger.error({ msg: 'Failed to create API key', err });
        return res.status(500).json({ ok: false, error: 'Error al crear API key' });
      }
    }
  );

  // ------------------------------------------------------------------------
  // DELETE /api/v1/api-keys/:id - Revocar API key
  // ------------------------------------------------------------------------
  router.delete(
    '/:id',
    requirePermission('api_keys:delete'),
    async (req: Request, res: Response) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
          return res.status(400).json({ ok: false, error: 'ID inválido' });
        }

        const [checkRows] = await sequelize.query(
          `SELECT id, name, revoked_at FROM api_keys WHERE id = :id LIMIT 1`,
          { replacements: { id } }
        );

        const key = (checkRows as any[])[0];
        if (!key) {
          return res.status(404).json({ ok: false, error: 'API key no encontrada' });
        }

        if (key.revoked_at) {
          return res.status(400).json({ ok: false, error: 'API key ya está revocada' });
        }

        await sequelize.query(
          `UPDATE api_keys SET revoked_at = NOW() WHERE id = :id`,
          { replacements: { id } }
        );

        (res.locals as any).audit = {
          action: 'api_key_revoke',
          table_name: 'api_keys',
          record_pk: id,
          entity_table: 'api_keys',
          entity_pk: id,
          request_json: { id },
          response_json: { status: 200 }
        };

        trackAction('api_key_revoked', {
          actor: (req as any).auth?.principalId,
          keyId: id,
          name: key.name
        });

        return res.json({
          ok: true,
          data: {
            id,
            revoked_at: new Date().toISOString(),
            status: 'revoked'
          }
        });

      } catch (err: any) {
        logger.error({ msg: 'Failed to revoke API key', err });
        return res.status(500).json({ ok: false, error: 'Error al revocar API key' });
      }
    }
  );

  return router;
}