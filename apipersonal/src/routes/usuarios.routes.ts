/**
 * @file routes/usuarios.routes.ts
 * @description CRUD de usuarios del sistema (solo admin).
 *
 * Endpoints:
 *   GET    /usuarios              Listar usuarios (paginado, filtrable)
 *   POST   /usuarios              Crear nuevo usuario
 *   GET    /usuarios/:id          Obtener usuario por ID
 *   PATCH  /usuarios/:id          Actualizar datos del usuario
 *   PATCH  /usuarios/:id/estado   Activar / desactivar / bloquear
 *   DELETE /usuarios/:id          Soft-delete
 *   GET    /usuarios/:id/roles    Roles asignados
 *   POST   /usuarios/:id/roles    Asignar rol
 *   DELETE /usuarios/:id/roles/:rolId  Quitar rol
 */

import { Router, Request, Response } from 'express';
import { Sequelize, QueryTypes } from 'sequelize';
import { z } from 'zod';
import { requirePermission } from '../middlewares/rbacCrud';
import { hashPassword, verifyPassword } from '../auth/password';
import { revokeAllRefreshTokensForUser } from '../auth/refreshTokensRepo';
import { logger } from '../logging/logger';
import { trackAction } from '../logging/track';
import { sendEmail } from '../services/email.service';

// ── Schemas ───────────────────────────────────────────────────────────────────
const createUserSchema = z.object({
  email:    z.string().email('Email inválido').max(190),
  nombre:   z.string().min(1).max(190).trim(),
  password: z.string().min(8, 'Mínimo 8 caracteres'),
  rol_id:   z.number().int().positive().optional(),
  estado:   z.enum(['activo','inactivo','bloqueado']).default('activo'),
});

const patchUserSchema = z.object({
  email:        z.string().email().max(190).optional(),
  nombre:       z.string().min(1).max(190).trim().optional(),
  sector_id:    z.number().int().positive().nullable().optional(),
  jefatura_id:  z.number().int().positive().nullable().optional(),
}).strict();

const estadoSchema = z.object({
  estado: z.enum(['activo','inactivo','bloqueado']),
});

const asignarRolSchema = z.object({
  rol_id: z.number().int().positive(),
});

export function buildUsuariosRouter(sequelize: Sequelize) {
  const router = Router();

  // ── GET /usuarios ─────────────────────────────────────────────────────────
  router.get(
    '/',
    requirePermission('admin:read'),
    async (req: Request, res: Response) => {
      const page   = Math.max(1, parseInt(String(req.query.page || '1'), 10));
      const limit  = Math.min(100, parseInt(String(req.query.limit || '20'), 10) || 20);
      const offset = (page - 1) * limit;
      const q      = req.query.q ? `%${String(req.query.q).trim()}%` : null;
      const estado = req.query.estado ? String(req.query.estado) : null;

      const where: string[] = ['u.deleted_at IS NULL'];
      const repl: any = { limit, offset };

      if (q) { where.push('(u.email LIKE :q OR u.nombre LIKE :q)'); repl.q = q; }
      if (estado) { where.push('u.estado = :estado'); repl.estado = estado; }

      const whereStr = where.join(' AND ');

      try {
        const [rows, countRows] = await Promise.all([
          sequelize.query(`
            SELECT u.id, u.email, u.nombre, u.estado, u.created_at,
                   u.sector_id, rep.reparticion_nombre AS sector_nombre,
                   MIN(ur.rol_id) AS rol_id,
                   GROUP_CONCAT(r.nombre SEPARATOR ', ') AS roles
            FROM usuarios u
            LEFT JOIN usuarios_roles ur ON ur.usuario_id = u.id AND ur.deleted_at IS NULL
            LEFT JOIN roles r           ON r.id = ur.rol_id AND r.deleted_at IS NULL
            LEFT JOIN reparticiones rep ON rep.id = u.sector_id
            WHERE ${whereStr}
            GROUP BY u.id
            ORDER BY u.nombre ASC
            LIMIT :limit OFFSET :offset
          `, { replacements: repl, type: QueryTypes.SELECT }),
          sequelize.query(`SELECT COUNT(1) AS total FROM usuarios u WHERE ${whereStr}`,
            { replacements: repl, type: QueryTypes.SELECT }),
        ]);

        const total = Number((countRows as any[])[0]?.total ?? 0);
        return res.json({ ok: true, data: rows, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } });
      } catch (err: any) {
        return res.status(500).json({ ok: false, error: err?.message });
      }
    }
  );

  // ── POST /usuarios ────────────────────────────────────────────────────────
  router.post(
    '/',
    requirePermission('admin:write'),
    async (req: Request, res: Response) => {
      const parsed = createUserSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ ok: false, error: 'Datos inválidos', details: parsed.error.flatten() });
      }

      const { email, nombre, password, rol_id, estado } = parsed.data;

      // Verificar email único
      const [existing] = await sequelize.query(
        'SELECT id FROM usuarios WHERE email = :email AND deleted_at IS NULL LIMIT 1',
        { replacements: { email }, type: QueryTypes.SELECT }
      );
      if ((existing as any[]).length) {
        return res.status(409).json({ ok: false, error: 'El email ya está en uso' });
      }

      const t = await sequelize.transaction();
      try {
        const passwordHash = await hashPassword(password);

        const [result] = await sequelize.query(`
          INSERT INTO usuarios (email, nombre, password, estado, created_at)
          VALUES (:email, :nombre, :passwordHash, :estado, NOW())
        `, { replacements: { email, nombre, passwordHash, estado }, transaction: t });

        const userId = (result as any).insertId;

        if (rol_id) {
          await sequelize.query(
            'INSERT INTO usuarios_roles (usuario_id, rol_id, created_at) VALUES (:userId, :rol_id, NOW())',
            { replacements: { userId, rol_id }, transaction: t }
          );
        }

        await t.commit();

        // Enviar email de bienvenida al nuevo usuario
        sendEmail({
          to: email,
          subject: 'Tu cuenta ha sido creada',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background-color: #2E5FA3; padding: 30px; text-align: center;">
                <h1 style="color: #ffffff; margin: 0;">Cuenta Creada</h1>
              </div>
              <div style="padding: 30px; background-color: #ffffff;">
                <p style="font-size: 16px; color: #333;">Hola <b>${nombre}</b>,</p>
                <p style="font-size: 16px; color: #333;">Tu cuenta en el sistema ha sido creada exitosamente.</p>
                <table style="width:100%; border-collapse: collapse; margin: 20px 0;">
                  <tr><td style="padding: 8px; color: #666;">Usuario:</td><td style="padding: 8px;"><b>${email}</b></td></tr>
                  <tr><td style="padding: 8px; color: #666;">Estado:</td><td style="padding: 8px;"><b>${estado}</b></td></tr>
                </table>
                <p style="font-size: 14px; color: #666;">Por seguridad, te recomendamos cambiar tu contraseña al ingresar por primera vez.</p>
              </div>
              <div style="padding: 15px; background-color: #f8f8f8; text-align: center; font-size: 12px; color: #999;">
                Este es un correo automático, por favor no respondas a este mensaje.
              </div>
            </div>
          `,
          text: `Hola ${nombre},\n\nTu cuenta ha sido creada.\nUsuario: ${email}\nEstado: ${estado}\n\nTe recomendamos cambiar tu contraseña al ingresar por primera vez.`,
        }).catch(err => logger.warn({ msg: 'No se pudo enviar email de alta', email, error: err?.message }));

        (res.locals as any).audit = { action: 'usuario_create', table_name: 'usuarios', record_pk: userId, request_json: { email, nombre, rol_id, estado } };

        logger.info({ msg: 'Usuario creado', userId, email, actor: (req as any).auth?.principalId });
        return res.status(201).json({ ok: true, data: { id: userId, email, nombre, estado } });
      } catch (err: any) {
        await t.rollback().catch(() => {});
        return res.status(500).json({ ok: false, error: err?.message });
      }
    }
  );

  // ── GET /usuarios/:id ─────────────────────────────────────────────────────
  router.get(
    '/:id',
    requirePermission('admin:read'),
    async (req: Request, res: Response) => {
      const id = parseInt(req.params.id, 10);
      if (!id) return res.status(400).json({ ok: false, error: 'ID inválido' });

      const rows = await sequelize.query(`
        SELECT u.id, u.email, u.nombre, u.estado, u.created_at,
               JSON_ARRAYAGG(JSON_OBJECT('id', r.id, 'nombre', r.nombre)) AS roles_json
        FROM usuarios u
        LEFT JOIN usuarios_roles ur ON ur.usuario_id = u.id AND ur.deleted_at IS NULL
        LEFT JOIN roles r           ON r.id = ur.rol_id AND r.deleted_at IS NULL
        WHERE u.id = :id AND u.deleted_at IS NULL
        GROUP BY u.id
        LIMIT 1
      `, { replacements: { id }, type: QueryTypes.SELECT });

      if (!(rows as any[]).length) {
        return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });
      }

      const user = (rows as any[])[0];
      // Parse roles JSON
      try {
        user.roles = typeof user.roles_json === 'string' ? JSON.parse(user.roles_json) : user.roles_json;
        user.roles = (user.roles || []).filter((r: any) => r.id !== null);
      } catch { user.roles = []; }
      delete user.roles_json;

      return res.json({ ok: true, data: user });
    }
  );

  // ── PATCH /usuarios/:id ───────────────────────────────────────────────────
  router.patch(
    '/:id',
    requirePermission('admin:write'),
    async (req: Request, res: Response) => {
      const id = parseInt(req.params.id, 10);
      if (!id) return res.status(400).json({ ok: false, error: 'ID inválido' });

      const parsed = patchUserSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });
      if (!Object.keys(parsed.data).length) return res.status(400).json({ ok: false, error: 'Sin campos para actualizar' });

      const setCols = Object.keys(parsed.data).map(k => `${k} = :${k}`).join(', ');
      await sequelize.query(
        `UPDATE usuarios SET ${setCols} WHERE id = :id AND deleted_at IS NULL`,
        { replacements: { ...parsed.data, id } }
      );

      return res.json({ ok: true, message: 'Usuario actualizado' });
    }
  );

  // ── PATCH /usuarios/:id/estado ────────────────────────────────────────────
  router.patch(
    '/:id/estado',
    requirePermission('admin:write'),
    async (req: Request, res: Response) => {
      const id = parseInt(req.params.id, 10);
      if (!id) return res.status(400).json({ ok: false, error: 'ID inválido' });

      const parsed = estadoSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

      await sequelize.query(
        'UPDATE usuarios SET estado = :estado WHERE id = :id AND deleted_at IS NULL',
        { replacements: { estado: parsed.data.estado, id } }
      );

      // Si se bloquea o desactiva, revocar todos los tokens activos
      if (parsed.data.estado !== 'activo') {
        await revokeAllRefreshTokensForUser(sequelize, id).catch(() => {});
      }

      (res.locals as any).audit = { action: 'usuario_estado', table_name: 'usuarios', record_pk: id, request_json: parsed.data };
      logger.info({ msg: 'Estado usuario cambiado', id, estado: parsed.data.estado, actor: (req as any).auth?.principalId });

      return res.json({ ok: true, message: `Usuario ${parsed.data.estado}` });
    }
  );

  // ── PATCH /usuarios/:id/password ─────────────────────────────────────────
  router.patch(
    '/:id/password',
    requirePermission('admin:write'),
    async (req: Request, res: Response) => {
      const id = parseInt(req.params.id, 10);
      if (!id) return res.status(400).json({ ok: false, error: 'ID inválido' });

      const parsed = z.object({
        password: z.string().min(8, 'Mínimo 8 caracteres'),
      }).safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

      try {
        const passwordHash = await hashPassword(parsed.data.password);
        await sequelize.query(
          'UPDATE usuarios SET password = :passwordHash WHERE id = :id AND deleted_at IS NULL',
          { replacements: { passwordHash, id } }
        );
        await revokeAllRefreshTokensForUser(sequelize, id).catch(() => {});

        (res.locals as any).audit = { action: 'usuario_password_reset', table_name: 'usuarios', record_pk: id };
        logger.info({ msg: 'Contraseña reseteada', id, actor: (req as any).auth?.principalId });

        return res.json({ ok: true, message: 'Contraseña actualizada' });
      } catch (err: any) {
        return res.status(500).json({ ok: false, error: err?.message });
      }
    }
  );

  // ── DELETE /usuarios/:id ──────────────────────────────────────────────────
  router.delete(
    '/:id',
    requirePermission('admin:write'),
    async (req: Request, res: Response) => {
      const id = parseInt(req.params.id, 10);
      if (!id) return res.status(400).json({ ok: false, error: 'ID inválido' });

      // No borrar el propio usuario
      if ((req as any).auth?.principalId === id) {
        return res.status(400).json({ ok: false, error: 'No podés eliminarte a vos mismo' });
      }

      await sequelize.query(
        'UPDATE usuarios SET deleted_at = NOW(), estado = \'inactivo\' WHERE id = :id AND deleted_at IS NULL',
        { replacements: { id } }
      );
      await revokeAllRefreshTokensForUser(sequelize, id).catch(() => {});

      (res.locals as any).audit = { action: 'usuario_delete', table_name: 'usuarios', record_pk: id };
      return res.json({ ok: true, message: 'Usuario eliminado' });
    }
  );

  // ── GET /usuarios/:id/roles ───────────────────────────────────────────────
  router.get(
    '/:id/roles',
    requirePermission('admin:read'),
    async (req: Request, res: Response) => {
      const id = parseInt(req.params.id, 10);
      if (!id) return res.status(400).json({ ok: false, error: 'ID inválido' });

      const rows = await sequelize.query(`
        SELECT r.id, r.nombre, r.descripcion, ur.created_at AS asignado_en
        FROM usuarios_roles ur
        JOIN roles r ON r.id = ur.rol_id AND r.deleted_at IS NULL
        WHERE ur.usuario_id = :id AND ur.deleted_at IS NULL
        ORDER BY r.nombre ASC
      `, { replacements: { id }, type: QueryTypes.SELECT });

      return res.json({ ok: true, data: rows });
    }
  );

  // ── POST /usuarios/:id/roles ──────────────────────────────────────────────
  router.post(
    '/:id/roles',
    requirePermission('admin:write'),
    async (req: Request, res: Response) => {
      const id = parseInt(req.params.id, 10);
      if (!id) return res.status(400).json({ ok: false, error: 'ID inválido' });

      const parsed = asignarRolSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

      try {
        await sequelize.query(
          `INSERT INTO usuarios_roles (usuario_id, rol_id, created_at)
           VALUES (:id, :rol_id, NOW())
           ON DUPLICATE KEY UPDATE deleted_at = NULL, created_at = NOW()`,
          { replacements: { id, rol_id: parsed.data.rol_id } }
        );
        return res.status(201).json({ ok: true, message: 'Rol asignado' });
      } catch (err: any) {
        return res.status(400).json({ ok: false, error: err?.message });
      }
    }
  );

  // ── DELETE /usuarios/:id/roles/:rolId ─────────────────────────────────────
  router.delete(
    '/:id/roles/:rolId',
    requirePermission('admin:write'),
    async (req: Request, res: Response) => {
      const id    = parseInt(req.params.id, 10);
      const rolId = parseInt(req.params.rolId, 10);
      if (!id || !rolId) return res.status(400).json({ ok: false, error: 'IDs inválidos' });

      await sequelize.query(
        'UPDATE usuarios_roles SET deleted_at = NOW() WHERE usuario_id = :id AND rol_id = :rolId AND deleted_at IS NULL',
        { replacements: { id, rolId } }
      );

      return res.json({ ok: true, message: 'Rol quitado' });
    }
  );

  return router;
}
