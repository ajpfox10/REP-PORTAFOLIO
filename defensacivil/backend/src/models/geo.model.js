const { query, queryOne, execute } = require('../config/database');

const INFRA_TYPES = ['HOSPITAL', 'SALITA', 'BOMBEROS', 'SAME', 'DEFENSA_CIVIL', 'CUARTEL_GN', 'OTRO'];

async function getProvinces() {
  return query('SELECT id, code, name FROM provinces ORDER BY name');
}

async function getPartidos(provinceId) {
  // Incluye una coordenada representativa (primera localidad con coordenadas)
  return query(
    `SELECT p.id, p.name,
            (SELECT l.latitude  FROM localities l WHERE l.partido_id = p.id AND l.latitude  IS NOT NULL ORDER BY l.id LIMIT 1) AS latitude,
            (SELECT l.longitude FROM localities l WHERE l.partido_id = p.id AND l.longitude IS NOT NULL ORDER BY l.id LIMIT 1) AS longitude
     FROM partidos p
     WHERE p.province_id = ?
     ORDER BY p.name`,
    [provinceId]
  );
}

async function getLocalities(partidoId) {
  return query(
    'SELECT id, name, postal_code, latitude, longitude FROM localities WHERE partido_id = ? ORDER BY name',
    [partidoId]
  );
}

async function getPoliceStations(provinceId) {
  const params = [];
  let where = 'ps.is_active = 1';
  if (provinceId) { where += ' AND ps.province_id = ?'; params.push(provinceId); }
  return query(
    `SELECT ps.id, ps.name, ps.address, ps.phone, ps.province_id, ps.partido_id,
            ps.latitude, ps.longitude, p.name AS province_name, pa.name AS partido_name
     FROM police_stations ps
     LEFT JOIN provinces p  ON p.id  = ps.province_id
     LEFT JOIN partidos pa  ON pa.id = ps.partido_id
     WHERE ${where}
     ORDER BY ps.name`,
    params
  );
}

async function getIncidentTypes() {
  const types = await query(
    `SELECT id, code, name, description, icon, color_hex, sort_order
     FROM incident_types WHERE is_active = 1 ORDER BY sort_order, name`
  );
  const subtypes = await query(
    `SELECT id, incident_type_id, code, name
     FROM incident_subtypes WHERE is_active = 1 ORDER BY name`
  );

  return types.map(t => ({
    ...t,
    subtypes: subtypes.filter(s => s.incident_type_id === t.id),
  }));
}

async function getInfrastructure({ type, province_id, partido_id } = {}) {
  const conditions = ['ip.is_active = 1'];
  const params     = [];

  if (type)        { conditions.push('ip.type = ?');        params.push(type);        }
  if (province_id) { conditions.push('ip.province_id = ?'); params.push(province_id); }
  if (partido_id)  { conditions.push('ip.partido_id = ?');  params.push(partido_id);  }

  return query(
    `SELECT ip.id, ip.type, ip.name, ip.address, ip.phone,
            ip.province_id, ip.partido_id, ip.latitude, ip.longitude,
            ip.beds, ip.level,
            p.name AS province_name, pa.name AS partido_name
     FROM infrastructure_points ip
     LEFT JOIN provinces p  ON p.id  = ip.province_id
     LEFT JOIN partidos  pa ON pa.id = ip.partido_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY ip.type, ip.name`,
    params
  );
}

// ── Infraestructura (hospitales, cuarteles, bases) ──────────────────────────

const INFRA_FIELDS = ['type', 'name', 'address', 'phone', 'province_id', 'partido_id', 'latitude', 'longitude', 'beds', 'level'];
const STATION_FIELDS = ['name', 'address', 'phone', 'province_id', 'partido_id', 'latitude', 'longitude'];

const valueOf = v => (v === '' || v === undefined ? null : v);

async function createRow(table, fields, data) {
  const result = await execute(
    `INSERT INTO ${table} (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`,
    fields.map(f => valueOf(data[f]))
  );
  return result.insertId;
}

// Actualiza solo los campos enviados; devuelve false si el registro no existe
async function updateRow(table, fields, id, data) {
  const present = fields.filter(f => data[f] !== undefined);
  if (!present.length) return !!(await queryOne(`SELECT id FROM ${table} WHERE id = ? AND is_active = 1`, [id]));
  const result = await execute(
    `UPDATE ${table} SET ${present.map(f => `${f} = ?`).join(', ')} WHERE id = ? AND is_active = 1`,
    [...present.map(f => valueOf(data[f])), id]
  );
  return result.affectedRows > 0;
}

async function deactivateRow(table, id) {
  const result = await execute(`UPDATE ${table} SET is_active = 0 WHERE id = ? AND is_active = 1`, [id]);
  return result.affectedRows > 0;
}

const createInfrastructure = data => createRow('infrastructure_points', INFRA_FIELDS, data);
const updateInfrastructure = (id, data) => updateRow('infrastructure_points', INFRA_FIELDS, id, data);
const deleteInfrastructure = id => deactivateRow('infrastructure_points', id);

const createPoliceStation = data => createRow('police_stations', STATION_FIELDS, data);
const updatePoliceStation = (id, data) => updateRow('police_stations', STATION_FIELDS, id, data);
const deletePoliceStation = id => deactivateRow('police_stations', id);

module.exports = {
  INFRA_TYPES,
  getProvinces, getPartidos, getLocalities, getPoliceStations, getIncidentTypes, getInfrastructure,
  createInfrastructure, updateInfrastructure, deleteInfrastructure,
  createPoliceStation, updatePoliceStation, deletePoliceStation,
};
