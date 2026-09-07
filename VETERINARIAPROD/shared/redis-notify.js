'use strict';

/**
 * Helper for any microservice to publish real-time notifications
 * to the gateway WebSocket via Redis pub/sub.
 *
 * Usage:
 *   const notify = require('../../../shared/redis-notify');
 *   await notify.toUsers([userId], 'critical_lab', { message: 'Valor crítico detectado', patientId: 5 });
 *   await notify.toBranch(branchId, 'new_appointment', { ... });
 */

const { getRedisSingleton } = require('./redis');

async function getPublisher() {
  return getRedisSingleton('redis-notify', 'redis-notify');
}

/**
 * Send notification to specific user IDs.
 * @param {number[]} userIds
 * @param {string}   type      e.g. 'critical_lab', 'appointment_reminder'
 * @param {object}   data      payload to send
 * @param {object}   [options] { severity: 'info'|'warning'|'critical', actionUrl }
 */
async function toUsers(userIds, type, data, options = {}) {
  const pub = await getPublisher();
  await pub.publish('notifications', JSON.stringify({
    type,
    targetUserIds: userIds.map(String),
    data: { ...data, severity: options.severity || 'info', actionUrl: options.actionUrl },
    ts: new Date().toISOString(),
  }));
}

/**
 * Send notification to all users in a branch.
 */
async function toBranch(branchId, type, data, options = {}) {
  const pub = await getPublisher();
  await pub.publish('notifications', JSON.stringify({
    type,
    branchId: String(branchId),
    data: { ...data, severity: options.severity || 'info' },
    ts: new Date().toISOString(),
  }));
}

/**
 * Send notification to all users in an org.
 */
async function toOrg(orgId, type, data, options = {}) {
  const pub = await getPublisher();
  await pub.publish('notifications', JSON.stringify({
    type,
    orgId: String(orgId),
    data: { ...data, severity: options.severity || 'info' },
    ts: new Date().toISOString(),
  }));
}

/**
 * Send notification to all users with one or more roles.
 * Can optionally scope the role broadcast to an org and/or branch.
 * @param {string|string[]} roles
 * @param {string} type
 * @param {object} data
 * @param {object} [options] { orgId, branchId, severity, actionUrl }
 */
async function toRoles(roles, type, data, options = {}) {
  const pub = await getPublisher();
  const roleList = (Array.isArray(roles) ? roles : [roles])
    .map((role) => String(role).trim().toLowerCase())
    .filter(Boolean);

  if (!roleList.length) {
    throw new Error('toRoles requires at least one role');
  }

  await pub.publish('notifications', JSON.stringify({
    type,
    targetRoles: roleList,
    orgId: options.orgId != null ? String(options.orgId) : undefined,
    branchId: options.branchId != null ? String(options.branchId) : undefined,
    data: {
      ...data,
      severity: options.severity || 'info',
      actionUrl: options.actionUrl,
    },
    ts: new Date().toISOString(),
  }));
}

/**
 * Send notification with arbitrary combined scopes.
 * Supported scopes:
 *   - targetUserIds
 *   - targetRoles
 *   - orgId
 *   - branchId
 * If no scope is provided, the notification is broadcast globally.
 * @param {object} scope
 * @param {string} type
 * @param {object} data
 * @param {object} [options] { severity, actionUrl }
 */
async function toScoped(scope = {}, type, data, options = {}) {
  const pub = await getPublisher();
  const targetUserIds = Array.isArray(scope.targetUserIds)
    ? scope.targetUserIds.map((id) => String(id))
    : undefined;
  const targetRoles = Array.isArray(scope.targetRoles)
    ? scope.targetRoles.map((role) => String(role).trim().toLowerCase()).filter(Boolean)
    : undefined;

  await pub.publish('notifications', JSON.stringify({
    type,
    targetUserIds,
    targetRoles,
    orgId: scope.orgId != null ? String(scope.orgId) : undefined,
    branchId: scope.branchId != null ? String(scope.branchId) : undefined,
    data: {
      ...data,
      severity: options.severity || 'info',
      actionUrl: options.actionUrl,
    },
    ts: new Date().toISOString(),
  }));
}

/**
 * Predefined critical events (match with DB trigger alerts)
 */
const events = {
  criticalLab:      (userId, patientName, testName, value) =>
    toUsers([userId], 'critical_lab', { patientName, testName, value }, { severity: 'critical' }),

  criticalVitals:   (userId, patientName, vital, value) =>
    toUsers([userId], 'critical_vitals', { patientName, vital, value }, { severity: 'critical' }),

  lowStock:         (branchId, itemName, qty) =>
    toBranch(branchId, 'low_stock', { itemName, qty }, { severity: 'warning' }),

  newAppointment:   (vetId, patientName, date) =>
    toUsers([vetId], 'new_appointment', { patientName, date }, { severity: 'info' }),

  teleSessionReady: (clientId, vetName, sessionCode) =>
    toUsers([clientId], 'tele_session_ready', { vetName, sessionCode }, { severity: 'info' }),

  invoiceOverdue:   (clientUserId, invoiceNumber, amount) =>
    toUsers([clientUserId], 'invoice_overdue', { invoiceNumber, amount }, { severity: 'warning' }),
};

module.exports = { toUsers, toBranch, toOrg, toRoles, toScoped, events };
