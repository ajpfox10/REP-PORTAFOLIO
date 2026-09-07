'use strict';

/**
 * tests/unit/ai.test.js
 * Tests para:
 *   - shared/ai.js          — adaptador IA (mock provider)
 *   - shared/riskEngine.js  — motor de riesgo clínico (lógica pura)
 */

// Usar proveedor mock para evitar llamadas reales a APIs
process.env.AI_PROVIDER = 'mock';

const ai     = require('../../shared/ai');
const { computeRiskScores, summarizeRisks, BREED_RISKS } = require('../../shared/riskEngine');

// ─── Helpers de fecha ─────────────────────────────────────────────────────────

function yearsAgo(n) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - n);
  return d.toISOString();
}

function monthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString();
}

// ─── Tests: shared/ai.js ──────────────────────────────────────────────────────

describe('shared/ai — adaptador mock', () => {
  test('PROVIDER coincide con la variable de entorno', () => {
    expect(ai.PROVIDER).toBe('mock');
  });

  test('complete() devuelve string no vacío', async () => {
    const result = await ai.complete([
      { role: 'user', content: 'Hola' },
    ]);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  test('complete() incluye el contenido del mensaje en la respuesta mock', async () => {
    const result = await ai.complete([
      { role: 'user', content: 'diagnóstico de parvo' },
    ]);
    expect(result).toContain('diagnóstico de parvo');
  });

  test('complete() con opts.json devuelve JSON parseable', async () => {
    const result = await ai.complete(
      [{ role: 'user', content: 'lista de diagnósticos' }],
      { json: true }
    );
    expect(() => JSON.parse(result)).not.toThrow();
    const parsed = JSON.parse(result);
    expect(parsed.mock).toBe(true);
  });

  test('complete() con múltiples mensajes usa el último', async () => {
    const result = await ai.complete([
      { role: 'system',    content: 'Sos un veterinario' },
      { role: 'user',      content: 'Primer mensaje' },
      { role: 'assistant', content: 'Respuesta anterior' },
      { role: 'user',      content: 'Segundo mensaje final' },
    ]);
    expect(result).toContain('Segundo mensaje final');
  });

  test('analyzeImage() devuelve string con el prompt', async () => {
    const result = await ai.analyzeImage('base64data...', 'Analizá esta radiografía');
    expect(result).toContain('Analizá esta radiografía');
  });

  test('analyzeImage() con URL también funciona', async () => {
    const result = await ai.analyzeImage('https://example.com/img.jpg', 'Descripción');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  test('embedText() devuelve array de 1536 dimensiones', async () => {
    const vec = await ai.embedText('texto de prueba');
    expect(Array.isArray(vec)).toBe(true);
    expect(vec).toHaveLength(1536);
  });

  test('embedText() dim[0] varía según la longitud del texto', async () => {
    const v1 = await ai.embedText('a');
    const v2 = await ai.embedText('a'.repeat(500));
    expect(v1[0]).not.toBe(v2[0]);
  });

  test('proveedor desconocido lanza UNKNOWN_PROVIDER', () => {
    const { adapters } = ai;
    expect(adapters['nonexistent']).toBeUndefined();
    // Simular el error del getAdapter
    const origProvider = process.env.AI_PROVIDER;
    process.env.AI_PROVIDER = 'nonexistent_xyz';
    // Re-require con módulo limpio para probar el error
    jest.isolateModules(() => {
      const aiIsolated = require('../../shared/ai');
      expect(() => {
        // Forzar llamada a getAdapter interno
        return aiIsolated.complete([{ role: 'user', content: 'test' }]);
      }).rejects.toMatchObject({ code: 'UNKNOWN_PROVIDER' });
    });
    process.env.AI_PROVIDER = origProvider;
  });

  test('adapters tiene los tres proveedores esperados', () => {
    expect(ai.adapters).toHaveProperty('openai');
    expect(ai.adapters).toHaveProperty('anthropic');
    expect(ai.adapters).toHaveProperty('mock');
  });
});

// ─── Tests: riskEngine — computeRiskScores ────────────────────────────────────

describe('riskEngine — edad', () => {
  test('perro senior (7-10 años) → chronic_disease low', () => {
    const result = computeRiskScores({ birthdate: yearsAgo(8), species: 'canino' });
    const cond = result.risks.find(r => r.condition === 'chronic_disease');
    expect(cond).toBeDefined();
    expect(cond.factors).toContain('age_senior');
  });

  test('perro geriátrico (>11 años) → chronic_disease + organ_failure', () => {
    const result = computeRiskScores({ birthdate: yearsAgo(13), species: 'canino' });
    const conditions = result.risks.map(r => r.condition);
    expect(conditions).toContain('chronic_disease');
    expect(conditions).toContain('organ_failure');
    expect(conditions).toContain('dental');
  });

  test('gato senior (>10 años) → age_senior', () => {
    const result = computeRiskScores({ birthdate: yearsAgo(11), species: 'felino' });
    const cond = result.risks.find(r => r.condition === 'chronic_disease');
    expect(cond).toBeDefined();
    expect(cond.factors).toContain('age_senior');
  });

  test('gato geriátrico (>15 años) → age_geriatric', () => {
    const result = computeRiskScores({ birthdate: yearsAgo(16), species: 'gato' });
    const cond = result.risks.find(r => r.condition === 'organ_failure');
    expect(cond).toBeDefined();
    expect(cond.factors).toContain('age_geriatric');
  });

  test('paciente joven (2 años) → sin riesgo por edad', () => {
    const result = computeRiskScores({ birthdate: yearsAgo(2), species: 'canino' });
    const ageConds = result.risks.filter(r =>
      r.factors.some(f => f.startsWith('age_'))
    );
    expect(ageConds).toHaveLength(0);
  });

  test('sin birthdate → no genera riesgos por edad', () => {
    const result = computeRiskScores({ birthdate: null, species: 'canino' });
    const ageConds = result.risks.filter(r => r.factors.some(f => f.startsWith('age_')));
    expect(ageConds).toHaveLength(0);
  });
});

describe('riskEngine — peso', () => {
  test('obesidad (ratio ≥ 1.5) → diabetes + cardiovascular + joint_disease', () => {
    const result = computeRiskScores({ weight: 15, ideal_weight: 10 });
    const conditions = result.risks.map(r => r.condition);
    expect(conditions).toContain('diabetes');
    expect(conditions).toContain('cardiovascular');
    expect(conditions).toContain('joint_disease');
    expect(result.risks.find(r => r.condition === 'diabetes').factors).toContain('obesity');
  });

  test('sobrepeso (ratio 1.2-1.49) → diabetes + cardiovascular (scores menores)', () => {
    const result = computeRiskScores({ weight: 12, ideal_weight: 10 });
    const diab = result.risks.find(r => r.condition === 'diabetes');
    expect(diab).toBeDefined();
    expect(diab.factors).toContain('overweight');
    expect(diab.score).toBeLessThan(0.35);   // score menor que obesidad
  });

  test('bajo peso (ratio ≤ 0.8) → nutritional risk', () => {
    const result = computeRiskScores({ weight: 7, ideal_weight: 10 });
    const cond = result.risks.find(r => r.condition === 'nutritional');
    expect(cond).toBeDefined();
    expect(cond.factors).toContain('underweight');
  });

  test('peso normal (ratio 1.0) → sin riesgo por peso', () => {
    const result = computeRiskScores({ weight: 10, ideal_weight: 10 });
    const weightConds = result.risks.filter(r =>
      r.factors.some(f => ['obesity','overweight','underweight'].includes(f))
    );
    expect(weightConds).toHaveLength(0);
  });

  test('sin ideal_weight → no se evalúa el peso', () => {
    const result = computeRiskScores({ weight: 50 });
    const weightConds = result.risks.filter(r =>
      r.factors.some(f => ['obesity','overweight','underweight'].includes(f))
    );
    expect(weightConds).toHaveLength(0);
  });
});

describe('riskEngine — vacunas y controles', () => {
  test('1 vacuna vencida → infectious_disease low', () => {
    const result = computeRiskScores({}, { overdueVaccinations: 1 });
    const cond = result.risks.find(r => r.condition === 'infectious_disease');
    expect(cond).toBeDefined();
    expect(cond.score).toBeCloseTo(0.20);
  });

  test('3 vacunas vencidas → infectious_disease score acumulado (≤ 0.60)', () => {
    const result = computeRiskScores({}, { overdueVaccinations: 3 });
    const cond = result.risks.find(r => r.condition === 'infectious_disease');
    expect(cond.score).toBeCloseTo(0.60);
  });

  test('sin checkup en > 24 meses → undetected_disease high score', () => {
    const result = computeRiskScores({}, { lastCheckup: yearsAgo(3) });
    const cond = result.risks.find(r => r.condition === 'undetected_disease');
    expect(cond).toBeDefined();
    expect(cond.score).toBeCloseTo(0.30);
  });

  test('checkup hace 15 meses → undetected_disease low score', () => {
    const result = computeRiskScores({}, { lastCheckup: monthsAgo(15) });
    const cond = result.risks.find(r => r.condition === 'undetected_disease');
    expect(cond).toBeDefined();
    expect(cond.score).toBeCloseTo(0.15);
  });

  test('checkup reciente (6 meses) → sin riesgo por control', () => {
    const result = computeRiskScores({}, { lastCheckup: monthsAgo(6) });
    const cond = result.risks.find(r => r.condition === 'undetected_disease');
    expect(cond).toBeUndefined();
  });

  test('lastCheckup null → misma penalización que sin checkup', () => {
    const r1 = computeRiskScores({}, { lastCheckup: null });
    const r2 = computeRiskScores({}, {});
    const s1 = r1.risks.find(r => r.condition === 'undetected_disease')?.score;
    const s2 = r2.risks.find(r => r.condition === 'undetected_disease')?.score;
    expect(s1).toBe(s2);
  });
});

describe('riskEngine — condiciones crónicas', () => {
  test('diabetes → cardiovascular + renal', () => {
    const result = computeRiskScores({}, { chronicConditions: ['Diabetes mellitus tipo 1'] });
    const conditions = result.risks.map(r => r.condition);
    expect(conditions).toContain('cardiovascular');
    expect(conditions).toContain('renal');
  });

  test('cardiomiopatía → cardiovascular', () => {
    const result = computeRiskScores({}, { chronicConditions: ['Cardiomiopatía hipertrófica'] });
    const cond = result.risks.find(r => r.condition === 'cardiovascular');
    expect(cond).toBeDefined();
    expect(cond.factors).toContain('existing_cardiac');
  });

  test('enfermedad renal → renal score alto', () => {
    const result = computeRiskScores({}, { chronicConditions: ['Insuficiencia renal crónica'] });
    const cond = result.risks.find(r => r.condition === 'renal');
    expect(cond).toBeDefined();
    expect(cond.score).toBeGreaterThanOrEqual(0.35);
  });

  test('tumor → cancer', () => {
    const result = computeRiskScores({}, { chronicConditions: ['Tumor mamario', 'Neoplasia linfoide'] });
    const cond = result.risks.find(r => r.condition === 'cancer');
    expect(cond).toBeDefined();
    expect(cond.score).toBeGreaterThanOrEqual(0.40);
  });

  test('condición no reconocida → no agrega riesgo', () => {
    const r1 = computeRiskScores({});
    const r2 = computeRiskScores({}, { chronicConditions: ['Alergia a pulgas'] });
    expect(r1.risks).toHaveLength(r2.risks.length);
  });
});

describe('riskEngine — predisposición por raza', () => {
  test('golden retriever → cancer high', () => {
    const result = computeRiskScores({ breed: 'Golden Retriever' });
    const cond = result.risks.find(r => r.condition === 'cancer');
    expect(cond).toBeDefined();
    expect(cond.score).toBeGreaterThanOrEqual(0.45);
    expect(cond.factors).toContain('breed_predisposition');
  });

  test('bulldog → respiratory high (brachycephalic)', () => {
    const result = computeRiskScores({ breed: 'Bulldog' });
    const cond = result.risks.find(r => r.condition === 'respiratory');
    expect(cond).toBeDefined();
    expect(cond.score).toBeGreaterThanOrEqual(0.50);
    expect(cond.factors).toContain('brachycephalic_syndrome');
  });

  test('french bulldog → respiratory + spinal', () => {
    const result = computeRiskScores({ breed: 'French Bulldog' });
    const conditions = result.risks.map(r => r.condition);
    expect(conditions).toContain('respiratory');
    expect(conditions).toContain('spinal');
  });

  test('doberman → cardiac (dilated_cardiomyopathy)', () => {
    const result = computeRiskScores({ breed: 'Doberman' });
    const cond = result.risks.find(r => r.condition === 'cardiac');
    expect(cond).toBeDefined();
    expect(cond.factors).toContain('dilated_cardiomyopathy');
  });

  test('maine coon → cardiac (hypertrophic_cardiomyopathy)', () => {
    const result = computeRiskScores({ breed: 'Maine Coon', species: 'felino' });
    const cond = result.risks.find(r => r.condition === 'cardiac');
    expect(cond).toBeDefined();
    expect(cond.score).toBeGreaterThanOrEqual(0.45);
  });

  test('persian → renal (polycystic_kidney)', () => {
    const result = computeRiskScores({ breed: 'Persian', species: 'felino' });
    const cond = result.risks.find(r => r.condition === 'renal');
    expect(cond).toBeDefined();
    expect(cond.factors).toContain('polycystic_kidney');
  });

  test('raza desconocida → sin riesgo por raza', () => {
    const result = computeRiskScores({ breed: 'Raza Inexistente XYZ' });
    const breedConds = result.risks.filter(r =>
      r.factors.some(f => f.includes('breed') || f.includes('chondro') || f.includes('brachycephalic'))
    );
    expect(breedConds).toHaveLength(0);
  });

  test('BREED_RISKS cubre al menos 10 razas', () => {
    expect(Object.keys(BREED_RISKS).length).toBeGreaterThanOrEqual(10);
  });
});

describe('riskEngine — nivel de riesgo y ordenamiento', () => {
  test('riesgos ordenados por score descendente', () => {
    const result = computeRiskScores(
      { weight: 18, ideal_weight: 10, breed: 'Golden Retriever' },  // obesidad + breed
      { overdueVaccinations: 2, lastCheckup: null }
    );
    for (let i = 0; i < result.risks.length - 1; i++) {
      expect(result.risks[i].score).toBeGreaterThanOrEqual(result.risks[i + 1].score);
    }
  });

  test('nivel high cuando score >= 0.60', () => {
    const result = computeRiskScores({ breed: 'Bulldog' });   // respiratory = 0.50 + cardiac = 0.30
    const resp = result.risks.find(r => r.condition === 'respiratory');
    expect(resp.level).toBe('medium');   // 0.50 < 0.60
  });

  test('nivel medium para french bulldog respiratory (0.55)', () => {
    const result = computeRiskScores({ breed: 'French Bulldog', species: 'canino' });
    const resp = result.risks.find(r => r.condition === 'respiratory');
    expect(resp).toBeDefined();
    expect(resp.score).toBe(0.55);
    expect(resp.level).toBe('medium');   // 0.55 < 0.60 → medium
  });

  test('nivel high para infectious_disease con 3 vacunas vencidas', () => {
    const result = computeRiskScores({}, { overdueVaccinations: 3, lastCheckup: monthsAgo(3) });
    const inf = result.risks.find(r => r.condition === 'infectious_disease');
    expect(inf).toBeDefined();
    expect(inf.score).toBeGreaterThanOrEqual(0.60);
    expect(inf.level).toBe('high');
  });

  test('overallLevel refleja el mayor riesgo', () => {
    const resultHigh = computeRiskScores(
      { breed: 'French Bulldog', birthdate: yearsAgo(8) },
      { overdueVaccinations: 3 }
    );
    expect(['medium','high']).toContain(resultHigh.overallLevel);
  });

  test('sin factores → overallLevel low, risks vacío', () => {
    // Pasar checkup reciente para evitar penalización por falta de control
    const result = computeRiskScores({}, { lastCheckup: monthsAgo(1) });
    expect(result.overallLevel).toBe('low');
    expect(result.risks).toHaveLength(0);
  });

  test('computedAt es una ISO date válida', () => {
    const result = computeRiskScores({});
    expect(() => new Date(result.computedAt)).not.toThrow();
    expect(new Date(result.computedAt).getFullYear()).toBeGreaterThanOrEqual(2024);
  });

  test('score nunca supera 1.0', () => {
    const result = computeRiskScores(
      { breed: 'French Bulldog', birthdate: yearsAgo(13), weight: 20, ideal_weight: 10 },
      { overdueVaccinations: 10, lastCheckup: null, chronicConditions: ['diabetes','cancer','cardiac'] }
    );
    for (const r of result.risks) {
      expect(r.score).toBeLessThanOrEqual(1.0);
    }
  });
});

describe('riskEngine — summarizeRisks', () => {
  test('sin riesgos → overallLevel low, recomendaciones vacías', () => {
    const result   = computeRiskScores({}, { lastCheckup: monthsAgo(1) });
    const summary  = summarizeRisks(result);
    expect(summary.overallLevel).toBe('low');
    expect(summary.recommendations).toHaveLength(0);
    expect(summary.topRisks).toHaveLength(0);
  });

  test('riesgos high → recomendación de consulta urgente', () => {
    // 3 vacunas vencidas → infectious_disease score=0.60 (high) → triggerea recomendación de consulta
    const result  = computeRiskScores({}, { overdueVaccinations: 3, lastCheckup: monthsAgo(3) });
    const summary = summarizeRisks(result);
    const allRecs = summary.recommendations.join(' ');
    expect(allRecs.toLowerCase()).toMatch(/veterinario|riesgo/);
  });

  test('vacunas vencidas → recomendación de vacunación', () => {
    const result  = computeRiskScores({}, { overdueVaccinations: 2 });
    const summary = summarizeRisks(result);
    const allRecs = summary.recommendations.join(' ').toLowerCase();
    expect(allRecs).toContain('vacunación');
  });

  test('sin checkup → recomendación de chequeo', () => {
    const result  = computeRiskScores({}, { lastCheckup: null });
    const summary = summarizeRisks(result);
    const allRecs = summary.recommendations.join(' ').toLowerCase();
    expect(allRecs).toContain('chequeo');
  });

  test('obesidad → recomendación de control de peso', () => {
    const result  = computeRiskScores({ weight: 20, ideal_weight: 10 });
    const summary = summarizeRisks(result);
    const allRecs = summary.recommendations.join(' ').toLowerCase();
    expect(allRecs).toContain('peso');
  });

  test('summary contiene nivel general', () => {
    const result  = computeRiskScores({ weight: 20, ideal_weight: 10 });
    const summary = summarizeRisks(result);
    expect(summary.summary).toContain(summary.overallLevel.toUpperCase());
  });

  test('topRisks tiene máximo 3 elementos', () => {
    const result  = computeRiskScores(
      { breed: 'Rottweiler', birthdate: yearsAgo(12), weight: 60, ideal_weight: 35 },
      { overdueVaccinations: 2, lastCheckup: null, chronicConditions: ['diabetes','cancer'] }
    );
    const summary = summarizeRisks(result);
    expect(summary.topRisks.length).toBeLessThanOrEqual(3);
  });
});
