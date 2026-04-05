const { query, queryOne } = require('../config/database');

async function findAll(filters = {}, pagination = {}) {
  const conditions = [];
  const params     = [];

  if (filters.user_id) { conditions.push('al.user_id = ?');    params.push(filters.user_id); }
  if (filters.action)  { conditions.push('al.action = ?');     params.push(filters.action); }
  if (filters.dateFrom){ conditions.push('al.created_at >= ?');params.push(filters.dateFrom); }
  if (filters.dateTo)  { conditions.push('al.created_at <= ?');params.push(filters.dateTo + ' 23:59:59'); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRow = await queryOne(
    `SELECT COUNT(*) AS total FROM audit_logs al ${where}`, params
  );
  const total = countRow.total;

  const page   = Math.max(1, parseInt(pagination.page) || 1);
  const limit  = Math.min(100, Math.max(1, parseInt(pagination.limit) || 50));
  const offset = (page - 1) * limit;

  const rows = await query(
    `SELECT al.*, u.username, u.full_name
     FROM audit_logs al
     LEFT JOIN users u ON u.id = al.user_id
     ${where}
     ORDER BY al.created_at DESC
     LIMIT ${limit} OFFSET ${offset}`,
    params
  );

  return { data: rows, total, page, limit, pages: Math.ceil(total / limit) };
}

async function findByEntity(entityType, entityId) {
  return query(
    `SELECT al.*, u.username, u.full_name
     FROM audit_logs al
     LEFT JOIN users u ON u.id = al.user_id
     WHERE al.entity_type = ? AND al.entity_id = ?
     ORDER BY al.created_at ASC`,
    [entityType, entityId]
  );
}

module.exports = { findAll, findByEntity };
