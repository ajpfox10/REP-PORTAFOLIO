'use strict';

/**
 * Admin user management routes.
 *
 * POST   /admin/users              → crear usuario staff + enviar welcome email
 * GET    /admin/users              → listar usuarios del org
 * PATCH  /admin/users/:id/deactivate → desactivar cuenta + revocar sesiones
 *
 * Requiere rol org_admin o superadmin (inyectado por gateway en X-User-Roles).
 */

const { Router }  = require('express');
const { body, param, validationResult } = require('express-validator');
const crypto      = require('crypto');
const db          = require('../../../../shared/db');
const R           = require('../../../../shared/response');
const passwordHash = require('../../../../shared/passwordHash');
const { requireInternalSig } = require('../../../../shared/internalAuth');
const { getRedisSingleton }   = require('../../../../shared/redis');
const { enqueueJob }         = require('../../../../shared/notificationRetry');
const { fromHeaders }        = require('../../../../shared/requestContext');

const router = Router();

async function revokeUserSessions(userId) {
  const sessions = await db.query(
    `SELECT jti FROM sessions
     WHERE user_id = :userId AND is_revoked = FALSE AND jti IS NOT NULL`,
    { userId }
  );
  await db.callProc('sp_revoke_user_sessions', [userId]);
  try {
    const redis = await getRedisSingleton('auth-admin-users', 'auth-admin-users');
    if (redis?.isReady) {
      await Promise.all(sessions.map(({ jti }) => redis.setEx(`revoked:${jti}`, 15 * 60, '1')));
    }
  } catch {
    // The periodic auth revocation sync remains the fallback if Redis is degraded.
  }
}

function isSuperAdmin(req) {
  return Array.isArray(req.user?.roles) && req.user.roles.includes('superadmin');
}

function canAssignRole(req, roleName) {
  if (roleName !== 'superadmin') return true;
  return isSuperAdmin(req);
}

function forbiddenRoleAssignment(res, roleName) {
  return R.forbidden(res, `No tiene permisos para asignar el rol '${roleName}'`);
}

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return R.badRequest(res, 'Validation failed', errors.array());
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.authType === 'api_key') {
    return R.forbidden(res, 'Admin endpoints require an interactive user session');
  }
  if (!req.user.roles.some(r => ['superadmin', 'org_admin'].includes(r))) {
    return R.forbidden(res, 'Se requiere rol org_admin o superadmin');
  }
  next();
}

async function auditPermissionChange(req, {
  targetUserId = null,
  targetRoleName = null,
  actionType,
  previousValue = null,
  newValue = null,
}) {
  await db.query(
    `INSERT INTO permission_change_audit
       (org_id, actor_id, target_user_id, change_type, detail_json, ip_address)
     VALUES
       (:orgId, :actorId, :targetUserId, :changeType, :detail, :ipAddress)`,
    {
      orgId      : req.user.orgId,
      actorId    : req.user.userId || null,
      targetUserId,
      changeType : actionType,
      detail     : JSON.stringify({ targetRoleName, previousValue: previousValue || null, newValue: newValue || null, requestId: req.headers['x-request-id'] || null }),
      ipAddress  : req.ip || null,
    }
  ).catch(() => {});
}

// ── POST /admin/users ─────────────────────────────────────────────────────────
router.post('/users',
  requireInternalSig,
  fromHeaders,
  requireAdmin,
  body('firstName').notEmpty().trim().isLength({ max: 60 }),
  body('lastName').notEmpty().trim().isLength({ max: 60 }),
  body('email').isEmail().normalizeEmail(),
  body('role').notEmpty().isLength({ max: 40 }),
  body('branchId').isInt({ min: 1 }),
  body('phone').optional().isMobilePhone('any'),
  body('licenseNumber').optional().isLength({ max: 40 }),
  validate,
  async (req, res, next) => {
    try {
      const { firstName, lastName, email, role, branchId, licenseNumber, phone } = req.body;

      // Email no debe estar en uso
      const existing = await db.queryOne(
        `SELECT id FROM users WHERE email = :email`,
        { email }
      );
      if (existing) return R.conflict(res, 'Ya existe un usuario con ese email');

      // Sucursal debe pertenecer al mismo org del admin
      const branch = await db.queryOne(
        `SELECT b.id, o.name AS org_name FROM branches b
         JOIN organizations o ON b.organization_id = o.id
         WHERE b.id = :branchId AND b.organization_id = :orgId`,
        { branchId, orgId: req.user.orgId }
      );
      if (!branch) return R.badRequest(res, 'Sucursal inválida o no pertenece a su organización');

      // Rol debe existir
      const roleRow = await db.queryOne(
        `SELECT id FROM roles WHERE name = :name`, { name: role }
      );
      if (!roleRow) return R.badRequest(res, `Rol '${role}' no existe`);
      if (!canAssignRole(req, role)) return forbiddenRoleAssignment(res, role);

      // Generar contraseña temporal segura (12 chars base64url)
      const tempPassword = crypto.randomBytes(9).toString('base64url');
      const tempPasswordHash = await passwordHash.hash(tempPassword);

      const userId = await db.transaction(async (conn) => {
        const [r] = await conn.execute(
          `INSERT INTO users
             (username, first_name, last_name, email, password_hash, branch_id,
              license_number, phone, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(), NOW())`,
          [String(email).slice(0, 100), firstName, lastName, email, tempPasswordHash, branchId,
           licenseNumber || null, phone || null]
        );
        const uid = r.insertId;

        await conn.execute(
          `INSERT INTO user_roles (user_id, role_id, is_active, assigned_by, assigned_at)
           VALUES (?, ?, 1, ?, NOW())`,
          [uid, roleRow.id, req.user.userId || null]
        );

        return uid;
      });

      // Enviar email de bienvenida con contraseña temporal (fire-and-forget)
      enqueueJob({
        channel: 'email',
        payload: {
          kind: 'welcome',
          to: email,
          name: `${firstName} ${lastName}`,
          orgName: branch.org_name,
          tempPassword,
        },
        createdBy: req.user.userId || null,
        orgId: req.user.orgId,
        branchId,
      }).catch(() => {});

      await auditPermissionChange(req, {
        targetUserId: userId,
        targetRoleName: role,
        actionType: 'user_role_assigned',
        newValue: { role, branchId },
      });

      return R.created(res, {
        id:      userId,
        message: 'Usuario creado. Se envió email de bienvenida con contraseña temporal.',
      });
    } catch (e) { next(e); }
  }
);

// ── GET /admin/users ──────────────────────────────────────────────────────────
router.get('/users',
  requireInternalSig,
  fromHeaders,
  requireAdmin,
  async (req, res, next) => {
    try {
      // BUG-FIX: cap en limit para evitar dump masivo de registros (DoS/exfiltración).
      const MAX_LIMIT = 200;
      const rawPage  = Math.max(1, parseInt(req.query.page, 10)  || 1);
      const rawLimit = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.query.limit, 10) || 50));
      const { isActive } = req.query;
      const offset = (rawPage - 1) * rawLimit;
      const conds  = ['b.organization_id = :orgId', 'u.deleted_at IS NULL'];
      const params = { orgId: req.user.orgId, limit: rawLimit, offset };
      const page   = rawPage;
      const limit  = rawLimit;

      if (isActive !== undefined) {
        conds.push('u.is_active = :isActive');
        params.isActive = isActive === 'true' ? 1 : 0;
      }

      const countParams = { orgId: req.user.orgId };
      if (params.isActive !== undefined) countParams.isActive = params.isActive;

      const [users, [{ total }]] = await Promise.all([
        db.query(
          `SELECT u.id, u.first_name, u.last_name, u.email, u.phone,
                  u.license_number, u.is_active, u.created_at,
                  b.name AS branch_name,
                  GROUP_CONCAT(r.name ORDER BY r.name SEPARATOR ',') AS roles
           FROM users u
           JOIN branches b ON u.branch_id = b.id
           LEFT JOIN user_roles ur ON ur.user_id = u.id AND ur.is_active = 1
           LEFT JOIN roles r ON r.id = ur.role_id
           WHERE ${conds.join(' AND ')}
           GROUP BY u.id
           ORDER BY u.last_name, u.first_name
           LIMIT :limit OFFSET :offset`,
          params
        ),
        db.query(
          `SELECT COUNT(DISTINCT u.id) AS total
           FROM users u JOIN branches b ON u.branch_id = b.id
           WHERE ${conds.join(' AND ')}`,
          countParams
        ),
      ]);

      return R.paginated(res, users, total, page, limit);
    } catch (e) { next(e); }
  }
);

// ── PATCH /admin/users/:id/deactivate ─────────────────────────────────────────
router.patch('/users/:id/deactivate',
  requireInternalSig,
  fromHeaders,
  requireAdmin,
  param('id').isInt({ min: 1 }),
  validate,
  async (req, res, next) => {
    try {
      if (String(req.params.id) === String(req.user.userId)) {
        return R.badRequest(res, 'No puede desactivar su propia cuenta');
      }

      const user = await db.queryOne(
        `SELECT u.id FROM users u
         JOIN branches b ON u.branch_id = b.id
         WHERE u.id = :id AND b.organization_id = :orgId AND u.deleted_at IS NULL`,
        { id: req.params.id, orgId: req.user.orgId }
      );
      if (!user) return R.notFound(res, 'Usuario no encontrado');

      await db.query(
        `UPDATE users SET is_active = 0, deleted_at = NOW(), updated_at = NOW() WHERE id = :id`,
        { id: req.params.id }
      );
      await revokeUserSessions(req.params.id);

      await auditPermissionChange(req, {
        targetUserId: Number(req.params.id),
        actionType: 'user_role_revoked',
        previousValue: { isActive: true },
        newValue: { isActive: false },
      });

      return R.noContent(res);
    } catch (e) { next(e); }
  }
);

router.patch('/users/:id/role',
  requireInternalSig,
  fromHeaders,
  requireAdmin,
  param('id').isInt({ min: 1 }),
  body('role').notEmpty().isLength({ max: 40 }),
  validate,
  async (req, res, next) => {
    try {
      const targetUserId = Number(req.params.id);
      const { role } = req.body;

      const targetUser = await db.queryOne(
        `SELECT u.id
         FROM users u
         JOIN branches b ON u.branch_id = b.id
         WHERE u.id = :id AND b.organization_id = :orgId AND u.deleted_at IS NULL`,
        { id: targetUserId, orgId: req.user.orgId }
      );
      if (!targetUser) return R.notFound(res, 'Usuario no encontrado');

      const newRole = await db.queryOne(`SELECT id, name FROM roles WHERE name = :name`, { name: role });
      if (!newRole) return R.badRequest(res, `Rol '${role}' no existe`);

      const activeRoles = await db.query(
        `SELECT ur.role_id, r.name
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
         WHERE ur.user_id = :userId AND ur.is_active = 1`,
        { userId: targetUserId }
      );
      const previousRoles = activeRoles.map(r => r.name);
      if (!isSuperAdmin(req) && previousRoles.includes('superadmin')) {
        return R.forbidden(res, 'No tiene permisos para modificar usuarios superadmin');
      }
      if (!canAssignRole(req, role)) return forbiddenRoleAssignment(res, role);

      await db.transaction(async (conn) => {
        await conn.query(
          `UPDATE user_roles
           SET is_active = 0
           WHERE user_id = :userId AND is_active = 1`,
          { userId: targetUserId }
        );
        await conn.query(
          `INSERT INTO user_roles (user_id, role_id, is_active, assigned_by, assigned_at)
           VALUES (:userId, :roleId, 1, :assignedBy, NOW())`,
          { userId: targetUserId, roleId: newRole.id, assignedBy: req.user.userId || null }
        );
      });
      await revokeUserSessions(targetUserId);

      await auditPermissionChange(req, {
        targetUserId,
        targetRoleName: role,
        actionType: 'user_role_changed',
        previousValue: { roles: previousRoles },
        newValue: { roles: [role] },
      });

      return R.ok(res, { userId: targetUserId, role });
    } catch (e) { next(e); }
  }
);

module.exports = router;
