const geoModel = require('../models/geo.model');

// Simple in-memory cache for rarely-changing geo data
const cache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

function fromCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) { cache.delete(key); return null; }
  return entry.data;
}

function toCache(key, data) {
  cache.set(key, { data, expires: Date.now() + CACHE_TTL });
  return data;
}

async function getProvinces(req, res, next) {
  try {
    const cached = fromCache('provinces');
    const data   = cached || toCache('provinces', await geoModel.getProvinces());
    res.json(data);
  } catch (err) { next(err); }
}

async function getPartidos(req, res, next) {
  try {
    const key    = `partidos:${req.params.id}`;
    const cached = fromCache(key);
    const data   = cached || toCache(key, await geoModel.getPartidos(req.params.id));
    res.json(data);
  } catch (err) { next(err); }
}

async function getLocalities(req, res, next) {
  try {
    const key    = `localities:${req.params.id}`;
    const cached = fromCache(key);
    const data   = cached || toCache(key, await geoModel.getLocalities(req.params.id));
    res.json(data);
  } catch (err) { next(err); }
}

async function getPoliceStations(req, res, next) {
  try {
    const provinceId = req.query.province_id;
    const key        = `police:${provinceId || 'all'}`;
    const cached     = fromCache(key);
    const data       = cached || toCache(key, await geoModel.getPoliceStations(provinceId));
    res.json(data);
  } catch (err) { next(err); }
}

async function getIncidentTypes(req, res, next) {
  try {
    const cached = fromCache('incident_types');
    const data   = cached || toCache('incident_types', await geoModel.getIncidentTypes());
    res.json(data);
  } catch (err) { next(err); }
}

async function getInfrastructure(req, res, next) {
  try {
    const { type, province_id, partido_id } = req.query;
    const key    = `infra:${type||'all'}:${province_id||'all'}:${partido_id||'all'}`;
    const cached = fromCache(key);
    const data   = cached || toCache(key, await geoModel.getInfrastructure({ type, province_id, partido_id }));
    res.json(data);
  } catch (err) { next(err); }
}

module.exports = { getProvinces, getPartidos, getLocalities, getPoliceStations, getIncidentTypes, getInfrastructure };
