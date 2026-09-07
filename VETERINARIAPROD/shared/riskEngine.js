'use strict';

/**
 * shared/riskEngine.js
 * Motor de evaluación de riesgo clínico para pacientes veterinarios.
 * Lógica pura — sin DB ni llamadas API. Completamente testeable.
 */

// ─── Predisposiciones por raza ────────────────────────────────────────────────

const BREED_RISKS = {
  // Perros
  'golden retriever'  : [{ condition: 'cancer',        score: 0.45, reason: 'breed_predisposition' }],
  'labrador retriever': [{ condition: 'obesity',        score: 0.30, reason: 'breed_predisposition' },
                         { condition: 'hip_dysplasia',  score: 0.35, reason: 'breed_predisposition' }],
  'bulldog'           : [{ condition: 'respiratory',    score: 0.50, reason: 'brachycephalic_syndrome' },
                         { condition: 'cardiac',        score: 0.30, reason: 'breed_predisposition' }],
  'french bulldog'    : [{ condition: 'respiratory',    score: 0.55, reason: 'brachycephalic_syndrome' },
                         { condition: 'spinal',         score: 0.35, reason: 'chondrodystrophic' }],
  'pug'               : [{ condition: 'respiratory',    score: 0.55, reason: 'brachycephalic_syndrome' },
                         { condition: 'eye_disease',    score: 0.30, reason: 'breed_predisposition' }],
  'dachshund'         : [{ condition: 'spinal',         score: 0.45, reason: 'chondrodystrophic' }],
  'rottweiler'        : [{ condition: 'hip_dysplasia',  score: 0.40, reason: 'breed_predisposition' },
                         { condition: 'cancer',         score: 0.35, reason: 'breed_predisposition' }],
  'doberman'          : [{ condition: 'cardiac',        score: 0.45, reason: 'dilated_cardiomyopathy' }],
  'boxer'             : [{ condition: 'cancer',         score: 0.40, reason: 'breed_predisposition' },
                         { condition: 'cardiac',        score: 0.35, reason: 'arrhythmia' }],
  'poodle'            : [{ condition: 'eye_disease',    score: 0.25, reason: 'breed_predisposition' }],
  // Gatos
  'persian'           : [{ condition: 'renal',          score: 0.40, reason: 'polycystic_kidney' },
                         { condition: 'respiratory',    score: 0.30, reason: 'brachycephalic_syndrome' }],
  'maine coon'        : [{ condition: 'cardiac',        score: 0.45, reason: 'hypertrophic_cardiomyopathy' }],
  'ragdoll'           : [{ condition: 'cardiac',        score: 0.35, reason: 'hypertrophic_cardiomyopathy' }],
  'siamese'           : [{ condition: 'dental',         score: 0.30, reason: 'breed_predisposition' },
                         { condition: 'respiratory',    score: 0.20, reason: 'breed_predisposition' }],
  'british shorthair' : [{ condition: 'cardiac',        score: 0.30, reason: 'hypertrophic_cardiomyopathy' }],
};

// ─── Motor de puntuación ──────────────────────────────────────────────────────

/**
 * Evalúa los factores de riesgo de un paciente.
 *
 * @param {object} patient
 *   @param {string|null} patient.birthdate    — ISO date
 *   @param {number|null} patient.weight       — kg
 *   @param {number|null} patient.ideal_weight — kg (opcional)
 *   @param {string|null} patient.breed        — nombre de raza (español o inglés)
 *   @param {string|null} patient.species      — 'canino'|'felino'|'dog'|'cat'|…
 *
 * @param {object} [history]
 *   @param {number}   history.overdueVaccinations — cantidad de vacunas vencidas
 *   @param {string|null} history.lastCheckup      — ISO date del último control
 *   @param {string[]} history.chronicConditions   — condiciones crónicas conocidas
 *
 * @returns {{ risks: Array<{condition,score,level,factors}>, overallLevel: string, computedAt: string }}
 */
function computeRiskScores(patient, history = {}) {
  const raw = {};   // { condition: { score: number, factors: string[] } }

  function add(condition, delta, factor) {
    if (!raw[condition]) raw[condition] = { score: 0, factors: [] };
    raw[condition].score = Math.min(1, raw[condition].score + delta);
    raw[condition].factors.push(factor);
  }

  // ── Edad ──────────────────────────────────────────────────────────────────
  const ageYears = patient.birthdate
    ? (Date.now() - new Date(patient.birthdate).getTime()) / (365.25 * 86_400_000)
    : null;

  if (ageYears !== null) {
    const sp = (patient.species || '').toLowerCase();
    const isCat = sp.includes('feli') || sp.includes('cat') || sp === 'gato';

    if (ageYears >= (isCat ? 15 : 11)) {
      add('chronic_disease', 0.35, 'age_geriatric');
      add('organ_failure',   0.30, 'age_geriatric');
      add('dental',          0.25, 'age_geriatric');
    } else if (ageYears >= (isCat ? 10 : 7)) {
      add('chronic_disease', 0.20, 'age_senior');
      add('dental',          0.15, 'age_senior');
    }
  }

  // ── Peso ──────────────────────────────────────────────────────────────────
  if (patient.weight && patient.ideal_weight && patient.ideal_weight > 0) {
    const ratio = patient.weight / patient.ideal_weight;
    if (ratio >= 1.5) {
      add('diabetes',       0.35, 'obesity');
      add('cardiovascular', 0.30, 'obesity');
      add('joint_disease',  0.30, 'obesity');
    } else if (ratio >= 1.2) {
      add('diabetes',       0.20, 'overweight');
      add('cardiovascular', 0.15, 'overweight');
    } else if (ratio <= 0.8) {
      add('nutritional',    0.25, 'underweight');
      add('chronic_disease',0.15, 'underweight');
    }
  }

  // ── Vacunas vencidas ───────────────────────────────────────────────────────
  const overdue = history.overdueVaccinations || 0;
  if (overdue > 0) {
    add('infectious_disease', Math.min(0.60, overdue * 0.20), 'missing_vaccinations');
  }

  // ── Último control ─────────────────────────────────────────────────────────
  const monthsSinceCheckup = history.lastCheckup
    ? (Date.now() - new Date(history.lastCheckup).getTime()) / (30 * 86_400_000)
    : null;

  if (monthsSinceCheckup === null || monthsSinceCheckup > 24) {
    add('undetected_disease', 0.30, 'no_recent_checkup');
  } else if (monthsSinceCheckup > 12) {
    add('undetected_disease', 0.15, 'overdue_checkup');
  }

  // ── Condiciones crónicas ───────────────────────────────────────────────────
  for (const c of (history.chronicConditions || [])) {
    const lc = c.toLowerCase();
    if (lc.includes('diabet')) {
      add('cardiovascular', 0.25, 'existing_diabetes');
      add('renal',          0.20, 'existing_diabetes');
    }
    if (lc.includes('card') || lc.includes('coraz') || lc.includes('heart')) {
      add('cardiovascular', 0.30, 'existing_cardiac');
    }
    if (lc.includes('renal') || lc.includes('riñon') || lc.includes('kidney')) {
      add('renal', 0.35, 'existing_renal');
    }
    if (lc.includes('cancer') || lc.includes('tumor') || lc.includes('neoplasia')) {
      add('cancer', 0.40, 'existing_neoplasia');
    }
  }

  // ── Predisposición por raza ───────────────────────────────────────────────
  const breedKey = (patient.breed || '').toLowerCase().trim();
  for (const r of (BREED_RISKS[breedKey] || [])) {
    add(r.condition, r.score, r.reason);
  }

  // ── Construir resultado ───────────────────────────────────────────────────
  const risks = Object.entries(raw).map(([condition, { score, factors }]) => ({
    condition,
    score : Math.round(score * 100) / 100,
    level : score >= 0.60 ? 'high' : score >= 0.35 ? 'medium' : 'low',
    factors,
  })).sort((a, b) => b.score - a.score);

  const maxScore   = risks.length ? risks[0].score : 0;
  const overallLevel = maxScore >= 0.60 ? 'high' : maxScore >= 0.35 ? 'medium' : 'low';

  return { risks, overallLevel, computedAt: new Date().toISOString() };
}

/**
 * Genera un resumen legible y recomendaciones a partir del resultado.
 * @param {{ risks, overallLevel }} result
 */
function summarizeRisks(result) {
  const { risks, overallLevel } = result;

  if (!risks.length) {
    return {
      overallLevel: 'low',
      summary: 'Sin factores de riesgo significativos identificados.',
      recommendations: [],
      topRisks: [],
    };
  }

  const high   = risks.filter(r => r.level === 'high');
  const medium = risks.filter(r => r.level === 'medium');
  const allFactors = risks.flatMap(r => r.factors);

  const recommendations = [];
  if (high.length)   recommendations.push('Consultar con veterinario a la brevedad para evaluación de riesgo alto.');
  if (medium.length) recommendations.push('Programar control preventivo en los próximos 3 meses.');
  if (allFactors.includes('missing_vaccinations'))
    recommendations.push('Actualizar calendario de vacunación.');
  if (allFactors.includes('no_recent_checkup') || allFactors.includes('overdue_checkup'))
    recommendations.push('Realizar chequeo anual de rutina.');
  if (allFactors.includes('obesity') || allFactors.includes('overweight'))
    recommendations.push('Implementar plan de control de peso con dieta y ejercicio supervisados.');

  const summary = `Nivel general: ${overallLevel.toUpperCase()}. ` +
    `${high.length} riesgo(s) alto(s), ${medium.length} riesgo(s) medio(s) detectados.`;

  return { overallLevel, summary, recommendations, topRisks: high.concat(medium).slice(0, 3) };
}

module.exports = { computeRiskScores, summarizeRisks, BREED_RISKS };
