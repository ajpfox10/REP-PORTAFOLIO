'use strict';

const { Router } = require('express');
const { db, R, portalAuth, sendTemplate, publishPortalEvent, vBody, validate, log } = require('../portal.common');
const { formatDate, formatTime } = require('../../../../shared/locale');

const router = Router();

router.get('/', portalAuth, async (req, res, next) => {
  try {
    const { status, upcoming, page = 1 } = req.query;
    const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);
    const offset = (Math.max(parseInt(page, 10), 1) - 1) * limit;
    const conds = ['i.client_id=:cid', 'b.organization_id=:orgId'];
    const p = { cid: req.owner.clientId, orgId: req.owner.orgId, limit, offset };
    if (status) { conds.push('a.status=:status'); p.status = status; }
    if (upcoming === 'true') conds.push('a.scheduled_date >= NOW()');

    const rows = await db.query(
      `SELECT a.id, a.scheduled_date, a.scheduled_date AS appointment_date,
              a.duration_minutes, a.status, a.reason,
              at2.name AS appointment_type, a.notes,
              p.name AS patient_name, sp.common_name AS species,
              CONCAT(u.first_name,' ',u.last_name) AS vet_name,
              b.name AS clinic_name
       FROM appointments a
       JOIN patients p     ON a.patient_id = p.id
       JOIN species sp     ON p.species_id = sp.id
       LEFT JOIN users u        ON a.vet_id = u.id
       LEFT JOIN appointment_types at2 ON a.appointment_type_id = at2.id
       JOIN branches b     ON a.branch_id = b.id
       JOIN patient_owners i ON i.patient_id = p.id AND i.client_id=:cid
       WHERE ${conds.join(' AND ')}
       ORDER BY a.scheduled_date DESC
       LIMIT :limit OFFSET :offset`,
      p
    );
    return R.ok(res, rows);
  } catch (e) { next(e); }
});

router.post('/',
  portalAuth,
  vBody('patientId').isInt(),
  vBody('appointmentDate').isISO8601(),
  vBody('reason').notEmpty().isLength({ max: 500 }),    // BUG-010
  vBody('notes').optional().isLength({ max: 1000 }),    // BUG-010
  validate,
  async (req, res, next) => {
    try {
      const { patientId, appointmentDate, reason, notes, branchId } = req.body;
      const owned = await db.queryOne(
        `SELECT c.branch_id, p.organization_id
         FROM patient_owners po
         JOIN patients p ON p.id = po.patient_id
         JOIN clients c ON c.id = po.client_id
         WHERE po.patient_id=:pid AND po.client_id=:cid`,
        { pid: patientId, cid: req.owner.clientId }
      );
      if (!owned) return R.forbidden(res, 'Sin acceso a esta mascota');
      if (!req.owner.orgId || String(owned.organization_id) !== String(req.owner.orgId)) {
        return R.forbidden(res, 'Mascota fuera de la organizacion');
      }
      const effectiveBranchId = branchId || owned.branch_id || null;
      if (branchId) {
        const branchScope = await db.queryOne(
          `SELECT id FROM branches WHERE id=:branchId AND organization_id=:orgId`,
          { branchId, orgId: owned.organization_id }
        );
        if (!branchScope) return R.forbidden(res, 'Sucursal fuera de la organizacion');
      }

      const [r] = await db.query(
        `INSERT INTO appointments
           (patient_id, client_id, branch_id, scheduled_date, reason, notes, status, appointment_type_id, created_by_portal)
         VALUES (:pid, :cid, :bid, :date, :reason, :notes, 'requested', NULL, 1)`,
        { pid: patientId, cid: req.owner.clientId, bid: effectiveBranchId, date: appointmentDate, reason, notes: notes || null }
      );

      const client = await db.queryOne(`SELECT phone, first_name FROM clients WHERE id=:id`, { id: req.owner.clientId });
      const pet = await db.queryOne(`SELECT name FROM patients WHERE id=:id`, { id: patientId });
      const branch = effectiveBranchId ? await db.queryOne(`SELECT name FROM branches WHERE id=:id`, { id: effectiveBranchId }) : null;

      if (client?.phone) {
        sendTemplate('whatsapp', client.phone, 'appointmentConfirm', {
          ownerName: client.first_name,
          petName: pet?.name || 'su mascota',
          date: formatDate(appointmentDate),
          time: formatTime(appointmentDate),
          clinicName: branch?.name || 'la clinica',
        }).catch((err) => log.warn('appointment confirm send failed', { message: err.message }));
      }

      publishPortalEvent('portal.appointment.requested', {
        appointmentId: r.insertId,
        patientId,
        clientId: req.owner.clientId,
        branchId: effectiveBranchId,
        orgId: req.owner.orgId || null,
        appointmentDate,
        reason,
      }, req);

      return R.created(res, { id: r.insertId, message: 'Solicitud de cita enviada. Le confirmaremos a la brevedad.' });
    } catch (e) { next(e); }
  }
);

router.patch('/:id/cancel', portalAuth, async (req, res, next) => {
  try {
    const apt = await db.queryOne(
      `SELECT a.id, a.status FROM appointments a
       JOIN patient_owners po ON po.patient_id=a.patient_id AND po.client_id=:cid
       WHERE a.id=:id`,
      { id: req.params.id, cid: req.owner.clientId }
    );
    if (!apt) return R.notFound(res, 'Cita no encontrada');
    if (!['requested', 'confirmed'].includes(apt.status)) return R.conflict(res, 'Esta cita no puede cancelarse');

    // BUG-010: limitar longitud del motivo de cancelación
    const cancelReason = (req.body.reason || 'Cancelado por el duenio').slice(0, 500);

    // BUG-005: fix TOCTOU — re-verificar el status en el WHERE del UPDATE
    const [result] = await db.query(
      `UPDATE appointments SET status='cancelled', cancellation_reason=:reason, updated_at=NOW()
       WHERE id=:id AND status IN ('requested','confirmed')`,
      { reason: cancelReason, id: apt.id }
    );
    if (!result.affectedRows) return R.conflict(res, 'La cita ya fue modificada por otro proceso');
    publishPortalEvent('portal.appointment.cancelled', {
      appointmentId: apt.id,
      clientId: req.owner.clientId,
      orgId: req.owner.orgId || null,
      reason: cancelReason,
    }, req);
    return R.noContent(res);
  } catch (e) { next(e); }
});

module.exports = router;
