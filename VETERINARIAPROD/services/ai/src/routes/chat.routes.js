'use strict';

const { Router } = require('express');
const { body, param } = require('express-validator');
const {
  db,
  R,
  ai,
  CHAT_SYSTEM_PROMPT,
  sanitizeForPrompt,
  requirePerm,
  validate,
  getUser,
  ensurePatientInUserScope,
  withAiTimeout,
  log,
} = require('../ai.common');
const { requireUsageLimit, requireUserUsageLimit } = require('../../../../shared/usageLimits');

const router = Router();

router.post('/',
  requirePerm('ai:use'),
  requireUsageLimit('ai_chatbot'),
  requireUserUsageLimit('ai_chatbot'),  // OT-093: per-user daily cap
  // OT-092: length cap + control-char sanitization to prevent prompt injection
  body('message')
    .isString().trim()
    .customSanitizer((v) => v.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ''))
    .notEmpty().isLength({ max: 2000 }),
  body('patientId').optional().isInt({ min: 1 }),
  validate,
  async (req, res, next) => {
    try {
      const { message, patientId } = req.body;
      const user = getUser(req);

      if (patientId) {
        const scoped = await ensurePatientInUserScope(patientId, user);
        if (!scoped) return R.notFound(res, 'Paciente no encontrado');
      }

      let sessionId = null;
      const [ins] = await db.query(
        `INSERT INTO ai_chat_sessions (org_id, user_id, patient_id, model_provider)
         VALUES (:org, :uid, :pid, :prov)`,
        { org: user.orgId, uid: user.userId, pid: patientId || null, prov: ai.PROVIDER }
      ).catch((err) => {
        log.warn('ai chat session insert failed', { err: err.message });
        return [{ insertId: null }];
      });
      sessionId = ins.insertId;

      let patientContext = '';
      if (patientId) {
        const p = await db.queryOne(
          `SELECT p.name, p.birthdate, sp.common_name AS species, br.name AS breed, p.sex, p.weight_kg AS weight
           FROM patients p
           LEFT JOIN species sp ON p.species_id = sp.id
           LEFT JOIN breeds  br ON p.breed_id   = br.id
           WHERE p.id = :pid AND p.organization_id = :org`, { pid: patientId, org: user.orgId }
        );
        if (p) {
          const age = p.birthdate ? Math.floor((Date.now() - new Date(p.birthdate)) / (365.25 * 86_400_000)) : null;
          patientContext = `\n\nPACIENTE EN CONTEXTO: ${sanitizeForPrompt(p.name, 100)} | ${sanitizeForPrompt(p.species, 50)} ${sanitizeForPrompt(p.breed, 80)} | ${age ? age + ' años' : ''} | Sexo: ${sanitizeForPrompt(p.sex, 20) || 'N/A'} | Peso: ${p.weight ? p.weight + 'kg' : 'N/A'}`;
        }
      }

      const messages = [
        { role: 'system', content: CHAT_SYSTEM_PROMPT + patientContext },
        { role: 'user', content: message },
      ];
      const response = await withAiTimeout((signal) =>
        ai.complete(messages, { maxTokens: 1024, temperature: 0.5, signal })
      );

      if (sessionId) {
        await db.query(
          `INSERT INTO ai_chat_messages (session_id, role, content) VALUES
           (:sid, 'user', :userMsg), (:sid, 'assistant', :aiMsg)`,
          { sid: sessionId, userMsg: message, aiMsg: response }
        ).catch((err) => log.warn('ai chat messages insert failed', { err: err.message }));
        await db.query(
          `UPDATE ai_chat_sessions SET updated_at=NOW(), message_count=message_count+2 WHERE id=:sid`,
          { sid: sessionId }
        ).catch((err) => log.warn('ai chat session update failed', { err: err.message }));
      }

      return R.created(res, { sessionId, response });
    } catch (e) { next(e); }
  }
);

router.get('/:sessionId',
  requirePerm('ai:use'),
  param('sessionId').isInt({ min: 1 }),
  validate,
  async (req, res, next) => {
    try {
      const user = getUser(req);
      const session = await db.queryOne(
        `SELECT s.*, p.name AS patient_name FROM ai_chat_sessions s
         LEFT JOIN patients p ON s.patient_id = p.id
         WHERE s.id = :sid AND s.org_id = :org AND s.user_id = :uid`,
        { sid: req.params.sessionId, org: user.orgId, uid: user.userId }
      ).catch((err) => {
        log.warn('ai chat session lookup failed', { err: err.message });
        return null;
      });
      if (!session) return R.notFound(res, 'Sesión no encontrada');

      const messages = await db.query(
        `SELECT id, role, content, created_at FROM ai_chat_messages
         WHERE session_id = :sid ORDER BY id ASC`,
        { sid: session.id }
      );
      return R.ok(res, { session, messages });
    } catch (e) { next(e); }
  }
);

router.post('/:sessionId/messages',
  requirePerm('ai:use'),
  requireUsageLimit('ai_chatbot'),
  requireUserUsageLimit('ai_chatbot'),  // OT-093: per-user daily cap
  param('sessionId').isInt({ min: 1 }),
  // OT-092: length cap + control-char sanitization
  body('message')
    .isString().trim()
    .customSanitizer((v) => v.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ''))
    .notEmpty().isLength({ max: 2000 }),
  validate,
  async (req, res, next) => {
    try {
      const user = getUser(req);
      const session = await db.queryOne(
        `SELECT * FROM ai_chat_sessions WHERE id = :sid AND org_id = :org AND user_id = :uid`,
        { sid: req.params.sessionId, org: user.orgId, uid: user.userId }
      ).catch((err) => {
        log.warn('ai chat session lookup failed', { err: err.message });
        return null;
      });
      if (!session) return R.notFound(res, 'Sesión no encontrada');

      // OT-095: fetch up to 100 messages then trim to token budget (1 token ≈ 4 chars)
      const MAX_HISTORY_TOKENS = parseInt(process.env.AI_CHAT_MAX_HISTORY_TOKENS || '6000', 10);
      const rawHistory = await db.query(
        `SELECT role, content FROM ai_chat_messages
         WHERE session_id = :sid ORDER BY id DESC LIMIT 100`,
        { sid: session.id }
      );
      rawHistory.reverse();

      let tokenBudget = MAX_HISTORY_TOKENS;
      const history = [];
      for (let i = rawHistory.length - 1; i >= 0; i--) {
        const estTokens = Math.ceil((rawHistory[i].content || '').length / 4);
        if (tokenBudget - estTokens < 0 && history.length > 0) break;
        tokenBudget -= estTokens;
        history.unshift(rawHistory[i]);
      }

      const messages = [
        { role: 'system', content: CHAT_SYSTEM_PROMPT },
        ...history,
        { role: 'user', content: req.body.message },
      ];
      const response = await withAiTimeout((signal) =>
        ai.complete(messages, { maxTokens: 1024, temperature: 0.5, signal })
      );

      await db.query(
        `INSERT INTO ai_chat_messages (session_id, role, content) VALUES
         (:sid, 'user', :userMsg), (:sid, 'assistant', :aiMsg)`,
        { sid: session.id, userMsg: req.body.message, aiMsg: response }
      );
      await db.query(
        `UPDATE ai_chat_sessions SET updated_at=NOW(), message_count=message_count+2 WHERE id=:sid`,
        { sid: session.id }
      );

      return R.ok(res, { response });
    } catch (e) { next(e); }
  }
);

module.exports = router;
