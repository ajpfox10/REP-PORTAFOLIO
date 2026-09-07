'use strict';

const db = require('./db');

const FIELD_CANDIDATES = {
  type: ['notification_type', 'type', 'category'],
  title: ['title', 'subject'],
  message: ['message', 'body', 'content', 'description'],
  severity: ['severity', 'priority', 'level'],
  sentAt: ['sent_at', 'created_at', 'generated_at'],
  readAt: ['read_at', 'seen_at', 'opened_at'],
  actionUrl: ['action_url', 'url', 'link_url'],
  relatedEntityType: ['related_entity_type', 'entity_type', 'reference_type'],
  relatedEntityId: ['related_entity_id', 'entity_id', 'reference_id'],
  readFlag: ['is_read', 'read', 'seen'],
};

const SCHEMA_TTL_MS = parseInt(process.env.SCHEMA_CACHE_TTL_MS || '300000'); // 5 min
let _schemaPromise = null;
let _schemaExpiresAt = 0;

async function getNotificationSchema() {
  if (_schemaPromise && Date.now() < _schemaExpiresAt) return _schemaPromise;
  _schemaExpiresAt = Date.now() + SCHEMA_TTL_MS;
  _schemaPromise = db.query(
    `SELECT TABLE_NAME, COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN ('notification_logs', 'user_fcm_tokens')`
  ).then((rows) => {
    const schema = {
      notification_logs: new Set(),
      user_fcm_tokens: new Set(),
    };
    for (const row of rows) {
      if (schema[row.TABLE_NAME]) schema[row.TABLE_NAME].add(row.COLUMN_NAME);
    }
    return schema;
  }).catch((err) => {
    _schemaPromise = null;
    _schemaExpiresAt = 0;
    throw err;
  });
  return _schemaPromise;
}

function firstExisting(cols, options) {
  for (const option of options) {
    if (cols.has(option)) return option;
  }
  return null;
}

// BUG-013 (auditoría): seguro frente a inyección SQL —
//   • `alias` siempre es un literal hardcodeado por el llamador (p.ej. 'nl')
//   • `field` siempre es una clave conocida de FIELD_CANDIDATES
//   • `column` proviene de INFORMATION_SCHEMA filtrado por el allowlist FIELD_CANDIDATES
//   • `fallbackSql` siempre es un literal SQL hardcodeado por el llamador
function notificationExpr(cols, alias, field, fallbackSql = 'NULL') {
  const column = firstExisting(cols, FIELD_CANDIDATES[field]);
  return column ? `${alias}.${column}` : fallbackSql;
}

function notificationReadAtExpr(cols, alias = 'nl') {
  const readAtColumn = firstExisting(cols, FIELD_CANDIDATES.readAt);
  if (readAtColumn) return `${alias}.${readAtColumn}`;

  const readFlagColumn = firstExisting(cols, FIELD_CANDIDATES.readFlag);
  const sentAtExpr = notificationExpr(cols, alias, 'sentAt', `${alias}.id`);
  if (readFlagColumn) {
    return `CASE WHEN ${alias}.${readFlagColumn} = 1 THEN ${sentAtExpr} ELSE NULL END`;
  }
  return 'NULL';
}

function notificationUnreadPredicate(cols, alias = 'nl') {
  const readAtColumn = firstExisting(cols, FIELD_CANDIDATES.readAt);
  if (readAtColumn) return `${alias}.${readAtColumn} IS NULL`;

  const readFlagColumn = firstExisting(cols, FIELD_CANDIDATES.readFlag);
  if (readFlagColumn) return `COALESCE(${alias}.${readFlagColumn}, 0) = 0`;

  return '0 = 1';
}

function notificationMarkReadSet(cols) {
  const sets = [];
  const readAtColumn = firstExisting(cols, FIELD_CANDIDATES.readAt);
  const readFlagColumn = firstExisting(cols, FIELD_CANDIDATES.readFlag);

  if (readAtColumn) sets.push(`${readAtColumn} = NOW()`);
  if (readFlagColumn) sets.push(`${readFlagColumn} = 1`);
  if (cols.has('updated_at')) sets.push('updated_at = NOW()');

  return sets.length ? sets.join(', ') : null;
}

function notificationOrderExpr(cols, alias = 'nl') {
  return notificationExpr(cols, alias, 'sentAt', `${alias}.id`);
}

function buildNotificationInsert(cols, payload) {
  const columns = [];
  const values = [];
  const params = {};

  const mapField = (target, candidates, value) => {
    const column = firstExisting(cols, candidates);
    if (!column || value === undefined) return;
    columns.push(column);
    values.push(`:${target}`);
    params[target] = value;
  };

  mapField('userId', ['user_id'], payload.userId);
  mapField('clientId', ['client_id'], payload.clientId);
  mapField('branchId', ['branch_id'], payload.branchId);
  mapField('orgId', ['org_id', 'organization_id'], payload.orgId);
  mapField('type', FIELD_CANDIDATES.type, payload.type);
  mapField('title', FIELD_CANDIDATES.title, payload.title);
  mapField('message', FIELD_CANDIDATES.message, payload.message);
  mapField('severity', FIELD_CANDIDATES.severity, payload.severity);
  mapField('actionUrl', FIELD_CANDIDATES.actionUrl, payload.actionUrl);
  mapField('relatedEntityType', FIELD_CANDIDATES.relatedEntityType, payload.relatedEntityType);
  mapField('relatedEntityId', FIELD_CANDIDATES.relatedEntityId, payload.relatedEntityId);

  // channel es NOT NULL en notification_logs (canal de entrega). El "type" de la
  // notificación no tiene columna propia en este schema; las notificaciones internas
  // usan el canal in-app por defecto. Sin esto el INSERT viola NOT NULL.
  if (cols.has('channel')) {
    columns.push('channel');
    values.push(':channel');
    params.channel = payload.channel || 'in_app';
  }

  const readFlagColumn = firstExisting(cols, FIELD_CANDIDATES.readFlag);
  if (readFlagColumn) {
    columns.push(readFlagColumn);
    values.push('0');
  }

  const sentAtColumn = firstExisting(cols, FIELD_CANDIDATES.sentAt);
  if (sentAtColumn && sentAtColumn !== 'created_at') {
    columns.push(sentAtColumn);
    values.push('NOW()');
  }

  return { columns, values, params };
}

module.exports = {
  getNotificationSchema,
  firstExisting,
  notificationExpr,
  notificationReadAtExpr,
  notificationUnreadPredicate,
  notificationMarkReadSet,
  notificationOrderExpr,
  buildNotificationInsert,
};
