'use strict';

jest.mock('../../shared/db');
jest.mock('../../shared/internalAuth', () => ({
  requireInternalSig: (_req, _res, next) => next(),
  signRequest: jest.fn(() => ''),
  verifySignature: jest.fn(() => ({ ok: true })),
  HEADER: 'x-internal-sig',
}));
jest.mock('../../shared/redis', () => ({
  createRedisClient: jest.fn(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    ping: jest.fn().mockResolvedValue('PONG'),
    quit: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    isReady: true,
  })),
  connectRedis: jest.fn().mockResolvedValue(undefined),
}));

const request = require('supertest');
const db = require('../../shared/db');

process.env.INTERNAL_SECRET = '';
process.env.NODE_ENV = 'test';

const app = require('../../services/lab-imaging/src/index');

const AUTH = {
  'x-user-id': '1',
  'x-org-id': '10',
  'x-branch-id': '5',
  'x-user-roles': 'org_admin,veterinarian',
  'x-user-email': 'admin@clinic.com',
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('lab-imaging service', () => {
  test('POST /hospitalizations creates admission without stored procedure', async () => {
    db.transaction.mockImplementation(async (fn) => {
      const conn = {
        query: jest.fn(async (sql) => {
          if (sql.includes('INSERT INTO hospitalizations')) {
            return [{ insertId: 88 }];
          }
          return [{}];
        }),
      };
      return fn(conn);
    });

    const res = await request(app)
      .post('/hospitalizations')
      .set(AUTH)
      .send({
        patientId: 7,
        responsibleVetId: 3,
        hospitalizationReason: 'Observación',
        admissionDiagnosis: 'Gastroenteritis',
        admissionWeight: 12.4,
        estimatedDischargeDate: '2026-05-02',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.hospitalization_reason).toBe('Observación');
    expect(db.callProc).not.toHaveBeenCalled();
  });

  test('PATCH /hospitalizations/:id/discharge updates base columns directly', async () => {
    db.query.mockResolvedValue([{ affectedRows: 1 }]);

    const res = await request(app)
      .patch('/hospitalizations/88/discharge')
      .set(AUTH)
      .send({
        dischargeDate: '2026-05-03T10:00:00.000Z',
        dischargeDiagnosis: 'Mejorado',
        dischargeInstructions: 'Control en 7 días',
        followUpDate: '2026-05-10',
      });

    expect(res.status).toBe(200);
    expect(db.callProc).not.toHaveBeenCalled();
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE hospitalizations'), expect.any(Object));
  });
});
