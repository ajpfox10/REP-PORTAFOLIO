'use strict';

const express = require('express');
const {
  R,
  db,
  log,
  messaging,
  queueNotificationRetry,
  logMessage,
  reminderDueExpr,
} = require('../notifications.common');
const { formatDate, formatTime } = require('../../../../shared/locale');

const router = express.Router();

router.post('/:reminderId', async (req, res, next) => {
  try {
    const { channel = 'both' } = req.body;
    const reminder = await db.queryOne(
      `SELECT r.id, r.reminder_type, r.message, ${reminderDueExpr('r')} AS due_date,
              p.name AS pet_name,
              CONCAT(cl.first_name,' ',cl.last_name) AS owner_name,
              cl.phone, cl.email,
              b.name AS clinic_name
       FROM reminders r
       JOIN patients p      ON r.patient_id = p.id
       JOIN patient_owners po ON po.patient_id = p.id AND po.ownership_type = 'primary'
       JOIN clients cl       ON po.client_id = cl.id
       JOIN branches b       ON r.branch_id = b.id
       WHERE r.id = :id AND r.branch_id = :bid`,
      { id: req.params.reminderId, bid: req.user.branchId }
    );
    if (!reminder) return R.notFound(res, 'Recordatorio no encontrado');
    if (!reminder.phone) return R.badRequest(res, 'El cliente no tiene telefono registrado');

    // Sanitizar y validar el teléfono proveniente de BD (previene header injection)
    const PHONE_RE_REMINDER = /^\+?[1-9]\d{6,14}$/;
    const cleanPhone = String(reminder.phone).replace(/[\r\n\0\s]/g, '');
    if (!PHONE_RE_REMINDER.test(cleanPhone)) {
      return R.badRequest(res, 'El número de teléfono del cliente no tiene formato E.164 válido');
    }

    const templatePayload = {
      channel,
      to: cleanPhone,
      template: 'appointmentReminder',
      vars: {
        ownerName: reminder.owner_name,
        petName: reminder.pet_name,
        date: formatDate(reminder.due_date),
        time: formatTime(reminder.due_date),
        vetName: 'su veterinario',
        clinicName: reminder.clinic_name,
      },
    };
    let result;
    try {
      result = await messaging.sendTemplate(channel, templatePayload.to, templatePayload.template, templatePayload.vars);
    } catch (err) {
      await queueNotificationRetry({ channel: 'template', payload: templatePayload, req });
      return res.status(202).json({ success: true, queued: true, message: 'Reminder queued for retry', error: err.message });
    }

    await db.query(
      `UPDATE reminders SET status = 'sent', sent_at = NOW() WHERE id = :id`,
      { id: reminder.id }
    );

    await logMessage({
      channel,
      to: cleanPhone,
      message: result.body,
      result: result.results,
      userId: req.user.userId,
      branchId: req.user.branchId,
      relatedId: reminder.id,
      relatedType: 'reminder',
    });
    return R.ok(res, result);
  } catch (err) {
    log.warn('reminder send failed', { err: err.message, reminderId: req.params.reminderId });
    next(err);
  }
});

module.exports = router;
