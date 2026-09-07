'use strict';

/**
 * GET  /follow-ups  — Lista sesiones de tipo follow_up del branch
 * POST /follow-ups  — Crea una sesión de seguimiento (session_type = 'follow_up')
 *
 * Registrado en el gateway bajo el prefijo /follow-ups → telemedicine service.
 */

const { Router } = require('express');
const { body, validateRequest, db, R, crypto } = require('./_common');

const router = Router();

// SECURITY: estados válidos para follow-ups
const VALID_FOLLOW_UP_STATUS = new Set(['scheduled', 'in_progress', 'completed', 'cancelled', 'no_show']);

router.get('/', async (req, res, next) => {
  try {
    const { vetId, patientId } = req.query;

    // SECURITY: cap de limit/page para evitar dumps masivos
    const limit  = Math.min(Math.max(parseInt(req.query.limit || '20', 10) || 20, 1), 100);
    const page   = Math.max(parseInt(req.query.page  || '1',  10) || 1, 1);
    const offset = (page - 1) * limit;

    // SECURITY: whitelist de status para evitar inyección en condición SQL
    const status = (req.query.status && VALID_FOLLOW_UP_STATUS.has(req.query.status)) ? req.query.status : null;

    const conds = ['ts.branch_id = :bid', "ts.session_type = 'follow_up'"];
    const p = { bid: req.user.branchId, limit, offset };

    if (status)    { conds.push('ts.status = :status');        p.status    = status; }
    if (vetId)     { conds.push('ts.vet_id = :vetId');         p.vetId     = parseInt(vetId, 10); }
    if (patientId) { conds.push('ts.patient_id = :patientId'); p.patientId = parseInt(patientId, 10); }

    const where = conds.join(' AND ');
    const rows = await db.query(
      `SELECT ts.id, ts.session_code, ts.status, ts.session_type, ts.scheduled_at,
              ts.duration_minutes, ts.meeting_url, ts.platform_name,
              p.name  AS patient_name,  sp.common_name AS species,
              CONCAT(cl.first_name,' ',cl.last_name) AS client_name, cl.phone,
              CONCAT(u.first_name,' ',u.last_name)   AS vet_name
       FROM tele_sessions ts
       JOIN patients p   ON ts.patient_id = p.id
       JOIN species  sp  ON p.species_id  = sp.id
       JOIN clients  cl  ON ts.client_id  = cl.id
       JOIN users    u   ON ts.vet_id     = u.id
       WHERE ${where}
       ORDER BY ts.scheduled_at DESC
       LIMIT :limit OFFSET :offset`,
      p
    );

    const [{ total }] = await db.query(
      `SELECT COUNT(*) AS total FROM tele_sessions ts WHERE ${where}`,
      { bid: req.user.branchId, ...( status    && { status }),
        ...( vetId     && { vetId }),
        ...( patientId && { patientId }) }
    );

    return R.paginated(res, rows, total, Number(page), Number(limit));
  } catch (e) { next(e); }
});

router.post('/',
  body('patientId').isInt(),
  body('clientId').isInt(),
  body('vetId').isInt(),
  body('scheduledAt').isISO8601(),
  validateRequest,
  async (req, res, next) => {
    try {
      const {
        patientId, clientId, vetId, scheduledAt,
        platformId, durationMinutes = 30, chiefComplaint, notes,
      } = req.body;

      const ownership = await Promise.all([
        db.queryOne(
          `SELECT p.id
             FROM patients p
             JOIN patient_owners po ON po.patient_id = p.id AND po.client_id = :cid AND po.deleted_at IS NULL
             JOIN clients c ON c.id = po.client_id
            WHERE p.id = :pid
              AND p.organization_id = :orgId
              AND c.branch_id = :bid`,
          { pid: patientId, cid: clientId, orgId: req.user.orgId, bid: req.user.branchId }
        ),
        db.queryOne('SELECT id FROM clients WHERE id = :cid AND branch_id = :bid', { cid: clientId, bid: req.user.branchId }),
        db.queryOne('SELECT id FROM users WHERE id = :vid AND branch_id = :bid', { vid: vetId, bid: req.user.branchId }),
      ]);
      if (ownership.some((row) => !row)) {
        return R.forbidden(res, 'Paciente, cliente o veterinario no pertenecen a la sucursal');
      }

      const sessionCode = `TELE-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

      const [r] = await db.query(
        `INSERT INTO tele_sessions
           (branch_id, patient_id, client_id, vet_id,
            session_code, session_type, platform_id,
            scheduled_at, duration_minutes, chief_complaint, notes, status)
         VALUES (:bid,:pid,:cid,:vid,:code,'follow_up',:plat,:sched,:dur,:cc,:notes,'scheduled')`,
        {
          bid:  req.user.branchId,
          pid:  patientId,
          cid:  clientId,
          vid:  vetId,
          code: sessionCode,
          plat: platformId || null,
          sched: scheduledAt,
          dur:  durationMinutes,
          cc:   chiefComplaint || null,
          notes: notes || null,
        }
      );

      return R.created(res, { id: r.insertId, sessionCode, sessionType: 'follow_up' });
    } catch (e) { next(e); }
  }
);

module.exports = { router };
