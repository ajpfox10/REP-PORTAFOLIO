'use strict';

/**
 * shared/webrtc.js
 * Módulo WebRTC multi-proveedor para telemedicina.
 *
 * Proveedores soportados (configurable por WEBRTC_PROVIDER):
 *   - 'daily'   — Daily.co REST API (recomendado, free tier disponible)
 *   - 'twilio'  — Twilio Video SDK
 *   - 'whereby' — Whereby Embedded REST API
 *   - 'builtin' — WebRTC nativo (solo STUN/TURN config, sin servidor SFU)
 *
 * Patrón: adapter — todos los proveedores exponen la misma interfaz.
 */

const https  = require('https');
const crypto = require('crypto');

const PROVIDER = (process.env.WEBRTC_PROVIDER || 'daily').toLowerCase();

// ─── Interfaz pública ─────────────────────────────────────────────────────────

/**
 * Crea una sala de video.
 * @param {object} opts
 * @param {string}  opts.roomName    — nombre único (ej: `tele-${sessionId}`)
 * @param {number}  [opts.expiresAt] — timestamp unix en segundos
 * @param {boolean} [opts.enableRecording]
 * @param {number}  [opts.maxParticipants] — default 2
 * @returns {Promise<{ roomName, roomUrl, providerRoomId, providerData }>}
 */
async function createRoom (opts) {
  return _adapter().createRoom(opts);
}

/**
 * Genera token de acceso para unirse a una sala.
 * @param {object} opts
 * @param {string}  opts.roomName
 * @param {string}  opts.identity    — email o userId del participante
 * @param {string}  [opts.role]      — 'host' | 'guest' (default 'guest')
 * @param {number}  [opts.ttlSeconds] — default 3600
 * @returns {Promise<{ token, joinUrl }>}
 */
async function generateToken (opts) {
  return _adapter().generateToken(opts);
}

/**
 * Elimina/cierra una sala.
 * @param {string} roomName
 */
async function deleteRoom (roomName) {
  return _adapter().deleteRoom(roomName);
}

/**
 * Obtiene información de una sala.
 * @param {string} roomName
 */
async function getRoom (roomName) {
  return _adapter().getRoom(roomName);
}

/**
 * Inicia grabación cloud en una sala.
 * @param {string} roomName
 * @returns {Promise<{ recordingId }>}
 */
async function startRecording (roomName) {
  return _adapter().startRecording(roomName);
}

/**
 * Detiene grabación en una sala.
 * @param {string} roomName
 * @param {string} recordingId
 * @returns {Promise<{ recordingId, duration, url? }>}
 */
async function stopRecording (roomName, recordingId) {
  return _adapter().stopRecording(roomName, recordingId);
}

/**
 * Lista grabaciones de una sala.
 * @param {string} roomName
 * @returns {Promise<object[]>}
 */
async function listRecordings (roomName) {
  return _adapter().listRecordings(roomName);
}

/**
 * Devuelve configuración STUN/TURN para uso directo en el browser.
 * @returns {{ iceServers: object[] }}
 */
function getIceServers () {
  const servers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  // TURN propio (opcional)
  if (process.env.TURN_URL && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    servers.push({
      urls       : process.env.TURN_URL,
      username   : process.env.TURN_USERNAME,
      credential : process.env.TURN_CREDENTIAL,
    });
  } else if (process.env.TURN_SECRET) {
    // TURN con credenciales temporales HMAC (coturn)
    const ttl      = 86400;   // 24 hs
    const timestamp = Math.floor(Date.now() / 1000) + ttl;
    const username  = `${timestamp}:vetmanager`;
    const credential = crypto
      .createHmac('sha1', process.env.TURN_SECRET)
      .update(username)
      .digest('base64');

    servers.push({
      urls       : process.env.TURN_URL || 'turn:turn.vetmanager.com:3478',
      username,
      credential,
    });
  }

  return { iceServers: servers };
}

/**
 * Genera un nombre de sala único para una sesión.
 */
function buildRoomName (sessionId) {
  return `vm-tele-${sessionId}-${crypto.randomBytes(4).toString('hex')}`;
}

// ─── Adaptador Daily.co ───────────────────────────────────────────────────────

const dailyAdapter = {
  async createRoom ({ roomName, expiresAt, enableRecording = false, maxParticipants = 2 }) {
    const body = {
      name        : roomName,
      privacy     : 'private',
      properties  : {
        start_audio_off   : false,
        start_video_off   : false,
        max_participants  : maxParticipants,
        enable_recording  : enableRecording ? 'cloud' : 'off',
        exp               : expiresAt || Math.floor(Date.now() / 1000) + 7200,   // 2 hs
        eject_at_room_exp : true,
      },
    };
    const data = await _dailyRequest('POST', '/rooms', body);
    return {
      roomName      : data.name,
      roomUrl       : data.url,
      providerRoomId: data.id,
      providerData  : data,
    };
  },

  async generateToken ({ roomName, identity, role = 'guest', ttlSeconds = 3600 }) {
    const body = {
      properties: {
        room_name : roomName,
        user_name : identity,
        exp       : Math.floor(Date.now() / 1000) + ttlSeconds,
        is_owner  : role === 'host',
      },
    };
    const data = await _dailyRequest('POST', '/meeting-tokens', body);
    return {
      token   : data.token,
      joinUrl : `https://vetmanager.daily.co/${roomName}?t=${data.token}`,
    };
  },

  async deleteRoom (roomName) {
    return _dailyRequest('DELETE', `/rooms/${roomName}`);
  },

  async getRoom (roomName) {
    return _dailyRequest('GET', `/rooms/${roomName}`);
  },

  async startRecording (roomName) {
    const data = await _dailyRequest('POST', `/rooms/${roomName}/recordings`);
    return { recordingId: data.id };
  },

  async stopRecording (roomName, recordingId) {
    const data = await _dailyRequest('DELETE', `/recordings/${recordingId}`);
    return { recordingId, duration: data.duration, url: data.download_link };
  },

  async listRecordings (roomName) {
    const data = await _dailyRequest('GET', `/recordings?room_name=${roomName}`);
    return (data.data || []).map(r => ({
      recordingId : r.id,
      duration    : r.duration,
      status      : r.status,
      url         : r.download_link,
      createdAt   : r.created_at,
    }));
  },
};

// ─── Adaptador Twilio Video ───────────────────────────────────────────────────

const twilioAdapter = {
  _buildClient () {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken  = process.env.TWILIO_AUTH_TOKEN;
    if (!accountSid || !authToken) throw new Error('TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN no configurados');
    // Uso lazy require para no fallar si el módulo no está instalado
    const twilio = require('twilio');
    return twilio(accountSid, authToken);
  },

  async createRoom ({ roomName, expiresAt, enableRecording = false, maxParticipants = 2 }) {
    const client = this._buildClient();
    const room = await client.video.v1.rooms.create({
      uniqueName           : roomName,
      type                 : maxParticipants <= 4 ? 'small-group' : 'group',
      recordParticipantsOnConnect: enableRecording,
      maxParticipantDuration: expiresAt ? Math.max(60, expiresAt - Math.floor(Date.now() / 1000)) : 7200,
    });
    return {
      roomName      : room.uniqueName,
      roomUrl       : null,   // Twilio no tiene URL directa, se usa token
      providerRoomId: room.sid,
      providerData  : { sid: room.sid, status: room.status },
    };
  },

  async generateToken ({ roomName, identity, role = 'guest', ttlSeconds = 3600 }) {
    const twilio    = require('twilio');
    const { AccessToken, VideoGrant } = twilio.jwt;
    const token     = new AccessToken(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_API_KEY_SID,
      process.env.TWILIO_API_KEY_SECRET,
      { identity, ttl: ttlSeconds }
    );
    const grant = new VideoGrant({ room: roomName });
    token.addGrant(grant);
    return { token: token.toJwt(), joinUrl: null };
  },

  async deleteRoom (roomName) {
    const client = this._buildClient();
    const rooms = await client.video.v1.rooms.list({ uniqueName: roomName, limit: 1 });
    if (rooms.length) await client.video.v1.rooms(rooms[0].sid).update({ status: 'completed' });
  },

  async getRoom (roomName) {
    const client = this._buildClient();
    const rooms = await client.video.v1.rooms.list({ uniqueName: roomName, limit: 1 });
    return rooms[0] || null;
  },

  async startRecording () { throw new Error('Twilio recording: use recordParticipantsOnConnect al crear la sala'); },
  async stopRecording ()  { throw new Error('Twilio recording: se gestiona automáticamente'); },
  async listRecordings (roomName) {
    const client  = this._buildClient();
    const rooms   = await client.video.v1.rooms.list({ uniqueName: roomName, limit: 1 });
    if (!rooms.length) return [];
    const recs    = await client.video.v1.rooms(rooms[0].sid).recordings.list();
    return recs.map(r => ({ recordingId: r.sid, duration: r.duration, status: r.status, url: null }));
  },
};

// ─── Adaptador Whereby ────────────────────────────────────────────────────────

const wherebyAdapter = {
  async createRoom ({ roomName, expiresAt }) {
    const body = {
      endDate     : expiresAt
        ? new Date(expiresAt * 1000).toISOString()
        : new Date(Date.now() + 7_200_000).toISOString(),
      fields      : ['hostRoomUrl'],
      roomNamePrefix: `/${roomName}`,
      roomMode    : 'normal',
    };
    const data = await _wherebyRequest('POST', '/meetings', body);
    return {
      roomName      : roomName,
      roomUrl       : data.roomUrl,
      providerRoomId: data.meetingId,
      providerData  : { hostRoomUrl: data.hostRoomUrl, roomUrl: data.roomUrl },
    };
  },

  async generateToken ({ roomName, role = 'guest' }) {
    // Whereby usa hostRoomUrl para host y roomUrl para guest — ya están en createRoom
    return {
      token   : null,
      joinUrl : null,   // se usa el roomUrl/hostRoomUrl guardado en DB
    };
  },

  async deleteRoom (providerRoomId) {
    return _wherebyRequest('DELETE', `/meetings/${providerRoomId}`);
  },

  async getRoom (providerRoomId) {
    return _wherebyRequest('GET', `/meetings/${providerRoomId}`);
  },

  async startRecording () { throw new Error('Whereby: grabación disponible en plan Business'); },
  async stopRecording ()  { throw new Error('Whereby: grabación disponible en plan Business'); },
  async listRecordings () { return []; },
};

// ─── Adaptador built-in (solo STUN/TURN, sin SFU) ────────────────────────────

const builtinAdapter = {
  async createRoom ({ roomName, expiresAt }) {
    const token = crypto.randomBytes(16).toString('hex');
    return {
      roomName,
      roomUrl       : `${process.env.FRONTEND_URL || 'http://localhost:3000'}/tele/room/${roomName}?t=${token}`,
      providerRoomId: roomName,
      providerData  : { token, iceServers: getIceServers().iceServers },
    };
  },

  async generateToken ({ roomName, identity, role = 'guest', ttlSeconds = 3600 }) {
    const payload = { roomName, identity, role, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
    // BUG-15: no usar JWT_SECRET como fallback ni secret hardcodeado
    const secret  = process.env.WEBRTC_ROOM_SECRET;
    if (!secret) throw new Error('WEBRTC_ROOM_SECRET must be configured');
    const token   = crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
    return {
      token,
      joinUrl  : `${process.env.FRONTEND_URL || 'http://localhost:3000'}/tele/room/${roomName}?token=${token}&identity=${identity}&role=${role}`,
      iceServers: getIceServers().iceServers,
    };
  },

  async deleteRoom () {},
  async getRoom (roomName) { return { roomName }; },
  async startRecording () { throw new Error('Built-in: grabación no soportada, usar Daily.co o Twilio'); },
  async stopRecording ()  { throw new Error('Built-in: grabación no soportada'); },
  async listRecordings () { return []; },
};

// ─── Selector de adaptador ────────────────────────────────────────────────────

function _adapter () {
  switch (PROVIDER) {
    case 'daily'   : return dailyAdapter;
    case 'twilio'  : return twilioAdapter;
    case 'whereby' : return wherebyAdapter;
    case 'builtin' : return builtinAdapter;
    default:
      throw new Error(`WEBRTC_PROVIDER desconocido: ${PROVIDER}. Usar: daily, twilio, whereby, builtin`);
  }
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function _dailyRequest (method, path, body = null) {
  const apiKey = process.env.DAILY_API_KEY;
  if (!apiKey) throw new Error('DAILY_API_KEY no configurado');

  return new Promise((resolve, reject) => {
    const opts = {
      hostname : 'api.daily.co',
      path     : `/v1${path}`,
      method,
      headers  : {
        'Authorization' : `Bearer ${apiKey}`,
        'Content-Type'  : 'application/json',
      },
    };

    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          if (res.statusCode >= 400) return reject(Object.assign(new Error(parsed.error || 'Daily API error'), { status: res.statusCode, body: parsed }));
          resolve(parsed);
        } catch (e) { reject(e); }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function _wherebyRequest (method, path, body = null) {
  const apiKey = process.env.WHEREBY_API_KEY;
  if (!apiKey) throw new Error('WHEREBY_API_KEY no configurado');

  return new Promise((resolve, reject) => {
    const opts = {
      hostname : 'api.whereby.dev',
      path     : `/v1${path}`,
      method,
      headers  : {
        'Authorization' : `Bearer ${apiKey}`,
        'Content-Type'  : 'application/json',
      },
    };

    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          if (res.statusCode >= 400) return reject(Object.assign(new Error(parsed.message || 'Whereby API error'), { status: res.statusCode }));
          resolve(parsed);
        } catch (e) { reject(e); }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

module.exports = {
  createRoom,
  generateToken,
  deleteRoom,
  getRoom,
  startRecording,
  stopRecording,
  listRecordings,
  getIceServers,
  buildRoomName,
  PROVIDER,
};
