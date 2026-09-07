'use strict';

const { Router } = require('express');
const { db, R, logAppointmentsError } = require('./appointments.common');
const { buildOrgScope, buildBranchScope, scopeParams, enforceRowTenantAccess } = require('../../../../shared/tenantScope');

const router = Router();

const getAppointmentTypes = [async (req, res, next) => {
  try {
    const rows = await db.query(
      `SELECT id,
              name,
              NULL AS code,
              NULL AS category,
              default_duration_minutes,
              color_hex,
              COALESCE(requires_prep, 0) AS requires_fasting
       FROM appointment_types
       WHERE COALESCE(is_active, 1) = TRUE
         AND (organization_id IS NULL OR organization_id = :orgId)
         AND (branch_id IS NULL OR branch_id = :branchId)
       ORDER BY name`,
      { orgId: req.user.orgId, branchId: req.user.branchId }
    );
    return R.ok(res, rows);
  } catch (e) {
    logAppointmentsError('GET /appointments/types', e, { orgId: req.user?.orgId, branchId: req.user?.branchId });
    next(e);
  }
}];

router.get('/', async (req, res, next) => {
  try {
    const { date, vetId, status, patientId, page = 1 } = req.query;
    const limit = Math.min(parseInt(req.query.limit || 50, 10) || 50, 100);
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const offset = (pageNum - 1) * limit;
    const conditions = [buildBranchScope('a'), buildOrgScope('p')];
    const params = scopeParams(req, { limit, offset });

    if (date) {
      conditions.push('a.scheduled_date >= :date AND a.scheduled_date < DATE_ADD(:date, INTERVAL 1 DAY)');
      params.date = date;
    }
    if (vetId) { conditions.push('a.vet_id = :vetId'); params.vetId = vetId; }
    if (status) { conditions.push('a.status = :status'); params.status = status; }
    if (patientId) { conditions.push('a.patient_id = :patientId'); params.patientId = patientId; }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const rows = await db.query(
      `SELECT a.id, a.scheduled_date, a.duration_minutes, a.status, a.is_emergency,
              a.reason, a.notes,
              p.id AS patient_id, p.name AS patient_name,
              sp.common_name AS species,
              CONCAT(cl.first_name,' ',cl.last_name) AS owner_name, cl.phone AS owner_phone,
              CONCAT(u.first_name,' ',u.last_name) AS vet_name,
              at2.name AS appointment_type,
              mr.id AS medical_record_id, mr.status AS record_status
       FROM appointments a
       JOIN patients     p   ON a.patient_id       = p.id
       JOIN species      sp  ON p.species_id       = sp.id
       JOIN patient_owners po ON po.patient_id = p.id AND po.ownership_type = 'primary'
       JOIN clients      cl  ON po.client_id       = cl.id
       JOIN users        u   ON a.vet_id           = u.id
       LEFT JOIN appointment_types at2 ON a.appointment_type_id = at2.id
       LEFT JOIN medical_records mr ON mr.appointment_id = a.id
       ${where}
       ORDER BY a.scheduled_date ASC
       LIMIT :limit OFFSET :offset`,
      params
    );
    return R.ok(res, rows);
  } catch (e) {
    logAppointmentsError('GET /appointments', e, { orgId: req.user?.orgId, branchId: req.user?.branchId, query: req.query });
    next(e);
  }
});

router.get('/today', async (req, res, next) => {
  try {
    const rows = await db.query(
      `SELECT * FROM v_today_appointments WHERE branch_id = :bid ORDER BY scheduled_date`,
      scopeParams(req, { bid: req.user.branchId })
    );
    return R.ok(res, rows);
  } catch (e) {
    logAppointmentsError('GET /appointments/today', e, { branchId: req.user?.branchId });
    next(e);
  }
});

router.get('/types', ...getAppointmentTypes);

router.get('/:id', async (req, res, next) => {
  try {
    const appt = await db.queryOne(
      `SELECT a.*, p.organization_id, at2.name AS type_name,
              p.name AS patient_name, sp.common_name AS species,
              CONCAT(u.first_name,' ',u.last_name) AS vet_name
       FROM appointments a
       LEFT JOIN appointment_types at2 ON a.appointment_type_id = at2.id
       JOIN patients p ON a.patient_id = p.id
       JOIN species  sp ON p.species_id = sp.id
       JOIN users    u  ON a.vet_id     = u.id
       WHERE a.id = :id AND a.branch_id = :bid AND p.organization_id = :orgId`,
      scopeParams(req, { id: req.params.id, bid: req.user.branchId })
    );
    if (!appt) return R.notFound(res);
    if (!enforceRowTenantAccess(appt, req, res, { requireBranch: true })) return undefined;
    return R.ok(res, appt);
  } catch (e) {
    logAppointmentsError('GET /appointments/:id', e, { appointmentId: req.params.id, orgId: req.user?.orgId, branchId: req.user?.branchId });
    next(e);
  }
});

module.exports = {
  router,
  getAppointmentTypes,
};
