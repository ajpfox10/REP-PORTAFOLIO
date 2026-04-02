const { query } = require('../config/database');

async function getProvinces() {
  return query('SELECT id, code, name FROM provinces ORDER BY name');
}

async function getPartidos(provinceId) {
  // Returns partidos; includes a representative lat/lng from localities if available
  return query(
    `SELECT p.id, p.name,
            (SELECT l.latitude  FROM localities l WHERE l.partido_id = p.id AND l.latitude  IS NOT NULL LIMIT 1) AS latitude,
            (SELECT l.longitude FROM localities l WHERE l.partido_id = p.id AND l.longitude IS NOT NULL LIMIT 1) AS longitude
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
  if (provinceId) {
    return query(
      `SELECT ps.*, p.name AS province_name, pa.name AS partido_name
       FROM police_stations ps
       LEFT JOIN provinces p  ON p.id  = ps.province_id
       LEFT JOIN partidos pa  ON pa.id = ps.partido_id
       WHERE ps.is_active = 1 AND ps.province_id = ?
       ORDER BY ps.name`,
      [provinceId]
    );
  }
  return query(
    `SELECT ps.*, p.name AS province_name, pa.name AS partido_name
     FROM police_stations ps
     LEFT JOIN provinces p  ON p.id  = ps.province_id
     LEFT JOIN partidos pa  ON pa.id = ps.partido_id
     WHERE ps.is_active = 1
     ORDER BY ps.name`
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

  const where = conditions.join(' AND ');
  return query(
    `SELECT ip.id, ip.type, ip.name, ip.address, ip.phone,
            ip.province_id, ip.partido_id, ip.latitude, ip.longitude,
            ip.beds, ip.level,
            p.name AS province_name, pa.name AS partido_name
     FROM infrastructure_points ip
     LEFT JOIN provinces p  ON p.id  = ip.province_id
     LEFT JOIN partidos  pa ON pa.id = ip.partido_id
     WHERE ${where}
     ORDER BY ip.type, ip.name`,
    params
  );
}

module.exports = { getProvinces, getPartidos, getLocalities, getPoliceStations, getIncidentTypes, getInfrastructure };
