'use strict';

jest.mock('../../shared/db');
jest.mock('../../shared/internalAuth', () => ({
  requireInternalSig: (_req, _res, next) => next(),
  signRequest: jest.fn(() => ''),
  verifySignature: jest.fn(() => ({ ok: true })),
  HEADER: 'x-internal-sig',
}));
jest.mock('../../shared/cache', () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  invalidatePrefix: jest.fn().mockResolvedValue(undefined),
  remember: jest.fn((_key, fn) => fn()),
  cacheMiddleware: jest.fn(() => (_req, _res, next) => next()),
  httpCacheHeaders: jest.fn(() => (_req, _res, next) => next()),
  getClient: jest.fn().mockResolvedValue({
    ping: jest.fn().mockResolvedValue('PONG'),
    quit: jest.fn().mockResolvedValue(undefined),
  }),
}));

const request = require('supertest');
const db = require('../../shared/db');

process.env.INTERNAL_SECRET = '';
process.env.NODE_ENV = 'test';

const app = require('../../services/medical/src/index');

const AUTH = {
  'x-user-id': '1',
  'x-org-id': '10',
  'x-branch-id': '5',
  'x-user-roles': 'org_admin,veterinarian',
  'x-user-email': 'admin@clinic.com',
};

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockReset();
  db.queryOne.mockReset();
  db.transaction.mockImplementation(async (callback) => callback({
    query: db.query,
    queryOne: db.queryOne,
  }));
});

describe('medical service', () => {
  test('POST /medical-records creates walk-in appointment and record with base schema columns only', async () => {
    db.queryOne
      .mockResolvedValueOnce({ id: 1, branch_id: 5 })
      .mockResolvedValueOnce({ id: 77 });

    const executed = [];
    db.query.mockImplementation((sql) => {
      executed.push(sql);
      if (sql.includes('INSERT INTO appointments')) {
        return Promise.resolve([{ insertId: 555 }]);
      }
      if (sql.includes('INSERT INTO medical_records')) {
        return Promise.resolve([{ insertId: 777 }]);
      }
      return Promise.resolve([]);
    });

    const res = await request(app)
      .post('/medical-records')
      .set(AUTH)
      .send({
        patientId: 77,
        chiefComplaint: 'Dolor abdominal',
        weightKg: 12.3,
        bodyConditionScore: 4,
        temperatureC: 38.7,
      });

    expect(res.status).toBe(201);
    expect(executed.some(sql => sql.includes('client_id'))).toBe(false);
    expect(executed.some(sql => sql.includes('veterinarian_id'))).toBe(false);
    expect(executed.some(sql => sql.includes('appointment_date'))).toBe(false);
    expect(executed.some(sql => sql.includes('reason_for_visit'))).toBe(false);
    expect(executed.some(sql => sql.includes('visit_date'))).toBe(false);
    expect(executed.find(sql => sql.includes('INSERT INTO appointments'))).toContain('scheduled_date');
    expect(executed.find(sql => sql.includes('INSERT INTO medical_records'))).toContain('chief_complaint');
    const patientLookup = db.queryOne.mock.calls.find(([sql]) => sql.includes('FROM patients WHERE'));
    expect(patientLookup[0]).not.toContain('branch_id');
  });

  test('POST /medical-records/:id/sign updates medical record directly without SP', async () => {
    db.queryOne.mockResolvedValueOnce({
      id: 321,
      status: 'open',
      signed_at: null,
      organization_id: 10,
      branch_id: 5,
    });
    const executed = [];
    db.query.mockImplementation((sql) => {
      executed.push(sql);
      if (sql.includes('UPDATE medical_records')) {
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      return Promise.resolve([]);
    });

    const res = await request(app)
      .post('/medical-records/321/sign')
      .set(AUTH);

    expect(res.status).toBe(200);
    expect(executed[0]).toContain('UPDATE medical_records');
    expect(executed[0]).not.toContain('sp_sign_medical_record');
    expect(executed[0]).toContain('signed_at = NOW()');
    expect(executed[0]).toContain('signed_by = :uid');
  });

  test('POST /prescriptions/:id rejects incomplete prescription items before touching DB', async () => {
    const res = await request(app)
      .post('/prescriptions/321')
      .set(AUTH)
      .send({
        items: [
          { dose: '5 mg', frequency: 'cada 12 horas' },
        ],
      });

    expect(res.status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('POST /appointments rejects patient or vet outside the organization', async () => {
    db.queryOne.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/appointments')
      .set(AUTH)
      .send({
        patientId: 77,
        vetId: 99,
        scheduledDate: '2026-07-01T12:00:00.000Z',
      });

    expect(res.status).toBe(404);
    expect(db.query).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO appointments'), expect.anything());
  });

  test('POST /appointments rejects overlapping appointments', async () => {
    db.queryOne
      .mockResolvedValueOnce({ patient_id: 77, patient_org_id: 10, vet_id: 99, vet_branch_id: 5 })
      .mockResolvedValueOnce({ id: 123 });

    const res = await request(app)
      .post('/appointments')
      .set(AUTH)
      .send({
        patientId: 77,
        vetId: 99,
        scheduledDate: '2026-07-01T12:00:00.000Z',
      });

    expect(res.status).toBe(409);
    expect(db.query).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO appointments'), expect.anything());
  });

  test('POST /appointments/:id/triage rejects an appointment outside the tenant', async () => {
    db.queryOne.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/appointments/999/triage')
      .set(AUTH)
      .send({ priority: 'urgent', chiefComplaint: 'Dificultad respiratoria' });

    expect(res.status).toBe(404);
    expect(db.query).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO emergency_triage'), expect.anything());
  });
});
