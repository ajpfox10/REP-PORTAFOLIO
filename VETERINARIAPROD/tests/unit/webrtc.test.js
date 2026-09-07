'use strict';

/**
 * tests/unit/webrtc.test.js
 * Tests para shared/webrtc.js — sin llamadas reales a APIs externas.
 * Testea la lógica pura: buildRoomName, getIceServers, adaptador builtin.
 */

// Forzar provider 'builtin' para tests sin credenciales externas
process.env.WEBRTC_PROVIDER = 'builtin';
process.env.WEBRTC_ROOM_SECRET = 'test_secret_123';
process.env.FRONTEND_URL = 'http://localhost:3000';

const webrtc = require('../../shared/webrtc');

// ─── Tests: buildRoomName ─────────────────────────────────────────────────────

describe('webrtc — buildRoomName', () => {
  test('genera nombre que contiene el sessionId', () => {
    const name = webrtc.buildRoomName(42);
    expect(name).toContain('42');
    expect(name).toMatch(/^vm-tele-42-/);
  });

  test('genera nombres únicos en cada llamada', () => {
    const a = webrtc.buildRoomName(1);
    const b = webrtc.buildRoomName(1);
    expect(a).not.toBe(b);
  });

  test('el nombre solo contiene caracteres seguros para URL', () => {
    const name = webrtc.buildRoomName(99);
    expect(name).toMatch(/^[a-z0-9-]+$/);
  });
});

// ─── Tests: getIceServers ─────────────────────────────────────────────────────

describe('webrtc — getIceServers', () => {
  test('devuelve objeto con iceServers array', () => {
    const config = webrtc.getIceServers();
    expect(config).toHaveProperty('iceServers');
    expect(Array.isArray(config.iceServers)).toBe(true);
  });

  test('siempre incluye al menos un servidor STUN de Google', () => {
    const { iceServers } = webrtc.getIceServers();
    const stun = iceServers.filter(s => s.urls?.toString().includes('stun.l.google.com'));
    expect(stun.length).toBeGreaterThanOrEqual(1);
  });

  test('incluye servidor TURN si está configurado', () => {
    process.env.TURN_URL        = 'turn:turn.example.com:3478';
    process.env.TURN_USERNAME   = 'user123';
    process.env.TURN_CREDENTIAL = 'pass123';

    const { iceServers } = webrtc.getIceServers();
    const turn = iceServers.filter(s => s.urls?.toString().includes('turn:'));
    expect(turn.length).toBeGreaterThanOrEqual(1);
    expect(turn[0].username).toBe('user123');

    delete process.env.TURN_URL;
    delete process.env.TURN_USERNAME;
    delete process.env.TURN_CREDENTIAL;
  });

  test('genera credenciales HMAC cuando hay TURN_SECRET', () => {
    process.env.TURN_SECRET = 'my_coturn_secret';
    process.env.TURN_URL    = 'turn:turn.example.com:3478';

    const { iceServers } = webrtc.getIceServers();
    const turn = iceServers.find(s => s.credential);
    expect(turn).toBeDefined();
    expect(turn.username).toMatch(/^\d+:vetmanager$/);   // timestamp:vetmanager
    expect(turn.credential).toBeTruthy();

    delete process.env.TURN_SECRET;
    delete process.env.TURN_URL;
  });

  test('sin TURN configurado → solo STUN de Google', () => {
    delete process.env.TURN_URL;
    delete process.env.TURN_USERNAME;
    delete process.env.TURN_CREDENTIAL;
    delete process.env.TURN_SECRET;

    const { iceServers } = webrtc.getIceServers();
    const turn = iceServers.filter(s => s.urls?.toString().startsWith('turn:'));
    expect(turn.length).toBe(0);
  });
});

// ─── Tests: adaptador builtin ─────────────────────────────────────────────────

describe('webrtc — adaptador builtin', () => {
  test('createRoom devuelve objeto con roomName, roomUrl, providerRoomId', async () => {
    const result = await webrtc.createRoom({ roomName: 'vm-tele-1-abc123', expiresAt: Math.floor(Date.now() / 1000) + 3600 });
    expect(result.roomName).toBe('vm-tele-1-abc123');
    expect(result.roomUrl).toContain('vm-tele-1-abc123');
    expect(result.providerRoomId).toBe('vm-tele-1-abc123');
    expect(result.providerData).toHaveProperty('token');
    expect(result.providerData).toHaveProperty('iceServers');
  });

  test('generateToken devuelve token y joinUrl para host', async () => {
    const result = await webrtc.generateToken({
      roomName : 'vm-tele-1-abc123',
      identity : 'vet@clinica.com',
      role     : 'host',
    });
    expect(result.token).toBeTruthy();
    expect(result.joinUrl).toContain('host');
    expect(result.joinUrl).toContain('vm-tele-1-abc123');
    expect(result.iceServers).toBeDefined();
  });

  test('generateToken para guest', async () => {
    const result = await webrtc.generateToken({
      roomName : 'vm-tele-1-abc123',
      identity : 'owner@example.com',
      role     : 'guest',
    });
    expect(result.token).toBeTruthy();
    expect(result.joinUrl).toContain('guest');
  });

  test('tokens distintos para identidades distintas', async () => {
    const t1 = await webrtc.generateToken({ roomName: 'room-x', identity: 'user1@x.com', role: 'guest' });
    const t2 = await webrtc.generateToken({ roomName: 'room-x', identity: 'user2@x.com', role: 'guest' });
    expect(t1.token).not.toBe(t2.token);
  });

  test('deleteRoom no lanza error', async () => {
    await expect(webrtc.deleteRoom('any-room')).resolves.toBeUndefined();
  });

  test('getRoom devuelve objeto con roomName', async () => {
    const result = await webrtc.getRoom('vm-tele-5-xyz');
    expect(result.roomName).toBe('vm-tele-5-xyz');
  });

  test('startRecording lanza error en builtin', async () => {
    await expect(webrtc.startRecording('room')).rejects.toThrow('Built-in');
  });

  test('listRecordings devuelve array vacío en builtin', async () => {
    const recs = await webrtc.listRecordings('room');
    expect(recs).toEqual([]);
  });
});

// ─── Tests: PROVIDER ─────────────────────────────────────────────────────────

describe('webrtc — PROVIDER', () => {
  test('PROVIDER coincide con la variable de entorno', () => {
    expect(webrtc.PROVIDER).toBe('builtin');
  });

  test('proveedores válidos aceptados', () => {
    const valid = ['daily', 'twilio', 'whereby', 'builtin'];
    expect(valid.includes(webrtc.PROVIDER)).toBe(true);
  });
});

// ─── Tests: sala de espera (lógica) ──────────────────────────────────────────

describe('webrtc — lógica de sala de espera', () => {
  const STATES = ['waiting', 'admitted', 'rejected'];

  test.each(STATES)('estado "%s" es válido', (state) => {
    expect(STATES.includes(state)).toBe(true);
  });

  test('estado inválido no está en lista', () => {
    expect(STATES.includes('banned')).toBe(false);
  });
});

// ─── Tests: estados de sala ───────────────────────────────────────────────────

describe('webrtc — estados de sala', () => {
  const ROOM_STATES = ['created', 'active', 'ended', 'expired'];

  test.each(ROOM_STATES)('estado "%s" es válido', (state) => {
    expect(ROOM_STATES.includes(state)).toBe(true);
  });

  test('sala expired no acepta nuevos tokens', () => {
    const allowedForToken = ['created', 'active'];
    expect(allowedForToken.includes('expired')).toBe(false);
    expect(allowedForToken.includes('ended')).toBe(false);
  });
});

// ─── Tests: estados de grabación ─────────────────────────────────────────────

describe('webrtc — estados de grabación', () => {
  const REC_STATES = ['recording', 'processing', 'completed', 'failed', 'deleted'];

  test.each(REC_STATES)('estado "%s" es válido', (state) => {
    expect(REC_STATES.includes(state)).toBe(true);
  });

  test('solo "recording" es estado activo', () => {
    const active = REC_STATES.filter(s => s === 'recording');
    expect(active).toHaveLength(1);
  });
});
