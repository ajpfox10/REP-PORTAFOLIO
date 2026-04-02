const { v4: uuidv4 } = require('uuid');
const { query, queryOne, pool } = require('../config/database');

async function generateIncidentNumber() {
  const year = new Date().getFullYear();
  const [[{ count }]] = await pool.query(
    'SELECT COUNT(*) AS count FROM incidents WHERE YEAR(created_at) = ?', [year]
  );
  const seq = String(parseInt(count) + 1).padStart(6, '0');
  return `DC-${year}-${seq}`;
}

async function findAll(filters = {}, pagination = {}) {
  const conditions = ['i.is_deleted = 0'];
  const params     = [];

  if (filters.status)           { conditions.push('i.status = ?');             params.push(filters.status); }
  if (filters.priority)         { conditions.push('i.priority = ?');           params.push(filters.priority); }
  if (filters.incident_type_id) { conditions.push('i.incident_type_id = ?');   params.push(filters.incident_type_id); }
  if (filters.province_id)      { conditions.push('i.province_id = ?');        params.push(filters.province_id); }
  if (filters.partido_id)       { conditions.push('i.partido_id = ?');         params.push(filters.partido_id); }
  if (filters.locality_id)      { conditions.push('i.locality_id = ?');        params.push(filters.locality_id); }
  if (filters.reported_by_user_id) { conditions.push('i.reported_by_user_id = ?'); params.push(filters.reported_by_user_id); }
  if (filters.dateFrom)         { conditions.push('i.started_at >= ?');        params.push(filters.dateFrom); }
  if (filters.dateTo)           { conditions.push('i.started_at <= ?');        params.push(filters.dateTo + ' 23:59:59'); }
  if (filters.search) {
    conditions.push('(i.title LIKE ? OR i.description LIKE ? OR i.incident_number LIKE ?)');
    const like = `%${filters.search}%`;
    params.push(like, like, like);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM incidents i ${where}`, params
  );

  const page  = Math.max(1, parseInt(pagination.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(pagination.limit) || 20));
  const offset = (page - 1) * limit;

  const rows = await query(
    `SELECT i.*, it.name AS type_name, it.icon AS type_icon, it.color_hex,
            ist.name AS subtype_name,
            p.name AS province_name, pa.name AS partido_name, l.name AS locality_name,
            u.username AS reporter_username, u.full_name AS reporter_full_name
     FROM incidents i
     JOIN incident_types it ON it.id = i.incident_type_id
     LEFT JOIN incident_subtypes ist ON ist.id = i.incident_subtype_id
     LEFT JOIN provinces p   ON p.id = i.province_id
     LEFT JOIN partidos pa   ON pa.id = i.partido_id
     LEFT JOIN localities l  ON l.id = i.locality_id
     JOIN users u            ON u.id = i.reported_by_user_id
     ${where}
     ORDER BY i.started_at DESC
     LIMIT ${limit} OFFSET ${offset}`,
    params
  );

  return { data: rows, total, page, limit, pages: Math.ceil(total / limit) };
}

async function findByUuid(uuid) {
  const incident = await queryOne(
    `SELECT i.*, it.name AS type_name, it.icon AS type_icon, it.color_hex,
            ist.name AS subtype_name,
            p.name AS province_name, pa.name AS partido_name, l.name AS locality_name,
            u.username AS reporter_username, u.full_name AS reporter_full_name
     FROM incidents i
     JOIN incident_types it ON it.id = i.incident_type_id
     LEFT JOIN incident_subtypes ist ON ist.id = i.incident_subtype_id
     LEFT JOIN provinces p   ON p.id = i.province_id
     LEFT JOIN partidos pa   ON pa.id = i.partido_id
     LEFT JOIN localities l  ON l.id = i.locality_id
     JOIN users u            ON u.id = i.reported_by_user_id
     WHERE i.uuid = ? AND i.is_deleted = 0`,
    [uuid]
  );
  if (!incident) return null;

  incident.units = await query(
    'SELECT * FROM incident_units WHERE incident_id = ? ORDER BY arrived_at ASC', [incident.id]
  );
  incident.resources = await query(
    'SELECT * FROM incident_resources WHERE incident_id = ? ORDER BY id ASC', [incident.id]
  );

  return incident;
}

async function findMapPoints(filters = {}) {
  const conditions = ['i.is_deleted = 0', 'i.latitude IS NOT NULL', 'i.longitude IS NOT NULL'];
  const params     = [];

  if (filters.status)           { conditions.push('i.status = ?');           params.push(filters.status); }
  if (filters.incident_type_id) { conditions.push('i.incident_type_id = ?'); params.push(filters.incident_type_id); }
  if (filters.province_id)      { conditions.push('i.province_id = ?');      params.push(filters.province_id); }

  return query(
    `SELECT i.uuid, i.incident_number, i.title, i.latitude, i.longitude,
            i.status, i.priority, i.started_at,
            it.name AS type_name, it.icon AS type_icon, it.color_hex
     FROM incidents i
     JOIN incident_types it ON it.id = i.incident_type_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY i.started_at DESC`,
    params
  );
}

async function create(data, userId) {
  const uuid            = uuidv4();
  const incident_number = await generateIncidentNumber();

  await query(
    `INSERT INTO incidents
       (uuid, incident_number, incident_type_id, incident_subtype_id, title, description,
        status, priority, province_id, partido_id, locality_id, address,
        latitude, longitude, affected_persons_count, injured_count, deceased_count,
        evacuated_count, reported_by_user_id, assigned_officer, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuid, incident_number,
      data.incident_type_id, data.incident_subtype_id || null,
      data.title, data.description,
      data.status || 'RECIBIDO', data.priority || 'MEDIA',
      data.province_id || null, data.partido_id || null, data.locality_id || null,
      data.address || null,
      data.latitude || null, data.longitude || null,
      data.affected_persons_count || 0, data.injured_count || 0,
      data.deceased_count || 0, data.evacuated_count || 0,
      userId,
      data.assigned_officer || null, data.notes || null,
    ]
  );

  const incident = await findByUuid(uuid);

  // Estado inicial en historial
  await query(
    'INSERT INTO incident_status_history (incident_id, new_status, changed_by_user_id, notes) VALUES (?, ?, ?, ?)',
    [incident.id, incident.status, userId, 'Incidente creado']
  );

  return incident;
}

async function update(uuid, data, userId, userRole) {
  const incident = await queryOne('SELECT * FROM incidents WHERE uuid = ? AND is_deleted = 0', [uuid]);
  if (!incident) return null;

  if (userRole === 'medium' && incident.reported_by_user_id !== userId) {
    const err = new Error('Solo puede editar sus propios incidentes');
    err.status = 403;
    throw err;
  }

  const allowed = [
    'incident_type_id', 'incident_subtype_id', 'title', 'description', 'status', 'priority',
    'province_id', 'partido_id', 'locality_id', 'address', 'latitude', 'longitude',
    'affected_persons_count', 'injured_count', 'deceased_count', 'evacuated_count',
    'assigned_officer', 'notes', 'controlled_at', 'closed_at',
  ];

  const updates = [];
  const values  = [];

  for (const key of allowed) {
    if (data[key] !== undefined) {
      updates.push(`${key} = ?`);
      values.push(data[key] === '' ? null : data[key]);
    }
  }

  if (!updates.length) return findByUuid(uuid);

  // Auto-set timestamps for status changes
  if (data.status === 'CONTROLADO' && !incident.controlled_at) {
    updates.push('controlled_at = NOW()');
  }
  if ((data.status === 'CERRADO' || data.status === 'CANCELADO') && !incident.closed_at) {
    updates.push('closed_at = NOW()');
  }

  values.push(uuid);
  await query(`UPDATE incidents SET ${updates.join(', ')} WHERE uuid = ?`, values);

  return findByUuid(uuid);
}

async function softDelete(uuid, userId, userRole) {
  const incident = await queryOne('SELECT * FROM incidents WHERE uuid = ? AND is_deleted = 0', [uuid]);
  if (!incident) return false;
  if (userRole !== 'admin') {
    const err = new Error('Solo administradores pueden eliminar incidentes');
    err.status = 403;
    throw err;
  }
  await query('UPDATE incidents SET is_deleted = 1 WHERE uuid = ?', [uuid]);
  return true;
}

async function addUnit(incidentUuid, unitData) {
  const incident = await queryOne('SELECT id FROM incidents WHERE uuid = ? AND is_deleted = 0', [incidentUuid]);
  if (!incident) return null;
  const [result] = await pool.query(
    `INSERT INTO incident_units (incident_id, unit_name, unit_type, unit_number, personnel_count, arrived_at, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      incident.id, unitData.unit_name, unitData.unit_type,
      unitData.unit_number || null, unitData.personnel_count || 0,
      unitData.arrived_at || null, unitData.notes || null,
    ]
  );
  return queryOne('SELECT * FROM incident_units WHERE id = ?', [result.insertId]);
}

async function removeUnit(incidentUuid, unitId) {
  const incident = await queryOne('SELECT id FROM incidents WHERE uuid = ? AND is_deleted = 0', [incidentUuid]);
  if (!incident) return false;
  const [result] = await pool.query(
    'DELETE FROM incident_units WHERE id = ? AND incident_id = ?', [unitId, incident.id]
  );
  return result.affectedRows > 0;
}

async function addResource(incidentUuid, resourceData) {
  const incident = await queryOne('SELECT id FROM incidents WHERE uuid = ? AND is_deleted = 0', [incidentUuid]);
  if (!incident) return null;
  const [result] = await pool.query(
    'INSERT INTO incident_resources (incident_id, resource_type, resource_name, quantity, notes) VALUES (?, ?, ?, ?, ?)',
    [incident.id, resourceData.resource_type, resourceData.resource_name, resourceData.quantity || 1, resourceData.notes || null]
  );
  return queryOne('SELECT * FROM incident_resources WHERE id = ?', [result.insertId]);
}

async function removeResource(incidentUuid, resourceId) {
  const incident = await queryOne('SELECT id FROM incidents WHERE uuid = ? AND is_deleted = 0', [incidentUuid]);
  if (!incident) return false;
  const [result] = await pool.query(
    'DELETE FROM incident_resources WHERE id = ? AND incident_id = ?', [resourceId, incident.id]
  );
  return result.affectedRows > 0;
}

async function updateStatus(uuid, newStatus, userId, notes) {
  const incident = await queryOne('SELECT * FROM incidents WHERE uuid = ? AND is_deleted = 0', [uuid]);
  if (!incident) return null;

  const updates = ['status = ?'];
  const vals    = [newStatus];

  if (newStatus === 'CONTROLADO' && !incident.controlled_at) { updates.push('controlled_at = NOW()'); }
  if ((newStatus === 'CERRADO' || newStatus === 'CANCELADO') && !incident.closed_at) { updates.push('closed_at = NOW()'); }

  vals.push(uuid);
  await query(`UPDATE incidents SET ${updates.join(', ')} WHERE uuid = ?`, vals);

  await query(
    'INSERT INTO incident_status_history (incident_id, previous_status, new_status, changed_by_user_id, notes) VALUES (?, ?, ?, ?, ?)',
    [incident.id, incident.status, newStatus, userId, notes || null]
  );

  return findByUuid(uuid);
}

async function getStatusHistory(uuid) {
  const incident = await queryOne('SELECT id FROM incidents WHERE uuid = ?', [uuid]);
  if (!incident) return null;
  return query(
    `SELECT sh.*, u.username, u.full_name
     FROM incident_status_history sh
     JOIN users u ON u.id = sh.changed_by_user_id
     WHERE sh.incident_id = ?
     ORDER BY sh.changed_at ASC`,
    [incident.id]
  );
}

async function getDashboardStats() {
  const today = new Date().toISOString().split('T')[0];
  const [
    todayRows, openRows, criticalRows, monthRows, byTypeRows
  ] = await Promise.all([
    query(`SELECT COUNT(*) AS count FROM incidents WHERE DATE(started_at) = ? AND is_deleted = 0`, [today]),
    query(`SELECT COUNT(*) AS count FROM incidents WHERE status NOT IN ('CERRADO','CANCELADO') AND is_deleted = 0`),
    query(`SELECT COUNT(*) AS count FROM incidents WHERE priority = 'CRITICA' AND status NOT IN ('CERRADO','CANCELADO') AND is_deleted = 0`),
    query(`SELECT COUNT(*) AS count FROM incidents WHERE YEAR(started_at) = YEAR(NOW()) AND MONTH(started_at) = MONTH(NOW()) AND is_deleted = 0`),
    query(`SELECT it.name, it.color_hex, it.icon, COUNT(*) AS count FROM incidents i JOIN incident_types it ON it.id = i.incident_type_id WHERE i.is_deleted = 0 GROUP BY it.id ORDER BY count DESC`),
  ]);

  return {
    today:    todayRows[0].count,
    open:     openRows[0].count,
    critical: criticalRows[0].count,
    month:    monthRows[0].count,
    byType:   byTypeRows,
  };
}

module.exports = {
  findAll, findByUuid, findMapPoints, create, update, softDelete,
  addUnit, removeUnit, addResource, removeResource,
  updateStatus, getStatusHistory, getDashboardStats,
};
