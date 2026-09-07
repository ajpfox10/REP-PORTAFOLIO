'use strict';

const { Router } = require('express');
const { body, db, R, validate, logBranchesError } = require('./branches.common');

const router = Router();

router.get('/access', async (req, res, next) => {
  try {
    const rows = await db.query(
      `SELECT cba.*, b.name AS branch_name,
              CONCAT(u.first_name,' ',u.last_name) AS granted_by_name
       FROM cross_branch_access cba
       JOIN branches b ON cba.branch_id = b.id
       JOIN users    u ON cba.granted_by = u.id
       WHERE cba.user_id = :uid AND cba.is_active = TRUE
         AND (cba.valid_until IS NULL OR cba.valid_until > NOW())
       ORDER BY b.name`,
      { uid: req.user.userId }
    );
    return R.ok(res, rows);
  } catch (e) {
    logBranchesError('GET /branches/access', e, { userId: req.user?.userId, orgId: req.user?.orgId });
    next(e);
  }
});

router.post('/access',
  body('userId').isInt(),
  body('branchId').isInt(),
  validate,
  async (req, res, next) => {
    try {
      const { userId, branchId, validUntil, reason } = req.body;

      const branch = await db.queryOne(
        'SELECT id FROM branches WHERE id=:id AND organization_id=:orgId',
        { id: branchId, orgId: req.user.orgId }
      );
      if (!branch) return R.notFound(res, 'Sucursal no encontrada en el org');

      // OT-SEC: verificar que el usuario objetivo pertenece a la misma organización
      // para evitar conceder acceso a usuarios de otra org.
      const targetUser = await db.queryOne(
        `SELECT u.id FROM users u
         JOIN branches b ON u.branch_id = b.id
         WHERE u.id = :uid AND b.organization_id = :orgId`,
        { uid: userId, orgId: req.user.orgId }
      );
      if (!targetUser) return R.notFound(res, 'Usuario no encontrado en la organización');

      const [r] = await db.query(
        `INSERT INTO cross_branch_access (user_id, branch_id, granted_by, valid_until, reason)
         VALUES (:uid, :bid, :gby, :until, :reason)
         ON DUPLICATE KEY UPDATE
           is_active = 1, valid_until = VALUES(valid_until),
           granted_by = VALUES(granted_by), reason = VALUES(reason)`,
        {
          uid: userId,
          bid: branchId,
          gby: req.user.userId,
          until: validUntil || null,
          reason: reason || null,
        }
      );
      return R.created(res, { id: r.insertId });
    } catch (e) {
      logBranchesError('POST /branches/access', e, { userId: req.user?.userId, orgId: req.user?.orgId, body: req.body });
      next(e);
    }
  }
);

router.delete('/access/:id', async (req, res, next) => {
  try {
    const row = await db.queryOne(
      `SELECT cba.id FROM cross_branch_access cba
       JOIN branches b ON cba.branch_id = b.id
       WHERE cba.id = :id AND b.organization_id = :orgId`,
      { id: req.params.id, orgId: req.user.orgId }
    );
    if (!row) return R.notFound(res, 'Acceso no encontrado');
    await db.query(
      `UPDATE cross_branch_access SET is_active=0 WHERE id=:id`,
      { id: req.params.id }
    );
    return R.noContent(res);
  } catch (e) {
    logBranchesError('DELETE /branches/access/:id', e, { accessId: req.params.id, orgId: req.user?.orgId });
    next(e);
  }
});

module.exports = router;
