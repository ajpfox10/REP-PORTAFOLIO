'use strict';

const { Router } = require('express');
const { body, db, R, mb, enqueue, eventBus, validate, logBranchesError } = require('./branches.common');

const router = Router();

router.get('/transfers/patients', async (req, res, next) => {
  try {
    const { status, fromBranch, toBranch, page = 1, limit = 20 } = req.query;
    const parsedLimit = Math.min(parseInt(`${limit}`, 10) || 20, 100);
    const parsedPage  = Math.max(parseInt(`${page}`, 10) || 1, 1);
    const offset = (parsedPage - 1) * parsedLimit;
    const conds = ['bf.organization_id = :orgId'];
    const p = { orgId: req.user.orgId, limit: parsedLimit, offset };

    if (status) { conds.push('pt.status = :status'); p.status = status; }
    if (fromBranch) { conds.push('pt.from_branch_id = :from'); p.from = fromBranch; }
    if (toBranch) { conds.push('pt.to_branch_id   = :to'); p.to = toBranch; }

    const rows = await db.query(
      `SELECT pt.*, pat.name AS patient_name, sp.common_name AS species,
              bf.name AS from_branch_name, bt.name AS to_branch_name,
              CONCAT(u.first_name,' ',u.last_name) AS requested_by_name
       FROM patient_transfers pt
       JOIN patients  pat ON pt.patient_id     = pat.id
       JOIN species   sp  ON pat.species_id    = sp.id
       JOIN branches  bf  ON pt.from_branch_id = bf.id
       JOIN branches  bt  ON pt.to_branch_id   = bt.id
       JOIN users     u   ON pt.requested_by   = u.id
       WHERE ${conds.join(' AND ')}
       ORDER BY pt.created_at DESC
       LIMIT :limit OFFSET :offset`,
      p
    );
    return R.ok(res, rows);
  } catch (e) {
    logBranchesError('GET /branches/transfers/patients', e, { orgId: req.user?.orgId, query: req.query });
    next(e);
  }
});

router.post('/transfers/patients',
  body('patientId').isInt(),
  body('toBranchId').isInt(),
  body('transferType').isIn(['visit', 'ownership']),
  body('clientId').optional().isInt({ min: 1 }),
  body('clientId').if(body('transferType').equals('ownership')).isInt({ min: 1 }),
  validate,
  async (req, res, next) => {
    try {
      const { patientId, toBranchId, clientId, reason, transferType } = req.body;

      if (clientId != null) {
        const destinationOwner = await db.queryOne(
          `SELECT c.id
           FROM clients c
           JOIN branches b ON b.id = c.branch_id
           WHERE c.id = :clientId
             AND c.branch_id = :toBranchId
             AND b.organization_id = :orgId
             AND c.is_active = TRUE
             AND c.deleted_at IS NULL`,
          { clientId, toBranchId, orgId: req.user.orgId }
        );
        if (!destinationOwner) {
          return R.badRequest(res, 'El nuevo propietario no pertenece a la sucursal destino');
        }
      }

      const result = await mb.transferPatient({
        patientId,
        fromBranchId: req.user.branchId,
        toBranchId,
        clientId: clientId || null,
        requestedByUserId: req.user.userId,
        reason,
        transferOwnership: transferType === 'ownership',
      });

      enqueue({
        event: 'patient.transferred',
        payload: { patientId, fromBranchId: req.user.branchId, toBranchId, transferType },
        orgId: req.user.orgId,
      }).catch((webhookError) => logBranchesError('POST /branches/transfers/patients webhook', webhookError, { orgId: req.user?.orgId, patientId, toBranchId }));
      eventBus.publish('patients.transfer.requested', {
        patientId,
        fromBranchId: req.user.branchId,
        toBranchId,
        transferType,
        requestedBy: req.user.userId,
      }, { orgId: req.user.orgId }).catch((busError) => logBranchesError('POST /branches/transfers/patients eventBus', busError, { orgId: req.user?.orgId, patientId, toBranchId }));

      return R.created(res, result);
    } catch (e) {
      if (['SAME_BRANCH', 'PATIENT_NOT_FOUND', 'CLIENT_NOT_FOUND', 'CROSS_ORG_DENIED', 'BRANCH_NOT_FOUND'].includes(e.code)) {
        return R.badRequest(res, e.message);
      }
      logBranchesError('POST /branches/transfers/patients', e, { orgId: req.user?.orgId, branchId: req.user?.branchId, body: req.body });
      next(e);
    }
  }
);

router.patch('/transfers/patients/:id',
  body('status').isIn(['approved', 'rejected', 'cancelled']),
  validate,
  async (req, res, next) => {
    try {
      const existing = await db.queryOne(
        `SELECT pt.status FROM patient_transfers pt
         JOIN branches bf ON pt.from_branch_id = bf.id
         WHERE pt.id = :id AND bf.organization_id = :orgId`,
        { id: req.params.id, orgId: req.user.orgId }
      );
      if (!existing) return R.notFound(res, 'Transferencia no encontrada');
      if (['approved', 'rejected'].includes(existing.status)) {
        return R.badRequest(res, `La transferencia ya fue ${existing.status} y no puede modificarse`);
      }
      // CORRECCIÓN: UPDATE incluye JOIN con branches y chequea organization_id para evitar
      // race-condition TOCTOU — sin esto, entre el SELECT y el UPDATE podría modificarse
      // una transferencia de otra org si el ID coincide numéricamente.
      await db.query(
        `UPDATE patient_transfers pt
         JOIN branches bf ON pt.from_branch_id = bf.id
         SET pt.status=:status, pt.approved_by=:uid, pt.updated_at=NOW()
         WHERE pt.id=:id AND bf.organization_id=:orgId`,
        { status: req.body.status, uid: req.user.userId, id: req.params.id, orgId: req.user.orgId }
      );
      return R.noContent(res);
    } catch (e) {
      logBranchesError('PATCH /branches/transfers/patients/:id', e, { transferId: req.params.id, orgId: req.user?.orgId, body: req.body });
      next(e);
    }
  }
);

router.get('/transfers/stock', async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const parsedLimit = Math.min(parseInt(`${limit}`, 10) || 20, 100);
    const parsedPage  = Math.max(parseInt(`${page}`, 10) || 1, 1);
    const offset = (parsedPage - 1) * parsedLimit;
    const conds = ['bf.organization_id = :orgId'];
    const p = { orgId: req.user.orgId, limit: parsedLimit, offset };
    if (status) { conds.push('st.status = :status'); p.status = status; }

    const rows = await db.query(
      `SELECT st.*, ii.name AS item_name,
              bf.name AS from_branch_name, bt.name AS to_branch_name,
              CONCAT(u.first_name,' ',u.last_name) AS requested_by_name
       FROM stock_transfers st
       JOIN inventory_items ii ON st.item_id       = ii.id
       JOIN branches        bf ON st.from_branch_id = bf.id
       JOIN branches        bt ON st.to_branch_id   = bt.id
       JOIN users           u  ON st.requested_by   = u.id
       WHERE ${conds.join(' AND ')}
       ORDER BY st.created_at DESC
       LIMIT :limit OFFSET :offset`,
      p
    );
    return R.ok(res, rows);
  } catch (e) {
    logBranchesError('GET /branches/transfers/stock', e, { orgId: req.user?.orgId, query: req.query });
    next(e);
  }
});

router.post('/transfers/stock',
  body('itemId').isInt(),
  body('toBranchId').isInt(),
  body('quantity').isFloat({ min: 0.001 }),
  body('batchId').optional().isInt({ min: 1 }),
  validate,
  async (req, res, next) => {
    try {
      const { itemId, toBranchId, quantity, reason, batchId } = req.body;

      const result = await mb.transferStock({
        itemId,
        fromBranchId: req.user.branchId,
        toBranchId,
        quantity,
        requestedByUserId: req.user.userId,
        reason,
        batchId: batchId || null,
      });

      eventBus.publish('inventory.transfer.requested', {
        itemId,
        fromBranchId: req.user.branchId,
        toBranchId,
        quantity,
        requestedBy: req.user.userId,
      }, { orgId: req.user.orgId }).catch((busError) => logBranchesError('POST /branches/transfers/stock eventBus', busError, { orgId: req.user?.orgId, itemId, toBranchId }));

      return R.created(res, result);
    } catch (e) {
      if (['SAME_BRANCH', 'ITEM_NOT_FOUND', 'INSUFFICIENT_STOCK', 'INVALID_QUANTITY', 'CROSS_ORG_DENIED', 'BRANCH_NOT_FOUND'].includes(e.code)) {
        return R.badRequest(res, e.message);
      }
      logBranchesError('POST /branches/transfers/stock', e, { orgId: req.user?.orgId, branchId: req.user?.branchId, body: req.body });
      next(e);
    }
  }
);

module.exports = router;
