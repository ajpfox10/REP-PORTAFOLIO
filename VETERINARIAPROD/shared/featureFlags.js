'use strict';

/**
 * Feature Flags - per-org feature toggles persisted in Redis.
 */

const { createLogger } = require('./logger');
const cache = require('./cache');

const log = createLogger('feature-flags');
const FLAG_CACHE_TTL_S = Math.max(60, parseInt(process.env.FEATURE_FLAGS_TTL_S || '300', 10));

const DEFAULT_FLAGS = {
  ai_diagnosis:        false,
  ai_image_analysis:   false,
  ai_chatbot:          false,
  ai_risk_assessment:  false,
  telemedicine:        true,
  grooming:            true,
  portal_owner:        true,
  digital_signature:   false,
  whatsapp_notify:     false,
  advanced_reports:    true,
  multi_branch:        true,
  inventory_advanced:  false,
};

const FLAG_DEFINITIONS = [
  { key: 'ai_diagnosis',       label: 'Diagnostico asistido',    description: 'Habilita sugerencias diagnosticas por IA.', category: 'ai' },
  { key: 'ai_image_analysis',  label: 'Analisis de imagenes',    description: 'Habilita analisis automatizado de estudios e imagenes.', category: 'ai' },
  { key: 'ai_chatbot',         label: 'Chat clinico',            description: 'Habilita el asistente conversacional clinico.', category: 'ai' },
  { key: 'ai_risk_assessment', label: 'Evaluacion de riesgo',    description: 'Habilita calculo e historial de riesgo del paciente.', category: 'ai' },
  { key: 'telemedicine',       label: 'Telemedicina',            description: 'Habilita modulos y flujos de telemedicina.', category: 'general' },
  { key: 'grooming',           label: 'Grooming',                description: 'Habilita el modulo de grooming.', category: 'general' },
  { key: 'portal_owner',       label: 'Portal de duenos',        description: 'Habilita el portal del cliente final.', category: 'general' },
  { key: 'digital_signature',  label: 'Firma digital',           description: 'Habilita captura y validacion de firmas digitales.', category: 'general' },
  { key: 'whatsapp_notify',    label: 'Notificaciones WhatsApp', description: 'Habilita flujos de mensajeria por WhatsApp.', category: 'general' },
  { key: 'advanced_reports',   label: 'Reportes avanzados',      description: 'Habilita reportes avanzados y consolidados.', category: 'general' },
  { key: 'multi_branch',       label: 'Multi sucursal',          description: 'Habilita capacidades multi-sucursal en la organizacion.', category: 'general' },
  { key: 'inventory_advanced', label: 'Inventario avanzado',     description: 'Habilita funciones avanzadas de inventario.', category: 'general' },
];

function normalizeFlags(input = {}) {
  const merged = { ...DEFAULT_FLAGS };
  for (const key of Object.keys(DEFAULT_FLAGS)) {
    if (Object.prototype.hasOwnProperty.call(input, key)) merged[key] = Boolean(input[key]);
  }
  return merged;
}

async function readOrgFlags(orgId) {
  if (!orgId) return { ...DEFAULT_FLAGS };
  const raw = await cache.get(`ff:org:${orgId}`);
  if (!raw) return null;
  return normalizeFlags(raw);
}

async function isEnabled(flag, orgId) {
  const flags = await getFlags(orgId);
  if (flag in flags) return Boolean(flags[flag]);
  return Boolean(DEFAULT_FLAGS[flag] ?? false);
}

async function getFlags(orgId) {
  const cached = await readOrgFlags(orgId);
  if (cached) return cached;
  return { ...DEFAULT_FLAGS };
}

async function setFlag(orgId, flag, value) {
  return setFlags(orgId, { [flag]: value });
}

async function setFlags(orgId, updates = {}) {
  const next = normalizeFlags({ ...(await readOrgFlags(orgId)), ...updates });
  await cache.set(`ff:org:${orgId}`, next, FLAG_CACHE_TTL_S);
  return next;
}

function requireFeature(flag) {
  return async (req, res, next) => {
    try {
      const orgId = req.user?.orgId;
      if (await isEnabled(flag, orgId)) return next();

      res.status(403).json({
        success: false,
        error:   { message: `Feature '${flag}' is not enabled for your organization`, code: 'FEATURE_DISABLED' },
      });
    } catch (err) {
      // SEC: fail-closed — si no se puede verificar el flag, denegar acceso.
      // El comportamiento anterior (fail-open) permitía acceso a features deshabilitadas
      // cuando Redis fallaba, lo que podría exponer módulos de pago no contratados.
      log.warn('Feature gate check failed, denying request (fail-closed)', {
        flag,
        orgId: req.user?.orgId,
        message: err?.message,
        code: err?.code,
      });
      res.status(503).json({
        success: false,
        error: { message: 'Feature availability check temporarily unavailable', code: 'SVC_001' },
      });
    }
  };
}

module.exports = {
  isEnabled,
  getFlags,
  setFlag,
  setFlags,
  requireFeature,
  DEFAULT_FLAGS,
  FLAG_DEFINITIONS,
};
