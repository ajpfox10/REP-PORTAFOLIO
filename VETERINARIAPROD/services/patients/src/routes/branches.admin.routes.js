'use strict';

const { Router } = require('express');
const { db, R, logBranchesError } = require('./branches.common');

const router = Router();

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
