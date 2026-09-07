'use strict';

const dns = require('dns').promises;
const {
  resolveServiceTarget,
  resolveServiceTargets,
  listServices,
} = require('./serviceRegistry');

const HEALTH_TTL_MS = Math.max(5_000, parseInt(process.env.SERVICE_DISCOVERY_HEALTH_TTL_MS || '15000', 10));
const HEALTH_TIMEOUT_MS = Math.max(300, parseInt(process.env.SERVICE_DISCOVERY_HEALTH_TIMEOUT_MS || '1200', 10));
const HEALTH_PATH = process.env.SERVICE_DISCOVERY_HEALTH_PATH || '/health/ready';

const SERVICES = {
  auth: {
    envVar: 'SERVICE_AUTH',
    fallback: process.env.SERVICE_AUTH || 'http://localhost:4051',
    aliases: ['auth', 'auth.service', 'auth.railway.internal'],
  },
  patients: {
    envVar: 'SERVICE_PATIENTS',
    fallback: process.env.SERVICE_PATIENTS || 'http://localhost:4052',
    aliases: ['patients', 'patients.service', 'patients.railway.internal'],
  },
  medical: {
    envVar: 'SERVICE_MEDICAL',
    fallback: process.env.SERVICE_MEDICAL || 'http://localhost:4053',
    aliases: ['medical', 'medical.service', 'medical.railway.internal'],
  },
  lab: {
    envVar: 'SERVICE_LAB',
    fallback: process.env.SERVICE_LAB || 'http://localhost:4054',
    aliases: ['lab', 'lab-imaging', 'lab.railway.internal'],
  },
  billing: {
    envVar: 'SERVICE_BILLING',
    fallback: process.env.SERVICE_BILLING || 'http://localhost:4055',
    aliases: ['billing', 'billing.service', 'billing.railway.internal'],
  },
  telemedicine: {
    envVar: 'SERVICE_TELEMEDICINE',
    fallback: process.env.SERVICE_TELEMEDICINE || 'http://localhost:4056',
    aliases: ['telemedicine', 'telemedicine.service', 'telemedicine.railway.internal'],
  },
  grooming: {
    envVar: 'SERVICE_GROOMING',
    fallback: process.env.SERVICE_GROOMING || 'http://localhost:4057',
    aliases: ['grooming', 'grooming.service', 'grooming.railway.internal'],
  },
  reports: {
    envVar: 'SERVICE_REPORTS',
    fallback: process.env.SERVICE_REPORTS || 'http://localhost:4058',
    aliases: ['reports', 'reports.service', 'reports.railway.internal'],
  },
  notifications: {
    envVar: 'SERVICE_NOTIFICATIONS',
    fallback: process.env.SERVICE_NOTIFICATIONS || 'http://localhost:4059',
    aliases: ['notifications', 'notifications.service', 'notifications.railway.internal'],
  },
  portal: {
    envVar: 'SERVICE_PORTAL',
    fallback: process.env.SERVICE_PORTAL || 'http://localhost:4060',
    aliases: ['portal', 'portal.service', 'portal.railway.internal'],
  },
  ai: {
    envVar: 'SERVICE_AI',
    fallback: process.env.SERVICE_AI || 'http://localhost:4061',
    aliases: ['ai', 'ai.service', 'ai.railway.internal'],
  },
  documents: {
    envVar: 'SERVICE_DOCUMENTS',
    fallback: process.env.SERVICE_DOCUMENTS || 'http://localhost:4062',
    aliases: ['documents', 'documents.service', 'documents.railway.internal'],
  },
};

const SERVICE_FALLBACKS = Object.fromEntries(
  Object.entries(SERVICES).map(([name, config]) => [name, config.fallback]),
);

const healthCache = new Map();
const serviceCursor = new Map();

function getDiscoveryMode() {
  return String(process.env.SERVICE_DISCOVERY_MODE || 'runtime').toLowerCase();
}

function isHealthAwareEnabled() {
  return process.env.SERVICE_DISCOVERY_HEALTH_AWARE !== 'false';
}

function getServiceFallback(name) {
  return SERVICES[name]?.fallback || null;
}

function getServiceConfig(name) {
  return SERVICES[name] || {
    envVar: `SERVICE_${String(name || '').toUpperCase()}`,
    fallback: null,
    aliases: [name],
  };
}

function normalizeUrl(value) {
  if (!value) return null;
  try {
    return new URL(String(value)).toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function uniqueUrls(values) {
  return [...new Set(values.map(normalizeUrl).filter(Boolean))];
}

function getConfiguredTargets(name) {
  const config = getServiceConfig(name);
  const csvEnv = process.env[`${config.envVar}_URLS`] || process.env[`SERVICE_${String(name).toUpperCase()}_URLS`] || '';
  const csvTargets = csvEnv
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return uniqueUrls([
    ...csvTargets,
    process.env[config.envVar],
    config.fallback,
  ]);
}

function buildUrlFromAlias(alias, baseUrl) {
  try {
    const base = new URL(baseUrl || 'http://localhost:80');
    base.hostname = alias;
    return base.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

async function resolveDnsTargets(name) {
  const config = getServiceConfig(name);
  const baseUrl = config.fallback || process.env[config.envVar] || 'http://localhost:80';
  const resolved = [];

  for (const alias of config.aliases || []) {
    try {
      const entries = await dns.lookup(alias, { all: true });
      if (!entries || entries.length === 0) continue;
      for (const _entry of entries) {
        const candidate = buildUrlFromAlias(alias, baseUrl);
        if (candidate) resolved.push(candidate);
      }
    } catch {
      // DNS not available for this alias in current runtime.
    }
  }

  return uniqueUrls(resolved);
}

async function resolveRegistryUrls(name) {
  const rows = await resolveServiceTargets(name).catch(() => []);
  return uniqueUrls(rows.map((row) => row.url));
}

async function gatherCandidateTargets(name) {
  const mode = getDiscoveryMode();
  const configured = getConfiguredTargets(name);

  if (mode === 'env') return configured;
  if (mode === 'registry') return resolveRegistryUrls(name);
  if (mode === 'dns' || mode === 'runtime') {
    return uniqueUrls([
      ...(await resolveDnsTargets(name)),
      ...configured,
    ]);
  }

  if (mode === 'hybrid') {
    return uniqueUrls([
      ...(await resolveRegistryUrls(name)),
      ...(await resolveDnsTargets(name)),
      ...configured,
    ]);
  }

  return uniqueUrls([
    ...(await resolveDnsTargets(name)),
    ...(await resolveRegistryUrls(name)),
    ...configured,
  ]);
}

// SEC: lista de prefijos de hostnames permitidos para service discovery health probes.
// Evita SSRF si un valor malicioso llega al registry de servicios.
// Solo se permiten dominios de la red interna de servicios conocidos.
const ALLOWED_SERVICE_HOSTS_RE = /^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|[a-zA-Z0-9-]+\.railway\.internal|[a-zA-Z0-9-]+\.internal)$/;

function isAllowedServiceUrl(url) {
  try {
    const parsed = new URL(url);
    // Solo http/https
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname;
    // Permitir localhost / redes privadas / sufijos .internal de Railway
    return ALLOWED_SERVICE_HOSTS_RE.test(host);
  } catch {
    return false;
  }
}

async function probeTarget(url) {
  const cached = healthCache.get(url);
  if (cached && (Date.now() - cached.checkedAt) < HEALTH_TTL_MS) {
    return cached;
  }

  const result = {
    url,
    healthy: false,
    checkedAt: Date.now(),
    statusCode: null,
  };

  // SEC: validar que la URL de health probe sea un servicio interno conocido
  // para evitar SSRF si un valor arbitrario llega vía DNS discovery o registry.
  if (!isAllowedServiceUrl(url)) {
    result.healthy = false;
    healthCache.set(url, result);
    return result;
  }

  try {
    const response = await fetch(`${url}${HEALTH_PATH}`, {
      method: 'GET',
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      headers: { Accept: 'application/json' },
    });
    result.statusCode = response.status;
    result.healthy = response.status >= 200 && response.status < 300;
  } catch {
    result.healthy = false;
  }

  healthCache.set(url, result);
  return result;
}

async function filterHealthyTargets(name, targets) {
  if (!isHealthAwareEnabled() || targets.length <= 1) {
    return targets.map((url) => ({ url, healthy: true, source: 'candidate' }));
  }

  const probed = await Promise.all(targets.map((url) => probeTarget(url)));
  const healthy = probed.filter((row) => row.healthy);
  if (healthy.length > 0) return healthy;

  return probed.length > 0 ? probed : targets.map((url) => ({ url, healthy: false }));
}

function selectRoundRobin(name, rows) {
  if (rows.length === 0) return null;
  const next = serviceCursor.get(name) || 0;
  const row = rows[next % rows.length];
  serviceCursor.set(name, (next + 1) % rows.length);
  return row;
}

async function resolveRuntimeServiceTarget(name) {
  const fallback = getServiceFallback(name);
  const candidates = await gatherCandidateTargets(name);
  const normalized = uniqueUrls(candidates.length ? candidates : [fallback]);
  const selected = selectRoundRobin(name, await filterHealthyTargets(name, normalized));
  if (selected?.url) return selected.url;
  return resolveServiceTarget(name, fallback);
}

async function resolveRuntimeServiceTargets(name) {
  const fallback = getServiceFallback(name);
  const candidates = await gatherCandidateTargets(name);
  const normalized = uniqueUrls(candidates.length ? candidates : [fallback]);
  return filterHealthyTargets(name, normalized);
}

async function listKnownServiceTargets() {
  const rows = await listServices().catch(() => []);
  const registryByName = rows.reduce((acc, row) => {
    if (!acc[row.name]) acc[row.name] = [];
    acc[row.name].push(row);
    return acc;
  }, {});

  const result = [];
  for (const name of Object.keys(SERVICE_FALLBACKS)) {
    const discovered = await resolveRuntimeServiceTargets(name).catch(() => []);
    result.push({
      name,
      fallback: SERVICE_FALLBACKS[name],
      targets: discovered.map((row) => row.url),
      instances: registryByName[name] || [],
      source: getDiscoveryMode(),
    });
  }
  return result;
}

module.exports = {
  SERVICES,
  SERVICE_FALLBACKS,
  getDiscoveryMode,
  getServiceFallback,
  resolveRuntimeServiceTarget,
  resolveRuntimeServiceTargets,
  listKnownServiceTargets,
  __private: {
    getConfiguredTargets,
    resolveDnsTargets,
    gatherCandidateTargets,
    filterHealthyTargets,
    selectRoundRobin,
    uniqueUrls,
  },
};
