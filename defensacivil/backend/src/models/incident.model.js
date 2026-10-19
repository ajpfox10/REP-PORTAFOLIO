const { v4: uuidv4 } = require('uuid');
const { query, queryOne, execute, transaction } = require('../config/database');

const CLOSED_STATUSES = ['CERRADO', 'CANCELADO'];

const SELECT_INCIDENT = `
  SELECT i.*, it.name AS type_name, it.icon AS type_icon, it.color_hex,
         ist.name AS subtype_name,
         p.name AS province_name, pa.name AS partido_name, l.name AS locality_name,
         u.username AS reporter_username, u.full_name AS reporter_full_name
  FROM incidents i
  JOIN incident_types it ON it.id = i.incident_type_id
  LEFT JOIN incident_subtypes ist ON ist.id = i.incident_subtype_id
  LEFT JOIN provinces p   ON p.id = i.province_id
  LEFT JOIN partidos pa   ON pa.id = i.partido_id
  LEFT JOIN localities l  ON l.id = i.locality_id
  JOIN users u            ON u.id = i.reported_by_user_id`;

// Año en hora argentina (UTC-3), para que un incidente del 31/12 a las 22 h
// no se numere con el año siguiente.
function currentYear() {
  return new Date(Date.now() - 3 * 3600 * 1000).getUTCFullYear();
}

// Numeración correlativa por año (DC-2026-000123). LAST_INSERT_ID(expr) deja el
// valor asignado en la conexión, así dos altas simultáneas nunca reciben el mismo.
async function nextIncidentNumber(conn) {
  const year = currentYear();
  await execute(
    `INSERT INTO incident_number_sequences (year, last_seq) VALUES (?, LAST_INSERT_ID(1))
     ON DUPLICATE KEY UPDATE last_seq = LAST_INSERT_ID(last_seq + 1)`,
    [year], conn
  );
  const row = await queryOne('SELECT LAST_INSERT_ID() AS seq', [], conn);
  return `DC-${year}-${String(row.seq).padStart(6, '0')}`;
}

// Escapa los comodines de LIKE: buscar "100%" no debe traer todo
function likePattern(text) {
  return `%${String(text).replace(/[\\%_]/g, '\\$&')}%`;
}

// Fechas de cierre que se completan solas al cambiar de estado
function statusTimestamps(newStatus, incident) {
  const parts = [];
  if (newStatus === 'CONTROLADO' && !incident.controlled_at) parts.push('controlled_at = NOW()');
  if (CLOSED_STATUSES.includes(newStatus) && !incident.closed_at) parts.push('closed_at = NOW()');
  return parts;
}

async function addHistory(conn, incident, newStatus, userId, notes) {
  await execute(
    `INSERT INTO incident_status_history (incident_id, previous_status, new_status, changed_by_user_id, notes)
     VALUES (?, ?, ?, ?, ?)`,
    [incident.id, incident.status, newStatus, userId, notes || null], conn
  );
}

async function lockIncident(conn, uuid) {
  return queryOne('SELECT * FROM incidents WHERE uuid = ? AND is_deleted = 0 FOR UPDATE', [uuid], conn);
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
  if (filters.dateFrom)         { conditions.push('i.started_at >= ?');        params.push(filters.dateFrom.slice(0, 10)); }
  if (filters.dateTo)           { conditions.push('i.started_at < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(filters.dateTo.slice(0, 10)); }
  if (filters.search) {
    conditions.push('(i.title LIKE ? OR i.description LIKE ? OR i.incident_number LIKE ? OR i.address LIKE ?)');
    const like = likePattern(filters.search);
    params.push(like, like, like, like);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const countRow = await queryOne(`SELECT COUNT(*) AS total FROM incidents i ${where}`, params);
  const total = countRow.total;

  const page   = Math.max(1, parseInt(pagination.page, 10) || 1);
  const limit  = Math.min(100, Math.max(1, parseInt(pagination.limit, 10) || 20));
  const offset = (page - 1) * limit;

  // limit y offset son enteros validados: se interpolan porque MySQL no
  // acepta parámetros preparados en LIMIT con execute()
  const rows = await query(
    `${SELECT_INCIDENT}
     ${where}
     ORDER BY i.started_at DESC, i.id DESC
     LIMIT ${limit} OFFSET ${offset}`,
    params
  );

  return { data: rows, total, page, limit, pages: Math.ceil(total / limit) };
}

async function findByUuid(uuid) {
  const incident = await queryOne(`${SELECT_INCIDENT} WHERE i.uuid = ? AND i.is_deleted = 0`, [uuid]);
  if (!incident) return null;

  incident.units = await query(
    'SELECT * FROM incident_units WHERE incident_id = ? ORDER BY arrived_at ASC, id ASC', [incident.id]
  );
  incident.resources = await query(
    'SELECT * FROM incident_resources WHERE incident_id = ? ORDER BY id ASC', [incident.id]
  );

  return incident;
}

async function findMapPoints(filters = {}) {
  const conditions = ['i.is_deleted = 0', 'i.latitude IS NOT NULL', 'i.longitude IS NOT NULL'];
  const params     = [];

  if (filters.status)           { conditions.push('i.status = ?');             params.push(filters.status); }
  if (filters.incident_type_id) { conditions.push('i.incident_type_id = ?');   params.push(filters.incident_type_id); }
  if (filters.province_id)      { conditions.push('i.province_id = ?');        params.push(filters.province_id); }
  if (filters.partido_id)       { conditions.push('i.partido_id = ?');         params.push(filters.partido_id); }
  if (filters.locality_id)      { conditions.push('i.locality_id = ?');        params.push(filters.locality_id); }

  return query(
    `SELECT i.uuid, i.incident_number, i.title, i.address, i.latitude, i.longitude,
            i.status, i.priority, i.started_at, i.incident_type_id,
            i.affected_persons_count, i.evacuated_count,
            it.code AS type_code, it.name AS type_name, it.icon AS type_icon, it.color_hex
     FROM incidents i
     JOIN incident_types it ON it.id = i.incident_type_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY i.started_at DESC`,
    params
  );
}

async function create(data, userId) {
  const uuid = uuidv4();

  await transaction(async conn => {
    const incidentNumber = await nextIncidentNumber(conn);
    const result = await execute(
      `INSERT INTO incidents
         (uuid, incident_number, incident_type_id, incident_subtype_id, title, description,
          status, priority, province_id, partido_id, locality_id, address,
          latitude, longitude, affected_persons_count, injured_count, deceased_count,
          evacuated_count, reported_by_user_id, assigned_officer, notes)
       VALUES (?, ?, ?, ?, ?, ?, 'RECIBIDO', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuid, incidentNumber,
        data.incident_type_id, data.incident_subtype_id || null,
        data.title, data.description,
        data.priority || 'MEDIA',
        data.province_id || null, data.partido_id || null, data.locality_id || null,
        data.address || null,
        data.latitude ?? null, data.longitude ?? null,
        data.affected_persons_count || 0, data.injured_count || 0,
        data.deceased_count || 0, data.evacuated_count || 0,
        userId,
        data.assigned_officer || null, data.notes || null,
      ],
      conn
    );
    await addHistory(conn, { id: result.insertId, status: null }, 'RECIBIDO', userId, 'Incidente creado');
  });

  return findByUuid(uuid);
}

const UPDATABLE = [
  'incident_type_id', 'incident_subtype_id', 'title', 'description', 'status', 'priority',
  'province_id', 'partido_id', 'locality_id', 'address', 'latitude', 'longitude',
  'affected_persons_count', 'injured_count', 'deceased_count', 'evacuated_count',
  'assigned_officer', 'notes',
];

async function update(uuid, data, userId, userRole) {
  const found = await transaction(async conn => {
    const incident = await lockIncident(conn, uuid);
    if (!incident) return false;

    if (userRole === 'medium' && incident.reported_by_user_id !== userId) {
      const err = new Error('Solo puede editar sus propios incidentes');
      err.status = 403;
      throw err;
    }

    const updates = [];
    const values  = [];
    for (const key of UPDATABLE) {
      if (data[key] !== undefined) {
        updates.push(`${key} = ?`);
        values.push(data[key] === '' ? null : data[key]);
      }
    }
    if (!updates.length) return true;

    const statusChanged = data.status && data.status !== incident.status;
    if (statusChanged) updates.push(...statusTimestamps(data.status, incident));

    values.push(incident.id);
    await execute(`UPDATE incidents SET ${updates.join(', ')} WHERE id = ?`, values, conn);

    // Todo cambio de estado queda en el historial, venga de donde venga
    if (statusChanged) await addHistory(conn, incident, data.status, userId, 'Cambio de estado al editar');
    return true;
  });

  return found ? findByUuid(uuid) : null;
}

async function softDelete(uuid) {
  const result = await execute('UPDATE incidents SET is_deleted = 1 WHERE uuid = ? AND is_deleted = 0', [uuid]);
  return result.affectedRows > 0;
}

async function addUnit(incidentUuid, unitData) {
  const incident = await queryOne('SELECT id FROM incidents WHERE uuid = ? AND is_deleted = 0', [incidentUuid]);
  if (!incident) return null;
  const result = await execute(
    `INSERT INTO incident_units (incident_id, unit_name, unit_type, unit_number, personnel_count, arrived_at, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      incident.id, unitData.unit_name, unitData.unit_type,
      unitData.unit_number || null, unitData.personnel_count || 0,
      unitData.arrived_at ? new Date(unitData.arrived_at) : null, unitData.notes || null,
    ]
  );
  return queryOne('SELECT * FROM incident_units WHERE id = ?', [result.insertId]);
}

async function removeUnit(incidentUuid, unitId) {
  const incident = await queryOne('SELECT id FROM incidents WHERE uuid = ? AND is_deleted = 0', [incidentUuid]);
  if (!incident) return false;
  const result = await execute(
    'DELETE FROM incident_units WHERE id = ? AND incident_id = ?', [unitId, incident.id]
  );
  return result.affectedRows > 0;
}

async function addResource(incidentUuid, resourceData) {
  const incident = await queryOne('SELECT id FROM incidents WHERE uuid = ? AND is_deleted = 0', [incidentUuid]);
  if (!incident) return null;
  const result = await execute(
    'INSERT INTO incident_resources (incident_id, resource_type, resource_name, quantity, notes) VALUES (?, ?, ?, ?, ?)',
    [incident.id, resourceData.resource_type, resourceData.resource_name, resourceData.quantity || 1, resourceData.notes || null]
  );
  return queryOne('SELECT * FROM incident_resources WHERE id = ?', [result.insertId]);
}

async function removeResource(incidentUuid, resourceId) {
  const incident = await queryOne('SELECT id FROM incidents WHERE uuid = ? AND is_deleted = 0', [incidentUuid]);
  if (!incident) return false;
  const result = await execute(
    'DELETE FROM incident_resources WHERE id = ? AND incident_id = ?', [resourceId, incident.id]
  );
  return result.affectedRows > 0;
}

async function updateStatus(uuid, newStatus, userId, notes) {
  const found = await transaction(async conn => {
    const incident = await lockIncident(conn, uuid);
    if (!incident) return false;

    const updates = ['status = ?', ...statusTimestamps(newStatus, incident)];
    await execute(`UPDATE incidents SET ${updates.join(', ')} WHERE id = ?`, [newStatus, incident.id], conn);
    await addHistory(conn, incident, newStatus, userId, notes);
    return true;
  });
  return found ? findByUuid(uuid) : null;
}

// Nota de campo: el chofer informa novedades, cambia el estado o corrige la ubicación
async function addNote(uuid, userId, { latitude, longitude, notes, status } = {}) {
  const found = await transaction(async conn => {
    const incident = await lockIncident(conn, uuid);
    if (!incident) return false;

    const statusChanged = status && status !== incident.status;
    const updates = [];
    const values  = [];

    if (latitude != null && longitude != null) {
      updates.push('latitude = ?', 'longitude = ?');
      values.push(latitude, longitude);
    }
    if (statusChanged) {
      updates.push('status = ?', ...statusTimestamps(status, incident));
      values.push(status);
    }
    if (updates.length) {
      values.push(incident.id);
      await execute(`UPDATE incidents SET ${updates.join(', ')} WHERE id = ?`, values, conn);
    }

    if (notes || statusChanged) {
      await addHistory(conn, incident, statusChanged ? status : incident.status, userId, notes);
    }
    return true;
  });
  return found ? findByUuid(uuid) : null;
}

async function getStatusHistory(uuid) {
  const incident = await queryOne('SELECT id FROM incidents WHERE uuid = ? AND is_deleted = 0', [uuid]);
  if (!incident) return null;
  return query(
    `SELECT sh.*, u.username, u.full_name
     FROM incident_status_history sh
     LEFT JOIN users u ON u.id = sh.changed_by_user_id
     WHERE sh.incident_id = ?
     ORDER BY sh.changed_at ASC, sh.id ASC`,
    [incident.id]
  );
}

// Completa con cero los días sin incidentes para que la serie sea continua
function fillDays(rows, days) {
  const counts = new Map(rows.map(r => [r.day, r.count]));
  const todayAr = new Date(Date.now() - 3 * 3600 * 1000);
  const result = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(todayAr);
    d.setUTCDate(d.getUTCDate() - i);
    const day = d.toISOString().slice(0, 10);
    result.push({ day, count: counts.get(day) || 0 });
  }
  return result;
}

async function getDashboardStats() {
  const open = `status NOT IN ('CERRADO','CANCELADO')`;
  const [
    todayRow, openRow, criticalRow, monthRow, peopleRow, byType, byStatus, byDay,
  ] = await Promise.all([
    queryOne('SELECT COUNT(*) AS count FROM incidents WHERE is_deleted = 0 AND started_at >= CURDATE()'),
    queryOne(`SELECT COUNT(*) AS count FROM incidents WHERE is_deleted = 0 AND ${open}`),
    queryOne(`SELECT COUNT(*) AS count FROM incidents WHERE is_deleted = 0 AND priority = 'CRITICA' AND ${open}`),
    queryOne(`SELECT COUNT(*) AS count FROM incidents WHERE is_deleted = 0 AND started_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')`),
    queryOne(`SELECT COALESCE(SUM(affected_persons_count), 0) AS affected, COALESCE(SUM(evacuated_count), 0) AS evacuated
              FROM incidents WHERE is_deleted = 0 AND ${open}`),
    query(`SELECT it.id, it.code, it.name, it.color_hex, it.icon, COUNT(*) AS count
           FROM incidents i JOIN incident_types it ON it.id = i.incident_type_id
           WHERE i.is_deleted = 0
           GROUP BY it.id, it.code, it.name, it.color_hex, it.icon
           ORDER BY count DESC, it.name`),
    query(`SELECT status, COUNT(*) AS count FROM incidents WHERE is_deleted = 0 GROUP BY status`),
    query(`SELECT DATE_FORMAT(started_at, '%Y-%m-%d') AS day, COUNT(*) AS count
           FROM incidents
           WHERE is_deleted = 0 AND started_at >= CURDATE() - INTERVAL 13 DAY
           GROUP BY day ORDER BY day`),
  ]);

  return {
    today:     todayRow.count,
    open:      openRow.count,
    critical:  criticalRow.count,
    month:     monthRow.count,
    affected:  Number(peopleRow.affected),
    evacuated: Number(peopleRow.evacuated),
    byType,
    byStatus,
    byDay:     fillDays(byDay, 14),
  };
}

module.exports = {
  findAll, findByUuid, findMapPoints, create, update, softDelete,
  addUnit, removeUnit, addResource, removeResource,
  updateStatus, getStatusHistory, getDashboardStats, addNote,
  likePattern,
};
