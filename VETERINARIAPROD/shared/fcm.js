'use strict';

/**
 * Firebase Cloud Messaging (FCM) — push notifications web + móvil.
 *
 * Variables de entorno (una de las dos opciones):
 *   Opción A — archivo de credenciales:
 *     FIREBASE_CREDENTIAL_PATH = /ruta/a/serviceAccountKey.json
 *
 *   Opción B — variables individuales:
 *     FIREBASE_PROJECT_ID
 *     FIREBASE_CLIENT_EMAIL
 *     FIREBASE_PRIVATE_KEY    (con \n escapados)
 *
 * Docs: https://firebase.google.com/docs/cloud-messaging
 */

const admin = require('firebase-admin');
const { createLogger } = require('./logger');

const log = createLogger('fcm');

// ── Inicialización (lazy, una sola vez) ───────────────────────────────────────
let _app;

function getApp() {
  if (_app) return _app;

  // Evitar inicialización duplicada (ej. tests con hot-reload)
  if (admin.apps.length) {
    _app = admin.apps[0];
    return _app;
  }

  let credential;

  if (process.env.FIREBASE_CREDENTIAL_PATH) {
    // Validate the path to prevent path traversal / arbitrary file inclusion.
    // Only allow absolute paths pointing to .json files within safe directories.
    const credPath = process.env.FIREBASE_CREDENTIAL_PATH;
    const normalised = require('path').resolve(credPath);
    if (!normalised.endsWith('.json')) {
      throw new Error('FIREBASE_CREDENTIAL_PATH must point to a .json file');
    }
    const fs = require('fs');
    if (!fs.existsSync(normalised)) {
      throw new Error(`FIREBASE_CREDENTIAL_PATH not found: ${normalised}`);
    }
    credential = admin.credential.cert(JSON.parse(fs.readFileSync(normalised, 'utf8')));
  } else if (process.env.FIREBASE_PROJECT_ID) {
    credential = admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    });
  } else {
    throw new Error('Firebase no configurado. Define FIREBASE_CREDENTIAL_PATH o FIREBASE_PROJECT_ID');
  }

  _app = admin.initializeApp({ credential });
  return _app;
}

function messaging() {
  return admin.messaging(getApp());
}

// ── Enviar a un token específico (un dispositivo) ─────────────────────────────
/**
 * @param {string} token    FCM registration token del dispositivo
 * @param {object} payload  { title, body, data?, imageUrl?, badge? }
 * @returns {Promise<string>}  messageId
 */
async function sendToToken(token, payload) {
  const { title, body, data, imageUrl, badge } = payload;

  const message = {
    token,
    notification: { title, body, ...(imageUrl && { imageUrl }) },
    data:         sanitizeData(data),
    android: {
      priority: 'high',
      notification: { sound: 'default', ...(badge !== undefined && { notificationCount: badge }) },
    },
    apns: {
      payload: { aps: { sound: 'default', ...(badge !== undefined && { badge }) } },
    },
    webpush: {
      notification: { icon: '/icon-192.png', badge: '/badge-72.png' },
    },
  };

  return messaging().send(message);
}

// ── Enviar a múltiples tokens (multicast) ─────────────────────────────────────
/**
 * @param {string[]} tokens
 * @param {object}   payload
 * @returns {Promise<{ successCount, failureCount, failedTokens }>}
 */
async function sendToMultiple(tokens, payload) {
  if (!tokens.length) return { successCount: 0, failureCount: 0, failedTokens: [] };

  const { title, body, data, imageUrl } = payload;

  const message = {
    notification: { title, body, ...(imageUrl && { imageUrl }) },
    data:         sanitizeData(data),
    android: { priority: 'high', notification: { sound: 'default' } },
    apns:    { payload: { aps: { sound: 'default' } } },
    webpush: { notification: { icon: '/icon-192.png' } },
  };

  const response = await messaging().sendEachForMulticast({ tokens, ...message });

  const failedTokens = [];
  response.responses.forEach((r, i) => {
    if (!r.success) failedTokens.push(tokens[i]);
  });

  return {
    successCount: response.successCount,
    failureCount: response.failureCount,
    failedTokens,
  };
}

// ── Enviar a un topic (org o branch) ─────────────────────────────────────────
/**
 * Topics usados:
 *   org_{orgId}         — todos los usuarios de una organización
 *   branch_{branchId}   — todos los de una sucursal
 *   role_{orgId}_{role} — todos con un rol específico
 *
 * @param {string} topic
 * @param {object} payload
 */
async function sendToTopic(topic, payload) {
  const { title, body, data, imageUrl } = payload;
  return messaging().send({
    topic,
    notification: { title, body, ...(imageUrl && { imageUrl }) },
    data:         sanitizeData(data),
    android: { priority: 'high', notification: { sound: 'default' } },
    apns:    { payload: { aps: { sound: 'default' } } },
  });
}

// ── Suscribir / desuscribir tokens a topics ───────────────────────────────────

/**
 * FCM topic names must match /^[a-zA-Z0-9-_.~%]{1,900}$/.
 * Reject topics that do not conform to prevent topic injection attacks.
 */
const VALID_TOPIC_RE = /^[a-zA-Z0-9\-_.~%]{1,900}$/;

function assertValidTopic(topic) {
  if (typeof topic !== 'string' || !VALID_TOPIC_RE.test(topic)) {
    throw new Error(`Invalid FCM topic name: "${topic}"`);
  }
}

async function subscribeToTopic(tokens, topic) {
  if (!tokens.length) return;
  assertValidTopic(topic);
  return messaging().subscribeToTopic(tokens, topic);
}

async function unsubscribeFromTopic(tokens, topic) {
  if (!tokens.length) return;
  assertValidTopic(topic);
  return messaging().unsubscribeFromTopic(tokens, topic);
}

// ── Validar token (revisa si FCM lo conoce) ───────────────────────────────────
async function validateToken(token) {
  try {
    // Enviar mensaje de prueba (dry run)
    await messaging().send({ token, data: { test: '1' } }, true /* dryRun */);
    return true;
  } catch (err) {
    log.warn('FCM token validation failed', { error: err.message });
    return false;
  }
}

// ── Helper: FCM data solo acepta string values ────────────────────────────────
function sanitizeData(data = {}) {
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    out[k] = String(v);
  }
  return out;
}

module.exports = {
  sendToToken,
  sendToMultiple,
  sendToTopic,
  subscribeToTopic,
  unsubscribeFromTopic,
  validateToken,
};
