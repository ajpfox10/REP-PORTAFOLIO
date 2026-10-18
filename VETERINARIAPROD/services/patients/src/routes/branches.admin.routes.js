'use strict';

const { Router } = require('express');
const { body, db, R, validate, logBranchesError } = require('./branches.common');
const subscriptions = require('../../../../shared/subscriptions');

const router = Router();

const ADMIN_ROLES = ['org_admin', 'superadmin'];

function requireOrgAdmin(req, res, next) {
  if (!(req.user?.roles || []).some((role) => ADMIN_ROLES.includes(role))) {
    return R.forbidden(res, 'Solo un administrador de la organización puede gestionar sucursales');
  }
  return next();
}

const branchFields = [
  body('name').optional().isString().trim().isLength({ min: 2, max: 120 }),
  body('address').optional({ values: 'null' }).isString().trim().isLength({ max: 255 }),
  body('phone').optional({ values: 'null' }).isString().trim().isLength({ max: 40 }),
  body('email').optional({ values: 'falsy' }).isEmail().isLength({ max: 191 }),
  body('timezone').optional().isString().trim().isLength({ max: 64 }),
];

async function rejectIfNoSeat(req, res) {
  const seats = await subscriptions.checkSeatLimit(req.user.orgId, 'branches');
  if (seats.allowed) return false;
  R.error(res, 402, subscriptions.seatLimitMessage('branches', seats),
    { limit: seats.limit, current: seats.current }, 'PLAN_LIMIT_REACHED');
  return true;
}

router.post('/',
  requireOrgAdmin,
  body('name').isString().trim().isLength({ min: 2, max: 120 }),
  ...branchFields,
  validate,
  async (req, res, next) => {
    try {
      if (await rejectIfNoSeat(req, res)) return;
      const { name, address, phone, email, timezone } = req.body;
      const [result] = await db.query(
        `INSERT INTO branches (organization_id, name, address, phone, email, timezone, is_active)
         VALUES (:orgId, :name, :address, :phone, :email, :timezone, 1)`,
        {
          orgId: req.user.orgId,
          name,
          address: address || null,
          phone: phone || null,
          email: email || null,
          timezone: timezone || process.env.DEFAULT_BRANCH_TIMEZONE || 'America/Argentina/Buenos_Aires',
        }
      );
      return R.created(res, { id: result.insertId });
    } catch (e) {
      logBranchesError('POST /branches', e, { orgId: req.user?.orgId });
      next(e);
    }
  }
);

router.put('/:id(\\d+)',
  requireOrgAdmin,
  ...branchFields,
  body('isActive').optional().isBoolean(),
  validate,
  async (req, res, next) => {
    try {
      const branch = await db.queryOne(
        'SELECT id, is_active FROM branches WHERE id = :id AND organization_id = :orgId',
        { id: req.params.id, orgId: req.user.orgId }
      );
      if (!branch) return R.notFound(res);

      const activating = req.body.isActive === true && !branch.is_active;
      if (activating && await rejectIfNoSeat(req, res)) return;
      if (req.body.isActive === false) {
        const active = await db.queryOne(
          'SELECT COUNT(*) AS total FROM branches WHERE organization_id = :orgId AND is_active = 1',
          { orgId: req.user.orgId }
        );
        if (Number(active?.total || 0) <= 1 && branch.is_active) {
          return R.badRequest(res, 'La organización necesita al menos una sucursal activa');
        }
      }

      const columns = { name: 'name', address: 'address', phone: 'phone', email: 'email', timezone: 'timezone' };
      const fields = [];
      const params = { id: req.params.id };
      for (const [key, column] of Object.entries(columns)) {
        if (req.body[key] === undefined) continue;
        fields.push(`${column} = :${key}`);
        params[key] = req.body[key] || null;
      }
      if (req.body.isActive !== undefined) {
        fields.push('is_active = :isActive');
        params.isActive = req.body.isActive ? 1 : 0;
      }
      if (!fields.length) return R.badRequest(res, 'Sin campos para actualizar');

      await db.query(`UPDATE branches SET ${fields.join(', ')} WHERE id = :id`, params);
      return R.noContent(res);
    } catch (e) {
      logBranchesError('PUT /branches/:id', e, { branchId: req.params.id, orgId: req.user?.orgId });
      next(e);
    }
  }
);

router.get('/', async (req, res, next) => {
  try {
    const rows = await db.query(
      `SELECT b.id, b.name, b.address, b.phone, b.email, b.timezone,
              b.is_active, b.created_at,
              COUNT(DISTINCT u.id) AS staff_count,
              COUNT(DISTINCT cl.id) AS client_count
       FROM branches b
       LEFT JOIN users   u  ON u.branch_id = b.id  AND u.is_active = TRUE
       LEFT JOIN clients cl ON cl.branch_id = b.id AND cl.is_active = TRUE
       WHERE b.organization_id = :orgId
       GROUP BY b.id ORDER BY b.name`,
      { orgId: req.user.orgId }
    );
    return R.ok(res, rows);
  } catch (e) {
    logBranchesError('GET /branches', e, { orgId: req.user?.orgId });
    next(e);
  }
});

router.get('/:id(\\d+)', async (req, res, next) => {
  try {
    const branch = await db.queryOne(
      `SELECT b.*, o.name AS org_name
       FROM branches b JOIN organizations o ON b.organization_id = o.id
       WHERE b.id = :id AND b.organization_id = :orgId`,
      { id: req.params.id, orgId: req.user.orgId }
    );
    if (!branch) return R.notFound(res);

    const [settings, kpis] = await Promise.all([
      db.queryOne('SELECT * FROM branch_integration_settings WHERE branch_id = :id', { id: req.params.id }),
      db.queryOne('SELECT * FROM v_branch_daily_kpis WHERE branch_id = :id', { id: req.params.id })
        .catch((kpiError) => {
          logBranchesError('GET /branches/:id kpis', kpiError, { branchId: req.params.id, orgId: req.user?.orgId });
          return null;
        }),
    ]);

    return R.ok(res, { ...branch, integrationSettings: settings, kpis });
  } catch (e) {
    logBranchesError('GET /branches/:id', e, { branchId: req.params.id, orgId: req.user?.orgId });
    next(e);
  }
});

router.patch('/:id/settings', async (req, res, next) => {
  try {
    const branch = await db.queryOne(
      'SELECT id FROM branches WHERE id=:id AND organization_id=:orgId',
      { id: req.params.id, orgId: req.user.orgId }
    );
    if (!branch) return R.notFound(res);

    const {
      sharePatientHistory = 1,
      shareInventoryView = 1,
      allowStockTransfers = 1,
      allowPatientTransfers = 1,
      requireTransferApproval = 0,
    } = req.body;

    await db.query(
      `INSERT INTO branch_integration_settings
         (branch_id, share_patient_history, share_inventory_view,
          allow_stock_transfers, allow_patient_transfers, require_transfer_approval)
       VALUES (:bid, :sph, :siv, :ast, :apt, :rta)
       ON DUPLICATE KEY UPDATE
         share_patient_history    = VALUES(share_patient_history),
         share_inventory_view     = VALUES(share_inventory_view),
         allow_stock_transfers    = VALUES(allow_stock_transfers),
         allow_patient_transfers  = VALUES(allow_patient_transfers),
         require_transfer_approval = VALUES(require_transfer_approval)`,
      {
        bid: req.params.id,
        sph: sharePatientHistory ? 1 : 0,
        siv: shareInventoryView ? 1 : 0,
        ast: allowStockTransfers ? 1 : 0,
        apt: allowPatientTransfers ? 1 : 0,
        rta: requireTransferApproval ? 1 : 0,
      }
    );
    return R.noContent(res);
  } catch (e) {
    logBranchesError('PATCH /branches/:id/settings', e, { branchId: req.params.id, orgId: req.user?.orgId, body: req.body });
    next(e);
  }
});

module.exports = router;
