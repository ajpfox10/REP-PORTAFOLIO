'use strict';

const db = require('../../../shared/db');
const jwt = require('../../../shared/jwt');
const R = require('../../../shared/response');
const mp = require('../../../shared/mercadopago');
const { decryptRows } = require('../../../shared/encryption');
const { sendPasswordReset, sendWelcome, sendNewDeviceLogin } = require('../../../shared/email');
const { sendTemplate } = require('../../../shared/messaging');
const fcm = require('../../../shared/fcm');
const eventBus = require('../../../shared/eventBus');
const {
  getNotificationSchema,
  notificationExpr,
  notificationReadAtExpr,
  notificationMarkReadSet,
  notificationOrderExpr,
} = require('../../../shared/notificationLogSchema');
const { createLogger } = require('../../../shared/logger');
const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const { getRedisSingleton } = require('../../../shared/redis');
const { body: vBody, validationResult: vResult } = require('express-validator');

const log = createLogger('portal');
const PASSWORD_POLICY = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?])/;

/**
 * authLimiter — rate limit para rutas de autenticación del portal.
 * Usa RedisStore para funcionar correctamente en entornos multi-instancia.
 * Fallback a MemoryStore si Redis no está disponible.
 */
let _authLimiterInstance = null;
let _authLimiterBuilding = false;
const _authLimiterQueue = [];

async function _buildAuthLimiter() {
  let store;
  try {
    const client = await getRedisSingleton('portal-rate-limit', 'portal-rate-limit');
    if (client.isReady) {
      store = new RedisStore({
        sendCommand: (...args) => client.sendCommand(args),
        prefix: 'rl:portal:auth:',
      });
    }
  } catch (err) {
    log.warn('Portal rate limiter RedisStore unavailable - using MemoryStore fallback', { err: err.message });
  }
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    store,
    message: { success: false, error: { message: 'Demasiados intentos. Intente de nuevo en 15 minutos.' } },
  });
}

const authLimiter = async function (req, res, next) {
  if (_authLimiterInstance) return _authLimiterInstance(req, res, next);
  if (!_authLimiterBuilding) {
    _authLimiterBuilding = true;
    _authLimiterInstance = await _buildAuthLimiter().catch((err) => {
      log.warn('Portal auth limiter build failed - fallback to MemoryStore', { err: err.message });
      return rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });
    });
    _authLimiterQueue.forEach((fn) => fn());
    _authLimiterQueue.length = 0;
  } else {
    await new Promise((resolve) => _authLimiterQueue.push(resolve));
  }
  return _authLimiterInstance(req, res, next);
};

function validate(req, res, next) {
  const errors = vResult(req);
  if (!errors.isEmpty()) return R.badRequest(res, 'Validacion fallida', errors.array());
  next();
}

async function portalAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return R.unauthorized(res, 'Token requerido');

  try {
    const decoded = jwt.verifyAccess(token);
    if (decoded.role !== 'owner') return R.forbidden(res, 'Acceso exclusivo para duenios');

    // BUG-001: verificar que la cuenta del cliente está activa en cada request
    if (decoded.clientId) {
      const client = await db.queryOne(
        'SELECT id FROM clients WHERE id = :id AND is_active = 1',
        { id: decoded.clientId }
      );
      if (!client) return R.forbidden(res, 'Cuenta suspendida o eliminada');
    }

    req.owner = decoded;
    next();
  } catch (err) {
    log.warn('portal auth failed', { err: err.message });
    return R.unauthorized(res, 'Token invalido o expirado');
  }
}

function buildOwnerToken(client) {
  return jwt.signAccess({
    jti: require('uuid').v4(),
    clientId: client.id,
    email: client.email,
    orgId: client.organization_id || null,
    role: 'owner',
  });
}

function buildOwnerRefresh(client) {
  return jwt.signRefresh({ clientId: client.id, role: 'owner' });
}

function publishPortalEvent(topic, payload, req, extraMeta = {}) {
  const meta = {
    orgId: req.owner?.orgId || null,  // BUG-017: no usar header x-org-id (spoofable)
    clientId: req.owner?.clientId || payload.clientId || null,
    branchId: payload.branchId || null,
    source: 'portal',
    ...extraMeta,
  };
  return eventBus.publish(topic, payload, meta).catch((err) => {
    log.warn('portal event publish failed', { err: err.message, topic });
  });
}

module.exports = {
  db,
  jwt,
  R,
  mp,
  fcm,
  decryptRows,
  sendPasswordReset,
  sendWelcome,
  sendNewDeviceLogin,
  sendTemplate,
  getNotificationSchema,
  notificationExpr,
  notificationReadAtExpr,
  notificationMarkReadSet,
  notificationOrderExpr,
  authLimiter,
  validate,
  portalAuth,
  buildOwnerToken,
  buildOwnerRefresh,
  publishPortalEvent,
  log,
  PASSWORD_POLICY,
  vBody,
};
