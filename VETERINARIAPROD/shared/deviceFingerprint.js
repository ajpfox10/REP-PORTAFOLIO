'use strict';
/**
 * Device Fingerprint — detecta cambio de dispositivo en sesiones activas.
 * El cliente envía X-Device-Fingerprint en cada request.
 * Al login, se guarda el fingerprint en sessions.
 * En requests posteriores, si cambia → security event.
 *
 * Flag-gated: DEVICE_FINGERPRINT_ENABLED=true en env
 */
const crypto = require('crypto');
const db     = require('./db');
const logger = require('./logger');

const ENABLED = () => {
  if (process.env.DEVICE_FINGERPRINT_ENABLED === 'true') return true;
  if (process.env.DEVICE_FINGERPRINT_ENABLED === 'false') return false;
  return process.env.NODE_ENV === 'production';
};

// Si DEVICE_FINGERPRINT_BLOCK=false, solo loguea al detectar cambio de dispositivo.
// Por defecto bloquea (fail-closed). Setear DEVICE_FINGERPRINT_BLOCK=false para modo observación.
const BLOCK_ON_CHANGE = () => process.env.DEVICE_FINGERPRINT_BLOCK !== 'false';

/**
 * Normaliza el fingerprint del header (trunca a 64 chars, lowercase hex).
 */
function normalizeFingerprint(raw) {
  if (!raw) return null;
  // Si ya es hex, usar directo; si no, hashear
  if (/^[a-f0-9]{8,64}$/i.test(raw)) return raw.toLowerCase().slice(0, 64);
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

/**
 * Guarda el fingerprint del dispositivo al crear sesión.
 * Llamar desde el controller de login tras crear la sesión.
 */
async function recordDeviceFingerprint(sessionId, rawFingerprint) {
  if (!ENABLED()) return;
  const fp = normalizeFingerprint(rawFingerprint);
  if (!fp || !sessionId) return;

  try {
    await db.query(
      'UPDATE sessions SET device_fingerprint = :fp WHERE id = :sessionId',
      { fp, sessionId },
    );
  } catch (err) {
    logger.warn('[deviceFingerprint] Failed to record fingerprint', { err: err.message });
  }
}

/**
 * Middleware que verifica que el fingerprint del request coincide con el de la sesión.
 * Usa req.user.jti si existe; como fallback acepta X-Session-Id.
 *
 * Por defecto BLOQUEA (401) ante cambio de dispositivo en producción
 * (ver BLOCK_ON_CHANGE). Setear DEVICE_FINGERPRINT_BLOCK=false para modo observación
 * (solo loguea el evento de seguridad y continúa).
 *
 * Limitación conocida: si el cliente no envía el header X-Device-Fingerprint el chequeo
 * se omite (fail-open) para no romper clientes legítimos que aún no lo implementan.
 * Es una capa de defensa en profundidad, no un control de autenticación primario.
 */
async function checkDeviceFingerprint(req, _res, next) {
  if (!ENABLED()) return next();

  const rawFp    = req.headers['x-device-fingerprint'];
  const sessionId = req.headers['x-session-id'] || null;
  const sessionJti = req.user?.jti || req.headers['x-jti'] || null;

  if (!rawFp || (!sessionId && !sessionJti)) return next();

  try {
    const fp  = normalizeFingerprint(rawFp);
    const row = await db.queryOne(
      `SELECT device_fingerprint, user_id, org_id, id
       FROM sessions
       WHERE expires_at > NOW()
         AND is_revoked = FALSE
         AND ((:sessionId IS NOT NULL AND id = :sessionId) OR (:sessionJti IS NOT NULL AND jti = :sessionJti))
       LIMIT 1`,
      { sessionId, sessionJti },
    );

    if (!row || !row.device_fingerprint) return next();

    if (row.device_fingerprint !== fp) {
      logger.warn('[deviceFingerprint] Device change detected', {
        userId:    row.user_id,
        orgId:     row.org_id,
        sessionId,
        stored:    row.device_fingerprint.slice(0, 8) + '...',
        incoming:  fp.slice(0, 8) + '...',
        blocking:  BLOCK_ON_CHANGE(),
      });

      try {
        await db.query(
          `INSERT INTO security_events (user_id, org_id, event_type, details, ip_address)
           VALUES (:userId, :orgId, 'device_change', :details, :ip)`,
          {
            userId:  row.user_id,
            orgId:   row.org_id,
            details: JSON.stringify({ sessionId: row.id, newFp: fp.slice(0, 16) }),
            ip:      req.ip || null,
          },
        );
      } catch { /* tabla puede no existir aún */ }

      if (BLOCK_ON_CHANGE()) {
        return _res.status(401).json({
          success: false,
          error: { message: 'Device changed — please re-authenticate', code: 'AUTH_014' },
        });
      }
    }
  } catch (err) {
    logger.warn('[deviceFingerprint] Check failed', { err: err.message });
  }

  next();
}

module.exports = { captureFingerprint: recordDeviceFingerprint, checkDeviceFingerprint, normalizeFingerprint };
