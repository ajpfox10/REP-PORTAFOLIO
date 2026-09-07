'use strict';

const express = require('express');
const { requirePerm } = require('../../../../shared/serviceBase');
const {
  R,
  db,
  log,
  reminderDueExpr,
  requireUserContext,
} = require('../notifications.common');

const router = express.Router();

router.post('/generate', requirePerm('notifications:send'), async (req, res, next) => {
  try {
    if (!req.user.branchId) return R.badRequest(res, 'Branch context required');

    const generated = await db.transaction(async (conn) => {
      let total = 0;
      const daysAhead = 7;

      const [appointmentRows] = await conn.query(
        `INSERT INTO reminders
           (branch_id, patient_id, client_id, reminder_type, related_entity_id,
            scheduled_send_at, status, channel, message, created_at)
         SELECT a.branch_id,
                a.patient_id,
                COALESCE(a.client_id, po.client_id),
                'appointment',
                a.id,
                a.scheduled_date,
                'pending',
                'whatsapp',
                CONCAT('Recordatorio de turno para ', p.name, ' el ',
                       DATE_FORMAT(a.scheduled_date, '%d/%m/%Y %H:%i')),
                NOW()
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         LEFT JOIN patient_owners po
           ON po.patient_id = p.id AND po.ownership_type = 'primary'
         WHERE a.branch_id = :bid
           AND a.scheduled_date BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL :days DAY)
           AND a.status IN ('scheduled', 'confirmed')
           AND NOT EXISTS (
             SELECT 1
             FROM reminders r
             WHERE r.branch_id = a.branch_id
               AND r.reminder_type = 'appointment'
               AND r.related_entity_id = a.id
           )`,
        { bid: req.user.branchId, days: daysAhead }
      );
      total += appointmentRows.affectedRows || 0;

      const [vaccinationRows] = await conn.query(
        `INSERT INTO reminders
           (branch_id, patient_id, client_id, reminder_type, related_entity_id,
            scheduled_send_at, status, channel, message, created_at)
         SELECT v.branch_id,
                v.patient_id,
                po.client_id,
                'vaccination',
                v.id,
                v.next_due_date,
                'pending',
                'whatsapp',
                CONCAT('Recordatorio de vacunacion para ', p.name, ' el ',
                       DATE_FORMAT(v.next_due_date, '%d/%m/%Y')),
                NOW()
         FROM vaccinations v
         JOIN patients p ON p.id = v.patient_id
         JOIN vaccines vac ON vac.id = v.vaccine_id
         LEFT JOIN patient_owners po
           ON po.patient_id = p.id AND po.ownership_type = 'primary'
         WHERE v.branch_id = :bid
           AND v.next_due_date BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL :days DAY)
           AND NOT EXISTS (
             SELECT 1
             FROM reminders r
             WHERE r.branch_id = v.branch_id
               AND r.reminder_type = 'vaccination'
               AND r.related_entity_id = v.id
           )`,
        { bid: req.user.branchId, days: daysAhead }
      );
      total += vaccinationRows.affectedRows || 0;

      const [dewormingRows] = await conn.query(
        `INSERT INTO reminders
           (branch_id, patient_id, client_id, reminder_type, related_entity_id,
            scheduled_send_at, status, channel, message, created_at)
         SELECT dr.branch_id,
                dr.patient_id,
                po.client_id,
                'deworming',
                dr.id,
                dr.next_due_date,
                'pending',
                'whatsapp',
                CONCAT('Recordatorio de desparasitacion para ', p.name, ' el ',
                       DATE_FORMAT(dr.next_due_date, '%d/%m/%Y')),
                NOW()
         FROM deworming_records dr
         JOIN patients p ON p.id = dr.patient_id
         JOIN antiparasitic_products ap ON ap.id = dr.product_id
         LEFT JOIN patient_owners po
           ON po.patient_id = p.id AND po.ownership_type = 'primary'
         WHERE dr.branch_id = :bid
           AND dr.next_due_date BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL :days DAY)
           AND NOT EXISTS (
             SELECT 1
             FROM reminders r
             WHERE r.branch_id = dr.branch_id
               AND r.reminder_type = 'deworming'
               AND r.related_entity_id = dr.id
           )`,
        { bid: req.user.branchId, days: daysAhead }
      );
      total += dewormingRows.affectedRows || 0;

      return total;
    });

    return R.ok(res, { generated });
  } catch (err) {
    log.warn('reminder generation failed', { err: err.message });
    next(err);
  }
});

const ALLOWED_REMINDER_STATUSES = new Set(['pending', 'sent', 'failed', 'cancelled']);
const ALLOWED_REMINDER_TYPES    = new Set(['appointment', 'vaccination', 'deworming']);

router.get('/', async (req, res, next) => {
  try {
    if (!requireUserContext(req, res)) return;

    // Cap en paginación
    const page  = Math.min(Math.max(parseInt(`${req.query.page  || '1'}`,  10) || 1,  1), 10000);
    const limit = Math.min(Math.max(parseInt(`${req.query.limit || '30'}`, 10) || 30, 1), 100);
    const offset = (page - 1) * limit;

    const { status, type } = req.query;
    const conds = ['r.branch_id = :bid'];
    const p = { bid: req.user.branchId, limit, offset };
    if (status) {
      if (!ALLOWED_REMINDER_STATUSES.has(status)) return R.badRequest(res, 'status inválido');
      conds.push('r.status = :status');
      p.status = status;
    }
    if (type) {
      if (!ALLOWED_REMINDER_TYPES.has(type)) return R.badRequest(res, 'type inválido');
      conds.push('r.reminder_type = :type');
      p.type = type;
    }

    const rows = await db.query(
      `SELECT r.id, r.reminder_type, ${reminderDueExpr('r')} AS due_date, r.status, r.message,
              p.name AS patient_name, sp.common_name AS species,
              CONCAT(cl.first_name,' ',cl.last_name) AS owner_name, cl.phone, cl.email
       FROM reminders r
       JOIN patients p     ON r.patient_id  = p.id
       JOIN species  sp    ON p.species_id  = sp.id
       JOIN patient_owners po ON po.patient_id = p.id AND po.ownership_type='primary'
       JOIN clients  cl    ON po.client_id  = cl.id
       WHERE ${conds.join(' AND ')}
       ORDER BY ${reminderDueExpr('r')} ASC
       LIMIT :limit OFFSET :offset`,
      p
    );
    return R.ok(res, rows);
  } catch (err) {
    log.warn('reminder list failed', { err: err.message });
    next(err);
  }
});

module.exports = router;
