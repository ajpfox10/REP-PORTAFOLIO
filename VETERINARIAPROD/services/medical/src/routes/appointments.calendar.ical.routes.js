'use strict';

const { Router } = require('express');
const { R, icalLib, logAppointmentsError } = require('./appointments.common');
const { db } = require('./appointments.common');
const { getAppointmentWithContext, getClinicInfo } = require('./appointments.calendar.common');

const router = Router();

router.get('/agenda/ical', async (req, res, next) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);

    const appointments = await db.query(
      `SELECT a.*, at2.name AS type_name,
              p.name AS patient_name, sp.common_name AS species,
              CONCAT(cl.first_name,' ',cl.last_name) AS owner_name,
              cl.phone AS owner_phone, cl.email AS owner_email,
              CONCAT(u.first_name,' ',u.last_name) AS vet_name
       FROM appointments a
       LEFT JOIN appointment_types at2 ON a.appointment_type_id = at2.id
       JOIN patients p   ON a.patient_id  = p.id
       JOIN species  sp  ON p.species_id  = sp.id
       JOIN users    u   ON a.vet_id      = u.id
       JOIN patient_owners po ON po.patient_id = p.id AND po.ownership_type = 'primary'
       JOIN clients  cl  ON po.client_id  = cl.id
       WHERE a.scheduled_date >= :date
         AND a.scheduled_date < DATE_ADD(:date, INTERVAL 1 DAY)
         AND a.branch_id = :bid
         AND p.organization_id = :orgId
       ORDER BY a.scheduled_date ASC`,
      { date, bid: req.user.branchId, orgId: req.user.orgId }
    );

    const clinic = await getClinicInfo(req.user.branchId);

    const icsContent = icalLib.generateAgendaIcs(appointments, clinic);

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="agenda-${date}.ics"`);
    res.send(icsContent);
  } catch (e) {
    logAppointmentsError('GET /appointments/agenda/ical', e, { branchId: req.user?.branchId, orgId: req.user?.orgId, query: req.query });
    next(e);
  }
});

router.get('/:id/ical', async (req, res, next) => {
  try {
    const ctx = await getAppointmentWithContext(req.params.id, req.user.branchId, req.user.orgId);
    if (!ctx) return R.notFound(res);

    const icsContent = icalLib.generateAppointmentIcs(ctx.appt, ctx.clinic);
    // SEC: sanitizar patient_name para evitar header injection en Content-Disposition
    const safeName = String(ctx.appt.patient_name || 'paciente')
      .replace(/[^\w\-. ]/g, '')   // solo alfanumérico, guion, punto y espacio
      .replace(/\s+/g, '_')
      .slice(0, 80);
    const filename = `cita-${ctx.appt.id}-${safeName}.ics`;

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(icsContent);
  } catch (e) {
    logAppointmentsError('GET /appointments/:id/ical', e, { appointmentId: req.params.id, branchId: req.user?.branchId });
    next(e);
  }
});

module.exports = { router };
