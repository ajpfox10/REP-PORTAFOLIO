'use strict';

jest.mock('../../shared/db');
jest.mock('../../shared/ai', () => ({
  complete: jest.fn().mockResolvedValue(JSON.stringify({
    diagnoses: [
      { name: 'Dermatitis', probability: 0.82, reasoning: 'Coincide con el cuadro', recommended_tests: ['Examen dermatológico'] },
    ],
    urgency: 'urgent',
    disclaimer: 'mock',
  })),
  analyzeImage: jest.fn().mockResolvedValue(JSON.stringify({
    findings: ['Hallazgo mock'],
    assessment: 'Mock',
    severity: 'mild',
    recommendations: ['Control'],
    limitations: 'Mock',
  })),
  PROVIDER: 'mock',
}));
jest.mock('../../shared/schemaEngine', () => ({
  getTableColumns: jest.fn(async (tableName) => {
    const cols = {
      patients: [
        { COLUMN_NAME: 'id' },
        { COLUMN_NAME: 'name' },
        { COLUMN_NAME: 'birthdate' },
        { COLUMN_NAME: 'sex' },
        { COLUMN_NAME: 'weight_kg' },
        { COLUMN_NAME: 'chip_number' },
        { COLUMN_NAME: 'body_condition_score' },
        { COLUMN_NAME: 'organization_id' },
        { COLUMN_NAME: 'species_id' },
        { COLUMN_NAME: 'breed_id' },
      ],
      medical_records: [
        { COLUMN_NAME: 'id' },
        { COLUMN_NAME: 'patient_id' },
        { COLUMN_NAME: 'created_at' },
        { COLUMN_NAME: 'chief_complaint' },
        { COLUMN_NAME: 'notes' },
      ],
      diagnoses: [
        { COLUMN_NAME: 'medical_record_id' },
        { COLUMN_NAME: 'diagnosis_name' },
        { COLUMN_NAME: 'is_primary' },
      ],
    };
    return cols[tableName] || [];
  }),
}));

const request = require('supertest');
const db = require('../../shared/db');

process.env.INTERNAL_SECRET = '';
process.env.NODE_ENV = 'test';

const { buildApp } = require('../../services/ai/src/index');

const AUTH = {
  'X-User-Id': '7',
  'X-Org-Id': '3',
  'X-Branch-Id': '11',
  'X-User-Roles': 'veterinarian',
};

let app;

beforeAll(() => {
  app = buildApp();
});

beforeEach(() => {
  jest.clearAllMocks();
  db.queryOne.mockImplementation((sql) => {
    if (sql.includes('FROM patients p') && sql.includes('organization_id = :org')) {
      return Promise.resolve({
        id: 10,
        name: 'Luna',
        birthdate: '2020-01-01',
        sex: 'female',
        weight: 12,
        chip_number: 'CH-1',
        body_condition_score: 4,
        species: 'Canino',
        breed: 'Labrador',
      });
    }
    if (sql.includes('MAX(created_at) AS lastCheckup')) {
      return Promise.resolve({ lastCheckup: '2026-03-01T00:00:00.000Z' });
    }
    return Promise.resolve(null);
  });

  db.query.mockImplementation((sql) => {
    if (sql.includes('GROUP_CONCAT(DISTINCT d.diagnosis_name')) {
      return Promise.resolve([
        {
          created_at: new Date('2026-04-01T00:00:00.000Z'),
          chief_complaint: 'Picazón',
          notes: 'Sin fiebre',
          diagnoses: 'Dermatitis',
        },
      ]);
    }
    if (sql.includes('FROM vaccinations')) {
      return Promise.resolve([{ overdueCount: 1 }]);
    }
    if (sql.includes('SELECT DISTINCT d.diagnosis_name AS diagnosis')) {
      return Promise.resolve([{ diagnosis: 'Dermatitis' }]);
    }
    if (sql.includes('INSERT INTO ai_diagnosis_suggestions')) {
      return Promise.resolve([{ insertId: 101 }]);
    }
    if (sql.includes('INSERT INTO ai_risk_assessments')) {
      return Promise.resolve([{ insertId: 202 }]);
    }
    return Promise.resolve([]);
  });
});

describe('AI service', () => {
  test('POST /ai/diagnosis uses real schema columns and org isolation', async () => {
    const res = await request(app)
      .post('/ai/diagnosis')
      .set(AUTH)
      .send({ patientId: 10, symptoms: ['prurito'], anamnesis: 'Inicio agudo' });

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(101);
    expect(res.body.data.urgency).toBe('urgent');
    expect(db.queryOne).toHaveBeenCalledWith(expect.stringContaining('p.weight_kg AS weight'), expect.any(Object));
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('mr.chief_complaint'), expect.any(Object));
    expect(db.query).not.toHaveBeenCalledWith(expect.stringContaining('mr.diagnosis'), expect.anything());
  });

  test('GET /ai/patients/:patientId/risk uses weight_kg and diagnosis history', async () => {
    const res = await request(app).get('/ai/patients/10/risk').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data.overallLevel).toBeDefined();
    expect(db.queryOne).toHaveBeenCalledWith(expect.stringContaining('p.weight_kg AS weight'), expect.any(Object));
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('SELECT DISTINCT d.diagnosis_name AS diagnosis'), expect.any(Object));
  });
});
