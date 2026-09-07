'use strict';

const { Router } = require('express');
const { requirePerm } = require('../../../../shared/serviceBase');
const { db, R, body, validate, logGroomingError } = require('../grooming.common');

const router = Router();

function httpError(status, message) {
  return Object.assign(new Error(message), { http: status });
}

router.get('/', async (req, res, next) => {
  try {
    const { date, groomerId, status, page = 1, limit = 30 } = req.query;
    const offset = (page - 1) * limit;
    const conds = ['ga.branch_id = :bid'];
    const p = { bid: req.user.branchId, limit: parseInt(limit, 10), offset: parseInt(offset, 10) };
    if (date) { conds.push('DATE(ga.scheduled_at) = :date'); p.date = date; }
    if (groomerId) { conds.push('ga.groomer_id = :gid'); p.gid = groomerId; }
    if (status) { conds.push('ga.status = :status'); p.status = status; }

    const rows = await db.query(
      `SELECT ga.id, ga.scheduled_at, ga.estimated_duration_minutes, ga.status,
              ga.estimated_price, ga.final_price, ga.pickup_required, ga.pickup_address,
              p.name AS patient_name, sp.common_name AS species, p.photo_url,
              b.name AS breed, p.sex,
              CONCAT(cl.first_name,' ',cl.last_name) AS client_name, cl.phone,
              CONCAT(u.first_name,' ',u.last_name) AS groomer_name,
              GROUP_CONCAT(gst.name SEPARATOR ', ') AS services
       FROM grooming_appointments ga
       JOIN patients p     ON ga.patient_id  = p.id
       JOIN species  sp    ON p.species_id   = sp.id
       JOIN clients  cl    ON ga.client_id   = cl.id
       JOIN groomers g     ON ga.groomer_id  = g.id
       JOIN users    u     ON g.user_id      = u.id
       LEFT JOIN breeds    b  ON p.breed_id  = b.id
       LEFT JOIN grooming_appointment_services gas ON gas.grooming_appointment_id = ga.id
       LEFT JOIN grooming_service_types gst ON gas.service_type_id = gst.id
       WHERE ${conds.join(' AND ')}
       GROUP BY ga.id
       ORDER BY ga.scheduled_at ASC
       LIMIT :limit OFFSET :offset`,
      p
    );
    return R.ok(res, rows);
  } catch (e) { next(e); }
});

router.get('/today', async (req, res, next) => {
  try {
    const rows = await db.query(`SELECT * FROM v_grooming_today WHERE branch_id = :bid ORDER BY scheduled_at`, { bid: req.user.branchId });
    return R.ok(res, rows);
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const appt = await db.queryOne(
      `SELECT ga.*,
              p.name AS patient_name, p.sex, p.photo_url,
              sp.common_name AS species, b.name AS breed,
              CONCAT(cl.first_name,' ',cl.last_name) AS client_name,
              cl.phone AS client_phone, cl.email AS client_email,
              CONCAT(u.first_name,' ',u.last_name) AS groomer_name,
              g.id AS groomer_id
       FROM grooming_appointments ga
       JOIN patients p  ON ga.patient_id = p.id
       JOIN species  sp ON p.species_id  = sp.id
       JOIN clients  cl ON ga.client_id  = cl.id
       JOIN groomers g  ON ga.groomer_id = g.id
       JOIN users    u  ON g.user_id     = u.id
       LEFT JOIN breeds b ON p.breed_id  = b.id
       WHERE ga.id = :id AND ga.branch_id = :bid`,
      { id: req.params.id, bid: req.user.branchId }
    );
    if (!appt) return R.notFound(res);

    const [services, profile, record] = await Promise.all([
      db.query(`SELECT gst.id, gst.name, gst.base_price_small, gas.price_charged, gas.notes
                FROM grooming_appointment_services gas
                JOIN grooming_service_types gst ON gas.service_type_id = gst.id
                WHERE gas.grooming_appointment_id = :id`, { id: req.params.id }),
      db.queryOne(`SELECT * FROM patient_grooming_profile WHERE patient_id = :pid`, { pid: appt.patient_id }),
      db.queryOne(`SELECT * FROM grooming_records WHERE grooming_appointment_id = :id`, { id: req.params.id }),
    ]);

    return R.ok(res, { ...appt, services, groomingProfile: profile, record });
  } catch (e) { next(e); }
});

router.post('/',
  requirePerm('grooming:create'),
  body('patientId').isInt(),
  body('clientId').isInt(),
  body('groomerId').isInt(),
  body('scheduledAt').isISO8601(),
  body('services').isArray({ min: 1 }),
  body('services.*.serviceTypeId').isInt({ min: 1 }).toInt(),
  validate,
  async (req, res, next) => {
    try {
      const { patientId, clientId, groomerId, scheduledAt, services, estimatedDurationMinutes = 90, pickupRequired, pickupAddress, deliveryRequired, deliveryAddress, notes } = req.body;
      let apptId;
      let totalEstimate = 0;

      await db.transaction(async (conn) => {
        const scopedEntities = await conn.queryOne(
          `SELECT p.id
           FROM patients p
           JOIN patient_owners po
             ON po.patient_id = p.id
            AND po.client_id = :cid
            AND po.deleted_at IS NULL
           JOIN clients c
             ON c.id = po.client_id
            AND c.branch_id = :bid
            AND c.deleted_at IS NULL
           JOIN groomers g
             ON g.id = :gid
            AND g.branch_id = :bid
            AND g.is_active = TRUE
           WHERE p.id = :pid
             AND p.organization_id = :orgId
             AND p.deleted_at IS NULL`,
          {
            pid: patientId,
            cid: clientId,
            gid: groomerId,
            bid: req.user.branchId,
            orgId: req.user.orgId,
          }
        );
        if (!scopedEntities) {
          throw httpError(403, 'Paciente, cliente o groomer no pertenecen a la sucursal');
        }

        const validatedServices = [];
        for (const svc of services) {
          const serviceType = await conn.queryOne(
            `SELECT id, base_price_medium
             FROM grooming_service_types
             WHERE id = :id AND is_active = TRUE`,
            { id: svc.serviceTypeId }
          );
          if (!serviceType) {
            throw httpError(400, 'Uno o más servicios de grooming no existen o están inactivos');
          }
          const price = svc.priceCharged ?? serviceType.base_price_medium ?? 0;
          totalEstimate += parseFloat(price);
          validatedServices.push({ ...svc, price });
        }

        // FIX 1a — lock de concurrencia: conflicto por groomer
        const groomerConflict = await conn.queryOne(
          `SELECT id FROM grooming_appointments
           WHERE groomer_id = :gid
             AND branch_id = :bid
             AND status NOT IN ('cancelled', 'no_show')
             AND scheduled_at < DATE_ADD(:sched, INTERVAL :dur MINUTE)
             AND DATE_ADD(scheduled_at, INTERVAL COALESCE(estimated_duration_minutes, 60) MINUTE) > :sched
           LIMIT 1 FOR UPDATE`,
          { gid: groomerId, bid: req.user.branchId, sched: scheduledAt, dur: estimatedDurationMinutes || 60 }
        );
        if (groomerConflict) {
          throw httpError(409, 'El groomer ya tiene un turno en ese horario');
        }

        // FIX 1b — lock de concurrencia: conflicto por paciente
        const patientConflict = await conn.queryOne(
          `SELECT id FROM grooming_appointments
           WHERE patient_id = :pid
             AND branch_id = :bid
             AND status NOT IN ('cancelled', 'no_show')
             AND scheduled_at < DATE_ADD(:sched, INTERVAL :dur MINUTE)
             AND DATE_ADD(scheduled_at, INTERVAL COALESCE(estimated_duration_minutes, 60) MINUTE) > :sched
           LIMIT 1 FOR UPDATE`,
          { pid: patientId, bid: req.user.branchId, sched: scheduledAt, dur: estimatedDurationMinutes || 60 }
        );
        if (patientConflict) {
          throw httpError(409, 'El paciente ya tiene un turno en ese horario');
        }

        const [r] = await conn.query(
          `INSERT INTO grooming_appointments
             (branch_id, patient_id, client_id, groomer_id, scheduled_at,
              estimated_duration_minutes, pickup_required, pickup_address,
              delivery_required, delivery_address, notes, status)
           VALUES (:bid,:pid,:cid,:gid,:sched,:dur,:pickup,:paddr,:del,:daddr,:notes,'scheduled')`,
          {
            bid: req.user.branchId, pid: patientId, cid: clientId, gid: groomerId, sched: scheduledAt, dur: estimatedDurationMinutes,
            pickup: pickupRequired ? 1 : 0, paddr: pickupAddress || null, del: deliveryRequired ? 1 : 0, daddr: deliveryAddress || null,
            notes: notes || null,
          }
        );
        apptId = r.insertId;

        for (const svc of validatedServices) {
          await conn.query(`INSERT INTO grooming_appointment_services (grooming_appointment_id, service_type_id, price_charged, notes) VALUES (?,?,?,?)`, [apptId, svc.serviceTypeId, svc.price, svc.notes || null]);
        }
        await conn.query(`UPDATE grooming_appointments SET estimated_price = ? WHERE id = ?`, [totalEstimate, apptId]);
      });

      return R.created(res, { id: apptId, estimatedPrice: totalEstimate });
    } catch (e) { logGroomingError('POST /grooming/appointments', e, { branchId: req.user?.branchId }); next(e); }
  }
);

router.patch('/:id/status', requirePerm('grooming:update'), body('status').isIn(['scheduled', 'confirmed', 'in_progress', 'ready', 'completed', 'cancelled', 'no_show']), validate, async (req, res, next) => {
  try {
    await db.query(`UPDATE grooming_appointments SET status=:status, updated_at=NOW() WHERE id=:id AND branch_id=:bid`, { status: req.body.status, id: req.params.id, bid: req.user.branchId });
    return R.noContent(res);
  } catch (e) { next(e); }
});

router.post('/:id/record', requirePerm('grooming:update'), body('servicesPerformed').isArray({ min: 1 }), validate, async (req, res, next) => {
  try {
    // FIX 2 — permiso granular para registrar resultado de grooming
    const appointment = await db.queryOne(
      `SELECT id FROM grooming_appointments WHERE id = :id AND branch_id = :bid`,
      { id: req.params.id, bid: req.user.branchId }
    );
    if (!appointment) return R.notFound(res, 'Turno de grooming no encontrado');
    const { servicesPerformed, productsUsed, beforePhotoUrl, afterPhotoUrl, behaviorObservations, coatCondition, skinCondition, vetReferralRequired, vetReferralReason, finalPrice, groomingNotes } = req.body;
    const [r] = await db.query(
      `INSERT INTO grooming_records
         (grooming_appointment_id, services_performed, products_used, before_photo_url, after_photo_url,
          behavior_observations, coat_condition, skin_condition, vet_referral_required, vet_referral_reason,
          final_price, notes, recorded_by)
       VALUES (:aid,:svc,:prod,:before,:after,:beh,:coat,:skin,:vetref,:vetreason,:price,:notes,:uid)`,
      {
        aid: req.params.id, svc: JSON.stringify(servicesPerformed), prod: productsUsed ? JSON.stringify(productsUsed) : null,
        before: beforePhotoUrl || null, after: afterPhotoUrl || null, beh: behaviorObservations || null, coat: coatCondition || null,
        skin: skinCondition || null, vetref: vetReferralRequired ? 1 : 0, vetreason: vetReferralReason || null,
        price: finalPrice || null, notes: groomingNotes || null, uid: req.user.userId,
      }
    );
    if (finalPrice) {
      await db.query(
        `UPDATE grooming_appointments
         SET final_price=:price, status='completed', updated_at=NOW()
         WHERE id=:id AND branch_id=:bid`,
        { price: finalPrice, id: req.params.id, bid: req.user.branchId }
      );
    }
    return R.created(res, { id: r.insertId });
  } catch (e) { next(e); }
});

router.post('/:id/rating', requirePerm('grooming:update'), body('overallScore').isInt({ min: 1, max: 5 }), validate, async (req, res, next) => {
  try {
    // FIX 2 — permiso granular para registrar rating de grooming
    const appointment = await db.queryOne(
      `SELECT id FROM grooming_appointments WHERE id = :id AND branch_id = :bid`,
      { id: req.params.id, bid: req.user.branchId }
    );
    if (!appointment) return R.notFound(res, 'Turno de grooming no encontrado');
    const { overallScore, qualityScore, timelinessScore, grooomerFriendlinessScore, comment, recommendGroomer } = req.body;
    await db.query(
      `INSERT INTO grooming_ratings
         (grooming_appointment_id, client_id, overall_score, quality_score, timeliness_score, groomer_friendliness_score, comment, would_recommend)
       VALUES (:aid,:cid,:overall,:qual,:time,:friendly,:comment,:rec)`,
      {
        aid: req.params.id, cid: req.user.userId, overall: overallScore, qual: qualityScore || null,
        time: timelinessScore || null, friendly: grooomerFriendlinessScore || null, comment: comment || null, rec: recommendGroomer ? 1 : 0,
      }
    );
    return R.created(res);
  } catch (e) { next(e); }
});

module.exports = router;
