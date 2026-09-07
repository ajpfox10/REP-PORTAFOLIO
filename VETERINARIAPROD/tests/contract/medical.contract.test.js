'use strict';

const request = require('supertest');

jest.mock('../../shared/db', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
  transaction: jest.fn(),
  callProc: jest.fn(),
  queryGrouped: jest.fn(),
  placeholders: jest.fn(arr => arr.map(() => '?').join(',')),
}));

jest.mock('../../shared/internalAuth', () => ({
  requireInternalSig: (_req, _res, next) => next(),
  signRequest: jest.fn(() => ''),
  verifySignature: jest.fn(() => ({ ok: true })),
  HEADER: 'x-internal-sig',
}));

jest.mock('redis', () => {
  const client = {
    connect: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    setEx: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    ping: jest.fn().mockResolvedValue('PONG'),
    quit: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    isReady: true,
  };
  return { createClient: jest.fn(() => client) };
});

const db = require('../../shared/db');
const app = require('../../services/medical/src/index');

const USER_HEADERS = {
  'x-user-id': '1',
  'x-org-id': '10',
  'x-branch-id': '5',
  'x-user-roles': 'org_admin,veterinarian',
  'x-user-email': 'admin@clinic.com',
};

describe('Contract - medical aliases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('maps POST /triage/:id to the appointment triage handler', async () => {
    db.query.mockResolvedValueOnce([{ insertId: 77 }]);

    const res = await request(app)
      .post('/triage/42')
      .set(USER_HEADERS)
      .send({ priority: 'urgent', chiefComplaint: 'Dolor abdominal' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('maps GET /prescriptions/:id to the medical record prescriptions handler', async () => {
    db.query.mockResolvedValueOnce([
      { id: 3, medication_name: 'Amoxicillin', dose: '250mg' },
    ]);

    const res = await request(app)
      .get('/prescriptions/42')
      .set(USER_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0].medication_name).toBe('Amoxicillin');
  });

  it('maps POST /prescriptions/:id and adapts inserts to stricter runtime schemas', async () => {
    const executed = [];
    db.query.mockImplementation((sql) => {
      executed.push(sql);
      if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) {
        return Promise.resolve([
          { TABLE_NAME: 'prescriptions', COLUMN_NAME: 'organization_id' },
          { TABLE_NAME: 'prescriptions', COLUMN_NAME: 'branch_id' },
          { TABLE_NAME: 'prescriptions', COLUMN_NAME: 'refills_used' },
          { TABLE_NAME: 'prescriptions', COLUMN_NAME: 'created_at' },
          { TABLE_NAME: 'prescriptions', COLUMN_NAME: 'updated_at' },
          { TABLE_NAME: 'prescription_items', COLUMN_NAME: 'organization_id' },
          { TABLE_NAME: 'prescription_items', COLUMN_NAME: 'branch_id' },
        ]);
      }
      if (sql.includes('INSERT INTO prescriptions')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (sql.includes('INSERT INTO prescription_items')) {
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      return Promise.resolve([]);
    });

    const res = await request(app)
      .post('/prescriptions/42')
      .set(USER_HEADERS)
      .send({
        items: [{ medicationName: 'Amoxicillin', dose: '250mg', frequency: 'cada 12h' }],
        notes: 'Test',
        refills: 0,
      });

    expect(res.status).toBe(201);
    expect(executed.find((sql) => sql.includes('INSERT INTO prescriptions'))).toContain('organization_id');
    expect(executed.find((sql) => sql.includes('INSERT INTO prescriptions'))).toContain('branch_id');
    expect(executed.find((sql) => sql.includes('INSERT INTO prescription_items'))).toContain('organization_id');
    expect(executed.find((sql) => sql.includes('INSERT INTO prescription_items'))).toContain('branch_id');
  });

  it('lists appointment types using the live schema-compatible projection', async () => {
    db.query.mockResolvedValueOnce([
      { id: 1, name: 'Consulta', default_duration_minutes: 30, color_hex: '#00AEEF', requires_fasting: 0 },
    ]);

    const res = await request(app)
      .get('/appointments/types')
      .set(USER_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('COALESCE(requires_prep, 0) AS requires_fasting'),
      expect.objectContaining({ orgId: '10', branchId: '5' })
    );
  });
});
