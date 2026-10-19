const geoModel = require('../models/geo.model');

// Caché en memoria para datos que casi no cambian (provincias, tipos, etc.)
const cache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hora

async function cached(key, load) {
  const entry = cache.get(key);
  if (entry && Date.now() < entry.expires) return entry.data;
  const data = await load();
  cache.set(key, { data, expires: Date.now() + CACHE_TTL });
  return data;
}

function clearCache(...prefixes) {
  for (const key of cache.keys()) {
    if (prefixes.some(p => key.startsWith(p))) cache.delete(key);
  }
}

const handler = fn => async (req, res, next) => {
  try { await fn(req, res); } catch (err) { next(err); }
};

const getProvinces = handler(async (req, res) => {
  res.json(await cached('provinces', () => geoModel.getProvinces()));
});

const getPartidos = handler(async (req, res) => {
  res.json(await cached(`partidos:${req.params.id}`, () => geoModel.getPartidos(req.params.id)));
});

const getLocalities = handler(async (req, res) => {
  res.json(await cached(`localities:${req.params.id}`, () => geoModel.getLocalities(req.params.id)));
});

const getPoliceStations = handler(async (req, res) => {
  const provinceId = req.query.province_id;
  res.json(await cached(`police:${provinceId || 'all'}`, () => geoModel.getPoliceStations(provinceId)));
});

const getIncidentTypes = handler(async (req, res) => {
  res.json(await cached('incident_types', () => geoModel.getIncidentTypes()));
});

const getInfrastructure = handler(async (req, res) => {
  const { type, province_id, partido_id } = req.query;
  const key = `infra:${type || 'all'}:${province_id || 'all'}:${partido_id || 'all'}`;
  res.json(await cached(key, () => geoModel.getInfrastructure({ type, province_id, partido_id })));
});

// ── Altas, ediciones y bajas ───────────────────────────────────────────────

const createInfrastructure = handler(async (req, res) => {
  const id = await geoModel.createInfrastructure(req.body);
  clearCache('infra:');
  res.status(201).json({ id });
});

const updateInfrastructure = handler(async (req, res) => {
  const ok = await geoModel.updateInfrastructure(req.params.id, req.body);
  if (!ok) return res.status(404).json({ error: 'Punto de infraestructura no encontrado' });
  clearCache('infra:');
  res.json({ id: Number(req.params.id) });
});

const deleteInfrastructure = handler(async (req, res) => {
  const ok = await geoModel.deleteInfrastructure(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Punto de infraestructura no encontrado' });
  clearCache('infra:');
  res.json({ message: 'Punto de infraestructura dado de baja' });
});

const createPoliceStation = handler(async (req, res) => {
  const id = await geoModel.createPoliceStation(req.body);
  clearCache('police:');
  res.status(201).json({ id });
});

const updatePoliceStation = handler(async (req, res) => {
  const ok = await geoModel.updatePoliceStation(req.params.id, req.body);
  if (!ok) return res.status(404).json({ error: 'Comisaría no encontrada' });
  clearCache('police:');
  res.json({ id: Number(req.params.id) });
});

const deletePoliceStation = handler(async (req, res) => {
  const ok = await geoModel.deletePoliceStation(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Comisaría no encontrada' });
  clearCache('police:');
  res.json({ message: 'Comisaría dada de baja' });
});

module.exports = {
  getProvinces, getPartidos, getLocalities, getPoliceStations, getIncidentTypes, getInfrastructure,
  createInfrastructure, updateInfrastructure, deleteInfrastructure,
  createPoliceStation, updatePoliceStation, deletePoliceStation,
  clearCache,
};
