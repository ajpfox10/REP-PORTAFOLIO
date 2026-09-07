'use strict';

/**
 * shared/calendar.js
 * Google Calendar API integration (OAuth2 + Service Account)
 * Sync appointments ↔ Google Calendar per vet user
 */

const { google } = require('googleapis');
const db         = require('./db');
const { createLogger } = require('./logger');
// SEC: los tokens OAuth se cifran en reposo para protegerlos si la BD es comprometida
const { encrypt, decrypt } = require('./encryption');

const log = createLogger('calendar');

// ─── OAuth2 client ────────────────────────────────────────────────────────────

function buildOAuth2Client () {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI   // e.g. https://api.vetmanager.com/auth/google/callback
  );
}

/**
 * Genera la URL de autorización OAuth2 para que el veterinario conecte su cuenta.
 * @param {string} nonce — valor aleatorio generado por la ruta (almacenado en Redis)
 *                         NO usar userId directamente (CSRF).
 * @returns {string} authorizationUrl
 */
function getAuthUrl (nonce) {
  const oauth2 = buildOAuth2Client();
  return oauth2.generateAuthUrl({
    access_type : 'offline',
    prompt       : 'consent',
    scope        : ['https://www.googleapis.com/auth/calendar'],
    state        : String(nonce),   // nonce aleatorio — el callback lo valida contra Redis
  });
}

/**
 * Intercambia el code por tokens y los guarda en DB.
 * @param {number} userId
 * @param {string} code  — code recibido en callback de Google
 */
async function exchangeCode (userId, code) {
  const oauth2 = buildOAuth2Client();
  const { tokens } = await oauth2.getToken(code);
  await _saveTokens(userId, tokens);
  return tokens;
}

/**
 * Revoca tokens y elimina de DB (desconectar cuenta).
 * @param {number} userId
 */
async function revokeAccess (userId) {
  const row = await _loadTokens(userId);
  if (!row) return;
  try {
    const oauth2 = buildOAuth2Client();
    oauth2.setCredentials({ access_token: row.access_token });
    await oauth2.revokeToken(row.access_token);
  } catch (err) {
    log.warn('Calendar revoke ignored', { error: err.message, userId });
  }
  await db.query('DELETE FROM google_calendar_tokens WHERE user_id = :uid', { uid: userId });
}

// ─── Calendar operations ──────────────────────────────────────────────────────

/**
 * Crea un evento en Google Calendar del veterinario.
 * @param {number} userId
 * @param {object} appt — fila de appointments con joins (patient_name, vet_name, owner_name, etc.)
 * @returns {object} { eventId, htmlLink }
 */
async function createEvent (userId, appt) {
  const calendar = await _buildCalendar(userId);
  const event    = _buildEventBody(appt);

  const resp = await calendar.events.insert({
    calendarId : 'primary',
    resource   : event,
  });

  // Guardar google_event_id en la cita
  await db.query(
    'UPDATE appointments SET google_event_id = :eid WHERE id = :id',
    { eid: resp.data.id, id: appt.id }
  );

  return { eventId: resp.data.id, htmlLink: resp.data.htmlLink };
}

/**
 * Actualiza un evento existente en Google Calendar.
 * @param {number} userId
 * @param {object} appt — debe tener appt.google_event_id
 */
async function updateEvent (userId, appt) {
  if (!appt.google_event_id) {
    return createEvent(userId, appt);   // si no existe, crea uno nuevo
  }
  const calendar = await _buildCalendar(userId);
  const event    = _buildEventBody(appt);

  await calendar.events.update({
    calendarId : 'primary',
    eventId    : appt.google_event_id,
    resource   : event,
  });
  return { eventId: appt.google_event_id };
}

/**
 * Cancela / elimina el evento en Google Calendar.
 * @param {number} userId
 * @param {string} googleEventId
 */
async function deleteEvent (userId, googleEventId) {
  if (!googleEventId) return;
  try {
    const calendar = await _buildCalendar(userId);
    await calendar.events.delete({ calendarId: 'primary', eventId: googleEventId });
  } catch (err) {
    if (err.code !== 410) throw err;   // 410 = ya borrado, ignorar
    log.warn('Calendar delete ignored', { error: err.message, userId, googleEventId });
  }
  await db.query(
    'UPDATE appointments SET google_event_id = NULL WHERE google_event_id = :eid',
    { eid: googleEventId }
  );
}

/**
 * Devuelve lista de eventos del calendario del veterinario en un rango de fechas.
 * @param {number} userId
 * @param {string} timeMin  ISO8601
 * @param {string} timeMax  ISO8601
 * @returns {object[]}
 */
async function listEvents (userId, timeMin, timeMax) {
  const calendar = await _buildCalendar(userId);
  const resp = await calendar.events.list({
    calendarId   : 'primary',
    timeMin,
    timeMax,
    singleEvents : true,
    orderBy      : 'startTime',
    maxResults   : 250,
  });
  return resp.data.items || [];
}

/**
 * Verifica si el usuario tiene tokens Google guardados.
 * @param {number} userId
 * @returns {boolean}
 */
async function isConnected (userId) {
  const row = await _loadTokens(userId);
  return !!row;
}

// ─── Helpers privados ─────────────────────────────────────────────────────────

async function _buildCalendar (userId) {
  const row = await _loadTokens(userId);
  if (!row) throw Object.assign(new Error('Google Calendar no conectado para este usuario'), { code: 'GCAL_NOT_CONNECTED' });

  const oauth2 = buildOAuth2Client();
  oauth2.setCredentials({
    access_token  : row.access_token,
    refresh_token : row.refresh_token,
    expiry_date   : row.expiry_date ? Number(row.expiry_date) : undefined,
  });

  // Auto-refresh: si el access_token venció, googleapis lo renueva solo.
  // Guardamos el nuevo token si fue actualizado.
  oauth2.on('tokens', async (tokens) => {
    await _saveTokens(userId, tokens);
  });

  return google.calendar({ version: 'v3', auth: oauth2 });
}

async function _loadTokens (userId) {
  const row = await db.queryOne(
    'SELECT * FROM google_calendar_tokens WHERE user_id = :uid',
    { uid: userId }
  );
  if (!row) return null;
  // SEC: descifrar tokens OAuth antes de usarlos
  try {
    if (row.access_token)  row.access_token  = decrypt(row.access_token);
    if (row.refresh_token) row.refresh_token = decrypt(row.refresh_token);
  } catch (err) {
    log.warn('Calendar token decrypt failed', { userId, error: err.message });
    return null;
  }
  return row;
}

async function _saveTokens (userId, tokens) {
  // SEC: cifrar tokens OAuth antes de persistir en BD
  const encAt = tokens.access_token  ? encrypt(tokens.access_token)  : null;
  const encRt = tokens.refresh_token ? encrypt(tokens.refresh_token) : null;

  // org_id es NOT NULL en google_calendar_tokens; derivarlo del usuario.
  const orgRow = await db.queryOne(
    `SELECT b.organization_id AS orgId
       FROM users u JOIN branches b ON b.id = u.branch_id
      WHERE u.id = :uid`,
    { uid: userId }
  );

  await db.query(
    `INSERT INTO google_calendar_tokens
       (user_id, org_id, access_token, refresh_token, expires_at, scope)
     VALUES (:uid, :orgId, :at, :rt, :exp, :scope)
     ON DUPLICATE KEY UPDATE
       access_token  = VALUES(access_token),
       refresh_token = IF(VALUES(refresh_token) IS NOT NULL, VALUES(refresh_token), refresh_token),
       expires_at    = VALUES(expires_at),
       updated_at    = NOW()`,
    {
      uid   : userId,
      orgId : orgRow?.orgId || null,
      at    : encAt,
      rt    : encRt,
      exp   : tokens.expires_at || tokens.expiry_date || null,
      scope : tokens.scope      || null,
    }
  );
}

/**
 * Construye el body del evento Google Calendar a partir de una cita.
 */
function _buildEventBody (appt) {
  const start = new Date(appt.scheduled_date);
  const end   = new Date(start.getTime() + (appt.duration_minutes || 30) * 60_000);

  const statusMap = {
    scheduled   : 'tentative',
    confirmed   : 'confirmed',
    in_progress : 'confirmed',
    completed   : 'confirmed',
    cancelled   : 'cancelled',
    no_show     : 'cancelled',
  };

  return {
    summary     : `🐾 ${appt.patient_name || 'Paciente'} — ${appt.type_name || appt.reason || 'Consulta'}`,
    description : [
      appt.owner_name  ? `Propietario: ${appt.owner_name}`  : '',
      appt.owner_phone ? `Teléfono: ${appt.owner_phone}`    : '',
      appt.species     ? `Especie: ${appt.species}`         : '',
      appt.reason      ? `Motivo: ${appt.reason}`           : '',
      appt.notes       ? `Notas: ${appt.notes}`             : '',
    ].filter(Boolean).join('\n'),
    start       : { dateTime: start.toISOString(), timeZone: process.env.TZ || 'America/Argentina/Buenos_Aires' },
    end         : { dateTime: end.toISOString(),   timeZone: process.env.TZ || 'America/Argentina/Buenos_Aires' },
    status      : statusMap[appt.status] || 'tentative',
    reminders   : {
      useDefault : false,
      overrides  : [
        { method: 'popup', minutes: 60 },
        { method: 'popup', minutes: 15 },
      ],
    },
    extendedProperties: {
      private: {
        vetmanager_appointment_id : String(appt.id),
        vetmanager_branch_id      : String(appt.branch_id || ''),
      },
    },
  };
}

module.exports = {
  getAuthUrl,
  exchangeCode,
  revokeAccess,
  createEvent,
  updateEvent,
  deleteEvent,
  listEvents,
  isConnected,
};
