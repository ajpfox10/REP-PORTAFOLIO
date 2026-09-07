'use strict';

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { getAnySecret } = require('../../../../shared/secrets');
const {
  crypto,
  body,
  validateRequest,
  db,
  R,
  webrtc,
  fcm,
  sendTemplate,
  log,
} = require('./_common');

const router = Router();

async function requireScopedSession(req, res) {
  const session = await db.queryOne(
    `SELECT id, status
     FROM tele_sessions
     WHERE id = :id AND branch_id = :bid`,
    { id: req.params.id, bid: req.user.branchId }
  );
  if (session) return session;
  R.notFound(res, 'Sesión no encontrada');
  return null;
}

// B-7: rate limit específico para creación de sesiones de telemedicina
const createSessionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => `tele-session-create:${req.user?.branchId || req.ip}`,
  message: { error: 'Demasiadas sesiones creadas. Intente más tarde.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const getWebrtcConfig = [(_req, res) => R.ok(res, { ...webrtc.getIceServers(), provider: webrtc.PROVIDER })];

router.get('/', async (req, res, next) => {
  try {
    const { status, vetId, date, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    const conds  = ['ts.branch_id = :bid'];
    const p      = { bid: req.user.branchId, limit: parseInt(limit), offset: parseInt(offset) };
    if (status) { conds.push('ts.status = :status'); p.status = status; }
    if (vetId)  { conds.push('ts.vet_id = :vetId');  p.vetId  = vetId; }
    if (date)   { conds.push('DATE(ts.scheduled_at) = :date'); p.date = date; }

    const rows = await db.query(
      `SELECT ts.id, ts.session_code, ts.status, ts.session_type, ts.scheduled_at,
              ts.duration_minutes,
              CASE WHEN ts.status IN ('in_progress', 'ready', 'confirmed', 'scheduled', 'waiting')
                   THEN ts.meeting_url
                   ELSE NULL
              END AS meeting_url,
              ts.platform_name,
              p.name AS patient_name, sp.common_name AS species,
              CONCAT(cl.first_name,' ',cl.last_name) AS client_name, cl.phone,
              CONCAT(u.first_name,' ',u.last_name) AS vet_name
       FROM tele_sessions ts
       JOIN patients p    ON ts.patient_id  = p.id
       JOIN species  sp   ON p.species_id   = sp.id
       JOIN clients  cl   ON ts.client_id   = cl.id
       JOIN users    u    ON ts.vet_id       = u.id
       WHERE ${conds.join(' AND ')}
       ORDER BY ts.scheduled_at DESC
       LIMIT :limit OFFSET :offset`,
      p
    );
    // T-1: paginación server-side — incluir total para que el frontend pagine correctamente
    const countP = { bid: req.user.branchId };
    if (status) countP.status = status;
    if (vetId) countP.vetId = vetId;
    if (date) countP.date = date;
    const [{ total }] = await db.query(
      `SELECT COUNT(*) AS total FROM tele_sessions ts WHERE ${conds.join(' AND ')}`,
      countP
    );
    return R.paginated(res, rows, total, parseInt(page), Math.min(parseInt(limit), 100));
  } catch (e) { next(e); }
});

router.get('/today', async (req, res, next) => {
  try {
    const rows = await db.query(
      `SELECT * FROM v_tele_today WHERE branch_id = :bid ORDER BY scheduled_at`,
      { bid: req.user.branchId }
    );
    return R.ok(res, rows);
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const session = await db.queryOne(
      `SELECT ts.*, tp.name AS platform_name,
              p.name AS patient_name, sp.common_name AS species,
              CONCAT(cl.first_name,' ',cl.last_name) AS client_name, cl.email, cl.phone,
              CONCAT(u.first_name,' ',u.last_name) AS vet_name
       FROM tele_sessions ts
       LEFT JOIN tele_platforms tp ON ts.platform_id = tp.id
       JOIN patients p    ON ts.patient_id = p.id
       JOIN species  sp   ON p.species_id  = sp.id
       JOIN clients  cl   ON ts.client_id  = cl.id
       JOIN users    u    ON ts.vet_id     = u.id
       WHERE ts.id = :id AND ts.branch_id = :bid`,
      { id: req.params.id, bid: req.user.branchId }
    );
    if (!session) return R.notFound(res);

    const [preAnamnesis, messages, prescriptions, docs] = await Promise.all([
      db.queryOne(`SELECT * FROM tele_pre_anamnesis WHERE session_id = :sid`, { sid: req.params.id }),
      db.query(
        `SELECT tm.id, tm.sender_type, tm.message_text, tm.sent_at, tm.is_read,
                tm.attachment_url, tm.attachment_type
         FROM tele_messages tm WHERE tm.session_id = :sid ORDER BY tm.sent_at ASC`,
        { sid: req.params.id }
      ),
      db.query(
        `SELECT tdp.*, pi.medication_name, pi.dose, pi.frequency, pi.duration_days
         FROM tele_digital_prescriptions tdp
         LEFT JOIN prescription_items pi ON pi.prescription_id = tdp.prescription_id
         WHERE tdp.session_id = :sid`,
        { sid: req.params.id }
      ),
      db.query(
        `SELECT * FROM tele_shared_documents WHERE session_id = :sid ORDER BY shared_at DESC`,
        { sid: req.params.id }
      ),
    ]);

    return R.ok(res, { ...session, preAnamnesis, messages, prescriptions, sharedDocuments: docs });
  } catch (e) { next(e); }
});

router.post('/',
  createSessionLimiter,
  body('patientId').isInt(),
  body('clientId').isInt(),
  body('vetId').isInt(),
  body('scheduledAt').isISO8601(),
  body('sessionType').isIn(['consultation', 'follow_up', 'second_opinion', 'emergency', 'prescription_renewal']),
  validateRequest,
  async (req, res, next) => {
    try {
      const {
        patientId, clientId, vetId, scheduledAt, sessionType,
        platformId, durationMinutes = 30, chiefComplaint, notes,
      } = req.body;

      const ownership = await Promise.all([
        db.queryOne(
          `SELECT p.id
           FROM patients p
           JOIN patient_owners po
             ON po.patient_id = p.id
            AND po.client_id = :cid
            AND po.deleted_at IS NULL
           JOIN clients c ON c.id = po.client_id
           WHERE p.id = :pid
             AND p.organization_id = :orgId
             AND p.deleted_at IS NULL
             AND c.branch_id = :bid
             AND c.deleted_at IS NULL`,
          { pid: patientId, cid: clientId, orgId: req.user.orgId, bid: req.user.branchId }
        ),
        db.queryOne(
          `SELECT id FROM users WHERE id = :vid AND branch_id = :bid AND is_active = TRUE`,
          { vid: vetId, bid: req.user.branchId }
        ),
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
         VALUES (:bid,:pid,:cid,:vid,:code,:type,:plat,:sched,:dur,:cc,:notes,'scheduled')`,
        {
          bid: req.user.branchId, pid: patientId, cid: clientId, vid: vetId,
          code: sessionCode, type: sessionType, plat: platformId || null,
          sched: scheduledAt, dur: durationMinutes,
          cc: chiefComplaint || null, notes: notes || null,
        }
      );
      return R.created(res, { id: r.insertId, sessionCode });
    } catch (e) { next(e); }
  }
);

router.patch('/:id/status',
  body('status').isIn(['scheduled', 'waiting', 'in_progress', 'completed', 'cancelled', 'no_show']),
  validateRequest,
  async (req, res, next) => {
    try {
      const updates = { status: req.body.status };
      if (req.body.status === 'in_progress') updates.started_at = new Date().toISOString();
      if (req.body.status === 'completed') updates.ended_at = new Date().toISOString();
      if (req.body.meetingUrl) updates.meeting_url = req.body.meetingUrl;
      if (req.body.connectionQuality) updates.connection_quality = req.body.connectionQuality;

      const sets = Object.keys(updates).map((k) => `${k} = :${k}`).join(', ');
      await db.query(
        `UPDATE tele_sessions SET ${sets}, updated_at=NOW() WHERE id=:id AND branch_id=:bid`,
        { ...updates, id: req.params.id, bid: req.user.branchId }
      );
      return R.noContent(res);
    } catch (e) { next(e); }
  }
);

router.post('/:id/pre-anamnesis',
  body('currentSymptoms').notEmpty(),
  validateRequest,
  async (req, res, next) => {
    try {
      if (!await requireScopedSession(req, res)) return;

      const {
        currentSymptoms, symptomsDuration, symptomsOnset,
        currentMedications, recentChanges, ownerConcerns,
        appetiteChange, behaviorChange, mediaUrls,
      } = req.body;

      await db.query(
        `INSERT INTO tele_pre_anamnesis
           (session_id, current_symptoms, symptoms_duration, symptoms_onset,
            current_medications, recent_changes, owner_concerns,
            appetite_change, behavior_change, media_urls, submitted_by)
         VALUES (:sid,:sym,:dur,:onset,:meds,:changes,:concerns,:app,:beh,:media,:uid)
         ON DUPLICATE KEY UPDATE
           current_symptoms=VALUES(current_symptoms), symptoms_duration=VALUES(symptoms_duration)`,
        {
          sid: req.params.id, sym: currentSymptoms, dur: symptomsDuration || null,
          onset: symptomsOnset || null, meds: currentMedications || null,
          changes: recentChanges || null, concerns: ownerConcerns || null,
          app: appetiteChange || null, beh: behaviorChange || null,
          media: mediaUrls ? JSON.stringify(mediaUrls) : null, uid: req.user.userId,
        }
      );
      return R.created(res);
    } catch (e) { next(e); }
  }
);

router.post('/:id/messages', body('messageText').optional(), async (req, res, next) => {
  try {
    if (!await requireScopedSession(req, res)) return;

    const { messageText, senderType = 'vet', attachmentUrl, attachmentType } = req.body;
    if (!messageText && !attachmentUrl) return R.badRequest(res, 'message or attachment required');

    const VALID_SENDER_TYPES = new Set(['vet', 'client', 'system']);
    if (!VALID_SENDER_TYPES.has(senderType)) {
      return R.badRequest(res, 'senderType debe ser vet, client o system');
    }
    if (senderType === 'client' && !req.user.roles?.includes('client')) {
      return R.forbidden(res, 'No puedes enviar mensajes como cliente');
    }

    const [r] = await db.query(
      `INSERT INTO tele_messages
         (session_id, sender_id, sender_type, message_text, attachment_url, attachment_type)
       VALUES (:sid,:uid,:type,:msg,:att,:attType)`,
      {
        sid: req.params.id, uid: req.user.userId, type: senderType,
        msg: messageText || null, att: attachmentUrl || null, attType: attachmentType || null,
      }
    );
    return R.created(res, { id: r.insertId });
  } catch (e) { next(e); }
});

router.post('/:id/prescription',
  body('prescriptionId').isInt(),
  validateRequest,
  async (req, res, next) => {
    try {
      if (!await requireScopedSession(req, res)) return;

      const userRoles = req.user.roles || [];
      if (!['veterinarian', 'tele_vet', 'vet', 'superadmin'].some((role) => userRoles.includes(role))) {
        return R.forbidden(res, 'Solo veterinarios pueden emitir prescripciones');
      }
      const { prescriptionId, validityDays = 30 } = req.body;
      const signatureData = `${prescriptionId}-${req.user.userId}-${Date.now()}`;
      // Firma HMAC con secreto del servidor: no recomputable ni forgeable por terceros
      // (a diferencia de un SHA-256 plano sobre datos predecibles). Da integridad + autenticidad.
      const signingSecret = getAnySecret(['PRESCRIPTION_SIGNING_SECRET', 'FIELD_ENCRYPTION_SECRET', 'JWT_SECRET']);
      const signatureHash = crypto.createHmac('sha256', signingSecret).update(signatureData).digest('hex');
      const expiresAt = new Date(Date.now() + validityDays * 86400000).toISOString().slice(0, 10);

      const [r] = await db.query(
        `INSERT INTO tele_digital_prescriptions
           (session_id, prescription_id, vet_id, signature_hash, expires_at, status)
         VALUES (:sid,:pid,:uid,:hash,:exp,'active')`,
        {
          sid: req.params.id, pid: prescriptionId,
          uid: req.user.userId, hash: signatureHash, exp: expiresAt,
        }
      );

      return R.created(res, { id: r.insertId, signatureHash, expiresAt });
    } catch (e) { next(e); }
  }
);

router.post('/:id/rating',
  body('overallScore').isInt({ min: 1, max: 5 }),
  validateRequest,
  async (req, res, next) => {
    try {
      const session = await db.queryOne(
        `SELECT id, status FROM tele_sessions WHERE id = :id AND branch_id = :bid`,
        { id: req.params.id, bid: req.user.branchId }
      );
      if (!session) return R.notFound(res);
      if (session.status !== 'completed') {
        return R.conflict(res, 'Solo se puede puntuar una sesión completada');
      }
      const { overallScore, vetScore, connectionScore, platformScore, comment } = req.body;
      await db.query(
        `INSERT INTO tele_ratings
           (session_id, rated_by, overall_score, vet_score, connection_score, platform_score, comment)
         VALUES (:sid,:uid,:overall,:vet,:conn,:plat,:comment)`,
        {
          sid: req.params.id, uid: req.user.userId,
          overall: overallScore, vet: vetScore || null,
          conn: connectionScore || null, plat: platformScore || null,
          comment: comment || null,
        }
      );
      return R.created(res);
    } catch (e) { next(e); }
  }
);

router.get('/webrtc-config', ...getWebrtcConfig);

router.post('/:id/room', async (req, res, next) => {
  try {
    const session = await db.queryOne(
      `SELECT ts.*, cl.email AS client_email, cl.phone AS client_phone,
              CONCAT(u.first_name,' ',u.last_name) AS vet_name,
              CONCAT(cl.first_name,' ',cl.last_name) AS client_name
       FROM tele_sessions ts
       JOIN clients cl ON ts.client_id = cl.id
       JOIN users   u  ON ts.vet_id    = u.id
       WHERE ts.id = :id AND ts.branch_id = :bid`,
      { id: req.params.id, bid: req.user.branchId }
    );
    if (!session) return R.notFound(res);

    const existing = await db.queryOne(
      `SELECT id, room_name, room_url FROM webrtc_rooms
       WHERE session_id = :sid AND status IN ('created','active')`,
      { sid: req.params.id }
    );
    if (existing) {
      return R.ok(res, existing);
    }

    const roomName  = webrtc.buildRoomName(req.params.id);
    const expiresAt = Math.floor(Date.now() / 1000) + (session.duration_minutes || 60) * 60 + 900;

    const room = await webrtc.createRoom({
      roomName,
      expiresAt,
      enableRecording: req.body.enableRecording || false,
      maxParticipants: 2,
    });

    const [r] = await db.query(
      `INSERT INTO webrtc_rooms
         (session_id, room_name, provider, provider_room_id, room_url, host_url, expires_at)
       VALUES (:sid, :name, :prov, :provId, :url, :hostUrl, FROM_UNIXTIME(:exp))`,
      {
        sid: session.id,
        name: room.roomName,
        prov: webrtc.PROVIDER,
        provId: room.providerRoomId || null,
        url: room.roomUrl || null,
        hostUrl: room.providerData?.hostRoomUrl || null,
        exp: expiresAt,
      }
    );
    const roomId = r.insertId;

    await db.query(
      'UPDATE tele_sessions SET meeting_url=:url, platform_name=:prov WHERE id=:id',
      { url: room.roomUrl, prov: webrtc.PROVIDER, id: session.id }
    );

    if (session.client_phone) {
      sendTemplate('whatsapp', session.client_phone, 'teleSessionReady', {
        clientName: session.client_name,
        vetName: session.vet_name,
        joinUrl: room.roomUrl || '',
      }).catch(() => {});
    }
    await fcm.sendToTopic(`owner_${session.client_id}`, {
      title: 'ðŸ”¹ Tu videoconsulta estÃ¡ lista',
      body: `Dr. ${session.vet_name} estÃ¡ listo. HacÃ© click para unirte.`,
      data: { sessionId: String(session.id), roomUrl: room.roomUrl || '' },
    }).catch((err) => log.warn('fcm.send.failed', { err: err.message, sessionId: session.id }));

    return R.created(res, { roomId, roomName: room.roomName, roomUrl: room.roomUrl, provider: webrtc.PROVIDER });
  } catch (e) { next(e); }
});

router.get('/:id/room', async (req, res, next) => {
  try {
    if (!await requireScopedSession(req, res)) return;

    const room = await db.queryOne(
      `SELECT wr.*, COUNT(wp.id) AS participant_count
       FROM webrtc_rooms wr
       LEFT JOIN webrtc_participants wp ON wp.room_id = wr.id AND wp.left_at IS NULL
       WHERE wr.session_id = :sid
       GROUP BY wr.id
       ORDER BY wr.created_at DESC LIMIT 1`,
      { sid: req.params.id }
    );
    if (!room) return R.notFound(res, 'Sala no creada todavÃ­a');
    return R.ok(res, room);
  } catch (e) { next(e); }
});

router.post('/:id/room/token', async (req, res, next) => {
  try {
    const session = await db.queryOne(
      `SELECT id FROM tele_sessions WHERE id = :id AND branch_id = :bid AND status IN ('scheduled','confirmed','waiting','in_progress','ready')`,
      { id: req.params.id, bid: req.user.branchId }
    );
    if (!session) return R.notFound(res, 'Sesión no encontrada o no activa');

    const room = await db.queryOne(
      `SELECT * FROM webrtc_rooms WHERE session_id = :sid AND status IN ('created','active')`,
      { sid: req.params.id }
    );
    if (!room) return R.notFound(res, 'Sala no encontrada o expirada');

    const { identity, role = 'guest' } = req.body;
    if (!identity) return R.badRequest(res, 'identity requerido (email o userId)');
    if (!['guest', 'host'].includes(role)) return R.badRequest(res, 'role inválido');

    const allowedIdentities = new Set(
      [req.user.userId, req.user.email].filter(Boolean).map((value) => String(value))
    );
    if (!allowedIdentities.has(String(identity))) {
      return R.forbidden(res, 'Solo puede emitir un token para su propia identidad');
    }

    const hostRoles = new Set(['superadmin', 'org_admin', 'veterinarian', 'tele_vet', 'vet']);
    if (role === 'host' && !(req.user.roles || []).some((userRole) => hostRoles.has(userRole))) {
      return R.forbidden(res, 'No tiene permisos para emitir un token de anfitrión');
    }

    const result = await webrtc.generateToken({
      roomName: room.room_name,
      identity,
      role,
      ttlSeconds: 3600,
    });

    await db.query(
      `INSERT INTO webrtc_participants (room_id, identity, role, joined_at)
       VALUES (:rid, :identity, :role, NOW())
       ON DUPLICATE KEY UPDATE joined_at = NOW(), left_at = NULL`,
      { rid: room.id, identity, role }
    );

    if (room.status === 'created') {
      await db.query(`UPDATE webrtc_rooms SET status='active' WHERE id=:id`, { id: room.id });
    }

    return R.ok(res, { ...result, roomName: room.room_name, provider: webrtc.PROVIDER });
  } catch (e) { next(e); }
});

router.delete('/:id/room', async (req, res, next) => {
  try {
    if (!await requireScopedSession(req, res)) return;

    const room = await db.queryOne(
      `SELECT * FROM webrtc_rooms WHERE session_id = :sid`,
      { sid: req.params.id }
    );
    if (!room) return R.notFound(res, 'Sala no encontrada');

    await webrtc.deleteRoom(room.room_name).catch(() => {});
    await db.query(
      `UPDATE webrtc_rooms SET status='ended', updated_at=NOW() WHERE id=:id`,
      { id: room.id }
    );
    await db.query(
      `UPDATE webrtc_participants SET left_at=NOW(),
         duration_sec = TIMESTAMPDIFF(SECOND, joined_at, NOW())
       WHERE room_id=:rid AND left_at IS NULL`,
      { rid: room.id }
    );
    return R.noContent(res);
  } catch (e) { next(e); }
});

router.post('/:id/room/recording/start', async (req, res, next) => {
  try {
    if (!await requireScopedSession(req, res)) return;

    const room = await db.queryOne(
      `SELECT * FROM webrtc_rooms WHERE session_id=:sid AND status='active'`,
      { sid: req.params.id }
    );
    if (!room) return R.notFound(res, 'No hay sala activa');

    const { recordingId } = await webrtc.startRecording(room.room_name);

    const [r] = await db.query(
      `INSERT INTO webrtc_recordings (room_id, session_id, provider_rec_id, status, started_at)
       VALUES (:rid, :sid, :recId, 'recording', NOW())`,
      { rid: room.id, sid: req.params.id, recId: recordingId }
    );
    return R.created(res, { id: r.insertId, recordingId });
  } catch (e) { next(e); }
});

router.post('/:id/room/recording/stop', async (req, res, next) => {
  try {
    if (!await requireScopedSession(req, res)) return;

    const rec = await db.queryOne(
      `SELECT wr.room_name, wrec.*
       FROM webrtc_recordings wrec
       JOIN webrtc_rooms wr ON wrec.room_id = wr.id
       WHERE wrec.session_id = :sid AND wrec.status = 'recording'
       ORDER BY wrec.started_at DESC LIMIT 1`,
      { sid: req.params.id }
    );
    if (!rec) return R.notFound(res, 'No hay grabaciÃ³n activa');

    const result = await webrtc.stopRecording(rec.room_name, rec.provider_rec_id);

    await db.query(
      `UPDATE webrtc_recordings SET status='processing', duration_sec=:dur, ended_at=NOW(), storage_url=:url
       WHERE id=:id`,
      { dur: result.duration || null, url: result.url || null, id: rec.id }
    );
    return R.ok(res, { id: rec.id, ...result });
  } catch (e) { next(e); }
});

router.get('/:id/recordings', async (req, res, next) => {
  try {
    if (!await requireScopedSession(req, res)) return;

    const rows = await db.query(
      `SELECT wrec.*, wr.room_name
       FROM webrtc_recordings wrec
       JOIN webrtc_rooms wr ON wrec.room_id = wr.id
       WHERE wrec.session_id = :sid
       ORDER BY wrec.created_at DESC`,
      { sid: req.params.id }
    );
    return R.ok(res, rows);
  } catch (e) { next(e); }
});

router.get('/:id/waiting-room', async (req, res, next) => {
  try {
    if (!await requireScopedSession(req, res)) return;

    const room = await db.queryOne(
      `SELECT id FROM webrtc_rooms WHERE session_id=:sid AND status IN ('created','active')`,
      { sid: req.params.id }
    );
    if (!room) return R.notFound(res, 'Sala no encontrada');

    const rows = await db.query(
      `SELECT * FROM webrtc_waiting_room WHERE room_id=:rid AND status='waiting' ORDER BY joined_at ASC`,
      { rid: room.id }
    );
    return R.ok(res, rows);
  } catch (e) { next(e); }
});

router.post('/:id/waiting-room/join',
  body('displayName').notEmpty(),
  validateRequest,
  async (req, res, next) => {
    try {
      if (!await requireScopedSession(req, res)) return;

      const room = await db.queryOne(
        `SELECT id FROM webrtc_rooms WHERE session_id=:sid AND status IN ('created','active')`,
        { sid: req.params.id }
      );
      if (!room) return R.notFound(res, 'Sala no encontrada');

      const { displayName } = req.body;
      const identity = req.user.email || String(req.user.userId);
      const [r] = await db.query(
        `INSERT INTO webrtc_waiting_room (room_id, identity, display_name, status, joined_at)
         VALUES (:rid,:identity,:name,'waiting',NOW())`,
        { rid: room.id, identity, name: displayName }
      );
      return R.created(res, { id: r.insertId });
    } catch (e) { next(e); }
  }
);

router.post('/:id/waiting-room/:wId/admit', async (req, res, next) => {
  try {
    if (!await requireScopedSession(req, res)) return;

    const [result] = await db.query(
      `UPDATE webrtc_waiting_room ww
       JOIN webrtc_rooms wr ON wr.id = ww.room_id
       SET ww.status='admitted', ww.acted_at=NOW(), ww.decided_by=:uid
       WHERE ww.id=:wid AND wr.session_id=:sid`,
      { wid: req.params.wId, sid: req.params.id, uid: req.user.userId }
    );
    if (!result.affectedRows) return R.notFound(res, 'Participante en espera no encontrado');
    return R.noContent(res);
  } catch (e) { next(e); }
});

router.post('/:id/waiting-room/:wId/reject', async (req, res, next) => {
  try {
    if (!await requireScopedSession(req, res)) return;

    const [result] = await db.query(
      `UPDATE webrtc_waiting_room ww
       JOIN webrtc_rooms wr ON wr.id = ww.room_id
       SET ww.status='rejected', ww.acted_at=NOW(), ww.decided_by=:uid
       WHERE ww.id=:wid AND wr.session_id=:sid`,
      { wid: req.params.wId, sid: req.params.id, uid: req.user.userId }
    );
    if (!result.affectedRows) return R.notFound(res, 'Participante en espera no encontrado');
    return R.noContent(res);
  } catch (e) { next(e); }
});

router.get('/:id/room/participants', async (req, res, next) => {
  try {
    if (!await requireScopedSession(req, res)) return;

    const room = await db.queryOne(
      `SELECT id FROM webrtc_rooms WHERE session_id=:sid ORDER BY created_at DESC LIMIT 1`,
      { sid: req.params.id }
    );
    if (!room) return R.notFound(res, 'Sala no encontrada');

    const rows = await db.query(
      `SELECT * FROM webrtc_participants WHERE room_id=:rid ORDER BY joined_at DESC`,
      { rid: room.id }
    );
    return R.ok(res, rows);
  } catch (e) { next(e); }
});

router.post('/:id/room/participants/:identity/leave', async (req, res, next) => {
  try {
    if (!await requireScopedSession(req, res)) return;

    const room = await db.queryOne(
      `SELECT id FROM webrtc_rooms WHERE session_id=:sid ORDER BY created_at DESC LIMIT 1`,
      { sid: req.params.id }
    );
    if (!room) return R.notFound(res, 'Sala no encontrada');

    await db.query(
      `UPDATE webrtc_participants
       SET left_at=NOW(), duration_sec=TIMESTAMPDIFF(SECOND, joined_at, NOW())
       WHERE room_id=:rid AND identity=:identity AND left_at IS NULL`,
      { rid: room.id, identity: req.params.identity }
    );
    return R.noContent(res);
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.getWebrtcConfig = getWebrtcConfig;
