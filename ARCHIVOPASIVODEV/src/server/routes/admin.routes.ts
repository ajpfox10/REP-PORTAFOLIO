import { Router } from "express";
import { z } from "zod";
import { hashPassword } from "../auth/password.js";
import { query } from "../db/pool.js";
import { authContext } from "../middlewares/authContext.js";
import { requirePermission } from "../middlewares/rbac.js";

const router = Router();

router.use(authContext);

const createUserSchema = z.object({
  username: z.string().min(3).max(80),
  email: z.string().email(),
  nombre: z.string().min(3).max(160),
  password: z.string().min(4),
  rol_id: z.coerce.number().int().positive(),
  activo: z.coerce.boolean().default(true),
});

const updateUserSchema = z.object({
  nombre: z.string().min(3).max(160).optional(),
  rol_id: z.coerce.number().int().positive().optional(),
  activo: z.coerce.boolean().optional(),
});

const resetPasswordSchema = z.object({
  password: z.string().min(4),
});

const rolePermissionsSchema = z.object({
  permisoIds: z.array(z.coerce.number().int().positive()),
});

// Lista roles disponibles para administracion de perfiles.
router.get("/roles", requirePermission("roles:leer"), async (_req, res, next) => {
  try {
    const data = await query(
      `SELECT r.id, r.nombre, r.descripcion,
              COALESCE(JSON_ARRAYAGG(rp.permiso_id), JSON_ARRAY()) AS permiso_ids
         FROM roles r
         LEFT JOIN roles_permisos rp ON rp.rol_id = r.id
        WHERE r.deleted_at IS NULL
        GROUP BY r.id, r.nombre, r.descripcion
        ORDER BY r.nombre`
    );
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
});

// Lista permisos finos registrados en el sistema.
router.get("/permisos", requirePermission("permisos:leer"), async (_req, res, next) => {
  try {
    const data = await query("SELECT id, clave, descripcion FROM permisos WHERE deleted_at IS NULL ORDER BY clave");
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
});

// Lista usuarios sin exponer hashes ni secretos de 2FA.
router.get("/usuarios", requirePermission("usuarios:leer"), async (_req, res, next) => {
  try {
    const data = await query(
      `SELECT u.id, u.username, u.email, u.nombre, u.activo, u.rol_id, r.nombre AS rol_nombre,
              u.two_factor_enabled, u.created_at
         FROM usuarios u
         JOIN roles r ON r.id = u.rol_id
        WHERE u.deleted_at IS NULL
        ORDER BY u.id DESC`
    );
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
});

// Crea un usuario local con un unico rol.
router.post("/usuarios", requirePermission("usuarios:crear"), async (req, res, next) => {
  try {
    const input = createUserSchema.parse(req.body);
    const passwordHash = await hashPassword(input.password);
    await query(
      `INSERT INTO usuarios (username, email, nombre, password_hash, rol_id, activo)
       VALUES (:username, :email, :nombre, :passwordHash, :rolId, :activo)`,
      {
        username: input.username.trim().toLowerCase(),
        email: input.email.trim().toLowerCase(),
        nombre: input.nombre.trim(),
        passwordHash,
        rolId: input.rol_id,
        activo: input.activo ? 1 : 0,
      }
    );
    res.status(201).json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// Actualiza datos administrativos del usuario.
router.patch("/usuarios/:id", requirePermission("usuarios:editar"), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const input = updateUserSchema.parse(req.body);
    await query(
      `UPDATE usuarios
          SET nombre = COALESCE(:nombre, nombre),
              rol_id = COALESCE(:rolId, rol_id),
              activo = COALESCE(:activo, activo),
              token_version = token_version + 1
        WHERE id = :id AND deleted_at IS NULL`,
      {
        id,
        nombre: input.nombre?.trim() ?? null,
        rolId: input.rol_id ?? null,
        activo: typeof input.activo === "boolean" ? (input.activo ? 1 : 0) : null,
      }
    );
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// Resetea una contrasena desde administracion e invalida sesiones previas.
router.post("/usuarios/:id/reset-password", requirePermission("usuarios:editar"), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const input = resetPasswordSchema.parse(req.body);
    await query(
      `UPDATE usuarios
          SET password_hash = :passwordHash,
              token_version = token_version + 1
        WHERE id = :id AND deleted_at IS NULL`,
      { id, passwordHash: await hashPassword(input.password) }
    );
    await query(`UPDATE refresh_tokens SET revoked_at = NOW() WHERE usuario_id = :id AND revoked_at IS NULL`, { id });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// Reemplaza el conjunto de permisos asignados a un rol.
router.patch("/roles/:id/permisos", requirePermission("roles:editar"), async (req, res, next) => {
  try {
    const roleId = Number(req.params.id);
    const input = rolePermissionsSchema.parse(req.body);
    await query(`DELETE FROM roles_permisos WHERE rol_id = :roleId`, { roleId });
    for (const permisoId of Array.from(new Set(input.permisoIds))) {
      await query(
        `INSERT INTO roles_permisos (rol_id, permiso_id) VALUES (:roleId, :permisoId)`,
        { roleId, permisoId }
      );
    }
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// Lista solicitudes de acceso pendientes o confirmadas.
router.get("/solicitudes", requirePermission("solicitudes:leer"), async (_req, res, next) => {
  try {
    const data = await query(
      `SELECT id, email, nombre, motivo, status, confirmed_at, expires_at, created_at
         FROM access_requests
        ORDER BY id DESC
        LIMIT 200`
    );
    res.json({ ok: true, data });
  } catch (error) {
    next(error);
  }
});

export { router as adminRouter };
