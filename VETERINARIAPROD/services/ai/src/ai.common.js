'use strict';

const db = require('../../../shared/db');
const R = require('../../../shared/response');
const ai = require('../../../shared/ai');
const { decrypt, decryptRows } = require('../../../shared/encryption');
const { computeRiskScores, summarizeRisks } = require('../../../shared/riskEngine');
const { requirePerm } = require('../../../shared/serviceBase');
const { getRequestContext } = require('../../../shared/requestContext');
const { validateRequest } = require('../../../shared/validation');
const { getTableColumns } = require('../../../shared/schemaEngine');
const { createLogger } = require('../../../shared/logger');

const log = createLogger('ai');

const AI_TIMEOUT_MS = parseInt(process.env.AI_TIMEOUT_MS || '30000');

/**
 * Ejecuta una llamada AI con timeout máximo configurable (default 30s).
 * Lanza AbortError si se supera el tiempo, que el caller maneja como 504.
 */
async function withAiTimeout(fn) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

const CHAT_SYSTEM_PROMPT = `Sos VetBot, asistente clinico veterinario para profesionales de la salud animal.
Respondes preguntas sobre protocolos clinicos, farmacologia veterinaria, diagnosticos diferenciales e interpretacion de estudios.
Usas terminologia tecnica veterinaria en espanol (Argentina).
Siempre aclaras cuando una decision clinica requiere evaluacion presencial.
No reemplazas el criterio del veterinario tratante.`;

const SCHEMA_TTL_MS = parseInt(process.env.SCHEMA_CACHE_TTL_MS || '300000'); // 5 min
const schemaCache = new Map(); // key → { value, expiresAt }

function sanitizeForPrompt(str, maxLen = 200) {
  if (!str) return '';
  return String(str).replace(/[\r\n\t]/g, ' ').slice(0, maxLen);
}

function validate(req, res, next) {
  return validateRequest(req, res, next);
}

function getUser(req) {
  return req.user || getRequestContext(req.headers);
}

async function ensurePatientInUserScope(patientId, user) {
  return db.queryOne(
    `SELECT p.id
       FROM patients p
      WHERE p.id = :patientId
        AND p.organization_id = :orgId
        AND (
          :branchId IS NULL
          OR EXISTS (
            SELECT 1
              FROM patient_owners po
              JOIN clients c ON c.id = po.client_id
             WHERE po.patient_id = p.id
               AND c.branch_id = :branchId
               AND po.deleted_at IS NULL
          )
        )`,
    {
      patientId,
      orgId: user?.orgId || null,
      branchId: user?.branchId || null,
    }
  );
}

async function hasColumn(tableName, columnName) {
  const key = `${tableName}.${columnName}`;
  const cached = schemaCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.value;

  const rows = await getTableColumns(tableName);
  const columns = new Set(rows.map((r) => r.COLUMN_NAME));
  const value = columns.has(columnName);
  schemaCache.set(key, { value, expiresAt: Date.now() + SCHEMA_TTL_MS });
  return value;
}

async function buildPatientSelect() {
  const orgColumn = await hasColumn('patients', 'organization_id');
  const weightExpr = await hasColumn('patients', 'weight_kg') ? 'p.weight_kg AS weight' : 'NULL AS weight';
  const bodyConditionExpr = await hasColumn('patients', 'body_condition_score') ? 'p.body_condition_score' : 'NULL';

  return {
    orgFilter: orgColumn ? 'AND p.organization_id = :org' : '',
    select: `p.id, p.name, p.birthdate, p.sex, ${weightExpr}, p.chip_number,
             ${bodyConditionExpr} AS body_condition_score,
             sp.common_name AS species, br.name AS breed`,
  };
}

function buildDiagnosisPrompt(patient, symptoms, anamnesis, recentHistory) {
  const ageText = patient.birthdate
    ? `${Math.floor((Date.now() - new Date(patient.birthdate)) / (365.25 * 86_400_000))} años`
    : 'desconocida';

  return [
    {
      role: 'system',
      content: 'Sos un asistente de diagnostico veterinario. Respondé ÚNICAMENTE con JSON válido, sin texto adicional.',
    },
    {
      role: 'user',
      content: `PACIENTE:
- Especie: ${patient.species || 'desconocida'}
- Raza: ${patient.breed || 'desconocida'}
- Edad: ${ageText}
- Sexo: ${patient.sex || 'desconocido'}
- Peso: ${patient.weight ? patient.weight + ' kg' : 'desconocido'}

MOTIVO DE CONSULTA: ${symptoms.join(', ')}
ANAMNESIS: ${anamnesis || 'No disponible'}
HISTORIA RECIENTE: ${recentHistory || 'Sin registros previos'}

Generá diagnósticos diferenciales en este JSON exacto:
{
  "diagnoses": [
    {
      "name": "nombre del diagnóstico",
      "probability": 0.0,
      "reasoning": "justificación breve",
      "recommended_tests": ["test1"]
    }
  ],
  "urgency": "routine|urgent|emergency",
  "disclaimer": "Este análisis es asistido por IA y no reemplaza el criterio clínico profesional."
}

Máximo 5 diagnósticos ordenados por probabilidad descendente. Terminología veterinaria en español.`,
    },
  ];
}

function buildImagePrompt(imageType, patient, region, clinicalContext) {
  const ageText = patient.birthdate
    ? `${Math.floor((Date.now() - new Date(patient.birthdate)) / (365.25 * 86_400_000))} años`
    : 'desconocida';

  return `Sos un especialista en diagnostico por imagenes veterinarias. Analizá esta imagen de tipo: ${imageType}.

CONTEXTO CLINICO:
- Especie: ${sanitizeForPrompt(patient.species, 50) || 'desconocida'}
- Raza: ${sanitizeForPrompt(patient.breed, 80) || 'desconocida'}
- Edad: ${ageText}
- Región anatómica: ${sanitizeForPrompt(region, 100) || 'no especificada'}
- Motivo del estudio: ${sanitizeForPrompt(clinicalContext, 200) || 'no especificado'}

Respondé ÚNICAMENTE con este JSON:
{
  "findings": ["hallazgo 1", "hallazgo 2"],
  "assessment": "interpretación general",
  "severity": "normal|mild|moderate|severe|critical",
  "recommendations": ["recomendación 1"],
  "limitations": "limitaciones del análisis automático"
}`;
}

module.exports = {
  db,
  R,
  ai,
  decrypt,
  decryptRows,
  computeRiskScores,
  summarizeRisks,
  getUser,
  ensurePatientInUserScope,
  requirePerm,
  validate,
  buildPatientSelect,
  buildDiagnosisPrompt,
  buildImagePrompt,
  sanitizeForPrompt,
  CHAT_SYSTEM_PROMPT,
  withAiTimeout,
  log,
};
