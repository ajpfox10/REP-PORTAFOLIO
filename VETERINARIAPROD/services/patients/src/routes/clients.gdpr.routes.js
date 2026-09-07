'use strict';

const { Router } = require('express');
const gdpr = require('../../../../shared/gdpr');
const { requirePerm } = require('../../../../shared/serviceBase');
const { db, R, body, logClientsError } = require('./clients.common');

const requireGdprAdmin = requirePerm('gdpr:admin');

const router = Router();

router.get('/:id/gdpr/consents', async (req, res, next) => {
  try {
    const consents = await gdpr.getConsents(req.params.id);
    return R.ok(res, consents);
  } catch (e) {
    logClientsError('GET /clients/:id/gdpr/consents', e, { clientId: req.params.id, orgId: req.user?.orgId });
    next(e);
  }
});

router.post('/:id/gdpr/consents',
  body('consentType').isIn(['marketing', 'analytics', 'third_party', 'telemedicine', 'photo', 'data_sharing', 'terms', 'privacy']),
  body('granted').isBoolean(),
  async (req, res, next) => {
    try {
      const { consentType, granted, source, version } = req.body;
      const result = await gdpr.recordConsent({
        clientId: req.params.id,
        orgId: req.user.orgId,
        consentType,
        granted: granted === true || granted === 'true',
        source: source || 'staff',
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        version,
      });

      await db.query(
        `INSERT INTO gdpr_audit_trail (org_id, client_id, action, performed_by, ip_address, detail_json)
         VALUES (:orgId, :cid, :action, :uid, :ip, :det)`,
        {
          orgId: req.user.orgId,
          cid: req.params.id,
          action: `consent.${granted ? 'granted' : 'withdrawn'}.${consentType}`,
          uid: req.user.userId,
          ip: req.ip,
          det: JSON.stringify({ consentType, granted, source }),
        }
      ).catch((auditError) => logClientsError('POST /clients/:id/gdpr/consents audit', auditError, { clientId: req.params.id, orgId: req.user?.orgId }));

      return R.created(res, result);
    } catch (e) {
      logClientsError('POST /clients/:id/gdpr/consents', e, { clientId: req.params.id, orgId: req.user?.orgId, body: req.body });
      next(e);
    }
  }
);

router.delete('/:id/gdpr/consents', async (req, res, next) => {
  try {
    await gdpr.withdrawAllConsents(req.params.id, 'staff');
    return R.noContent(res);
  } catch (e) {
    logClientsError('DELETE /clients/:id/gdpr/consents', e, { clientId: req.params.id, orgId: req.user?.orgId });
    next(e);
  }
});

// SEC: el export entrega TODA la PII descifrada y SIN enmascarar (DNI real, dossier
// completo). Es un GET, asi que guardWrite no aplica y el mount solo exige 'clients:read'
// (lo tiene casi cualquier rol: groomer, lab_tech, recepcion...). Sin este gate, un rol
// de baja jerarquia podia saltear el enmascarado de PII via el endpoint de export.
// 'clients:pii' = mismo privilegio que ver PII sin mascara (org_admin/branch_manager/
// superadmin via clients:* / *).
router.get('/:id/gdpr/export', requirePerm('clients:pii'), async (req, res, next) => {
  try {
    const data = await gdpr.exportPersonalData(req.params.id, req.user.orgId);
    await db.query(
      `INSERT INTO gdpr_audit_trail (org_id, client_id, action, performed_by, ip_address)
       VALUES (:orgId, :cid, 'access.export', :uid, :ip)`,
      { orgId: req.user.orgId, cid: req.params.id, uid: req.user.userId, ip: req.ip }
    ).catch((auditError) => logClientsError('GET /clients/:id/gdpr/export audit', auditError, { clientId: req.params.id, orgId: req.user?.orgId }));

    const format = req.query.format || 'json';
    if (format === 'json') {
      // Sanitizar el id antes de ponerlo en el header para evitar header/response injection.
      const safeId = String(req.params.id).replace(/[^a-zA-Z0-9_-]/g, '');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="datos-personales-${safeId}.json"`);
      return res.send(JSON.stringify(data, null, 2));
    }
    return R.ok(res, data);
  } catch (e) {
    if (e.code === 'CLIENT_NOT_FOUND') return R.notFound(res);
    logClientsError('GET /clients/:id/gdpr/export', e, { clientId: req.params.id, orgId: req.user?.orgId, query: req.query });
    next(e);
  }
});

router.post('/:id/gdpr/requests',
  body('requestType').isIn(['access', 'erasure', 'portability', 'rectification', 'restriction', 'objection']),
  async (req, res, next) => {
    try {
      const result = await gdpr.createDataRequest({
        clientId: req.params.id,
        orgId: req.user.orgId,
        branchId: req.user.branchId,
        requestType: req.body.requestType,
        notes: req.body.notes,
      });
      return R.created(res, result);
    } catch (e) {
      logClientsError('POST /clients/:id/gdpr/requests', e, { clientId: req.params.id, orgId: req.user?.orgId, body: req.body });
      next(e);
    }
  }
);

router.get('/gdpr/requests', async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const offset = ((parseInt(`${page}`, 10) || 1) - 1) * (parseInt(`${limit}`, 10) || 20);
    const conds = ['c.branch_id = :bid'];
    const p = { bid: req.user.branchId, limit: parseInt(`${limit}`, 10) || 20, offset };
    if (status) { conds.push('gdr.status = :status'); p.status = status; }

    const rows = await db.query(
      `SELECT gdr.*, CONCAT(c.first_name,' ',c.last_name) AS client_name, c.email,
              CONCAT(u.first_name,' ',u.last_name) AS handled_by_name
       FROM gdpr_data_requests gdr
       JOIN clients c ON gdr.client_id = c.id
       LEFT JOIN users u ON gdr.completed_by = u.id
       WHERE ${conds.join(' AND ')}
       ORDER BY gdr.due_date ASC, gdr.created_at DESC
       LIMIT :limit OFFSET :offset`,
      p
    );
    return R.ok(res, rows);
  } catch (e) {
    logClientsError('GET /clients/gdpr/requests', e, { branchId: req.user?.branchId, orgId: req.user?.orgId, query: req.query });
    next(e);
  }
});

router.patch('/gdpr/requests/:reqId',
  body('status').isIn(['in_progress', 'completed', 'rejected']),
  async (req, res, next) => {
    try {
      await gdpr.updateDataRequest(req.params.reqId, req.body.status, req.user.userId);
      return R.noContent(res);
    } catch (e) {
      logClientsError('PATCH /clients/gdpr/requests/:reqId', e, { requestId: req.params.reqId, orgId: req.user?.orgId, body: req.body });
      next(e);
    }
  }
);

router.delete('/:id/gdpr/erase', async (req, res, next) => {
  try {
    const result = await gdpr.anonymizeClient(req.params.id, req.user.orgId, req.user.userId);
    return R.ok(res, result);
  } catch (e) {
    if (e.code === 'CLIENT_NOT_FOUND') return R.notFound(res);
    logClientsError('DELETE /clients/:id/gdpr/erase', e, { clientId: req.params.id, orgId: req.user?.orgId });
    next(e);
  }
});

router.get('/gdpr/retention', requireGdprAdmin, async (req, res, next) => {
  try {
    const candidates = await gdpr.findRetentionCandidates(req.user.orgId);
    return R.ok(res, candidates, { policies: gdpr.getRetentionPolicies() });
  } catch (e) {
    logClientsError('GET /clients/gdpr/retention', e, { orgId: req.user?.orgId });
    next(e);
  }
});

module.exports = router;
