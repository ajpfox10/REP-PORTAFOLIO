'use strict';

const { Router } = require('express');
const { db, R, portalAuth } = require('../portal.common');

const router = Router();

router.get('/', portalAuth, async (req, res, next) => {
  try {
    const rows = await db.query(
      // BUG-008: omitir meeting_url excepto cuando la sesión está activa;
      // exponer la URL de sala a sesiones completadas es innecesario e indeseable
      `SELECT ts.id, ts.scheduled_at AS session_date,
              ts.status, ts.session_type, ts.chief_complaint,
              CASE WHEN ts.status IN ('in_progress','ready','confirmed')
                   THEN ts.meeting_url ELSE NULL END AS meeting_url,
              ts.duration_minutes,
              tr.overall_score AS rating,
              p.name AS patient_name, sp.common_name AS species,
              CONCAT(u.first_name,' ',u.last_name) AS vet_name
       FROM tele_sessions ts
       JOIN branches b     ON b.id=ts.branch_id
       JOIN patients p     ON ts.patient_id=p.id
       JOIN species sp     ON p.species_id=sp.id
       JOIN users u        ON ts.vet_id=u.id
       JOIN patient_owners po ON po.patient_id=p.id AND po.client_id=:cid AND po.deleted_at IS NULL
       LEFT JOIN tele_ratings tr ON tr.session_id = ts.id
       WHERE b.organization_id=:orgId
       ORDER BY ts.scheduled_at DESC`,
      { cid: req.owner.clientId, orgId: req.owner.orgId }
    );
    return R.ok(res, rows);
  } catch (e) { next(e); }
});

module.exports = router;
