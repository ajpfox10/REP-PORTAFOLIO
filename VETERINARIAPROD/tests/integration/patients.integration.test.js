'use strict';

jest.mock('../../shared/db');
jest.mock('../../shared/cache', () => ({
  cacheMiddleware: () => (_req, _res, next) => next(),
  httpCacheHeaders: () => (_req, _res, next) => next(),
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
}));

const request = require('supertest');
const express = require('express');
const db = require('../../shared/db');

const SCHEMA_ROWS = [
  { TABLE_NAME: 'patients', COLUMN_NAME: 'organization_id' },
  { TABLE_NAME: 'patients', COLUMN_NAME: 'branch_id' },
  { TABLE_NAME: 'patients', COLUMN_NAME: 'is_active' },
  { TABLE_NAME: 'patients', COLUMN_NAME: 'chip_number' },
  { TABLE_NAME: 'patients', COLUMN_NAME: 'microchip_number' },
  { TABLE_NAME: 'patients', COLUMN_NAME: 'birthdate' },
  { TABLE_NAME: 'patients', COLUMN_NAME: 'birth_date' },
  { TABLE_NAME: 'patients', COLUMN_NAME: 'coat_color_id' },
  { TABLE_NAME: 'patients', COLUMN_NAME: 'breed_id' },
  { TABLE_NAME: 'patients', COLUMN_NAME: 'sex' },
  { TABLE_NAME: 'patients', COLUMN_NAME: 'weight_kg' },
  { TABLE_NAME: 'patients', COLUMN_NAME: 'photo_url' },
  { TABLE_NAME: 'patients', COLUMN_NAME: 'notes' },
  { TABLE_NAME: 'clients', COLUMN_NAME: 'branch_id' },
  { TABLE_NAME: 'clients', COLUMN_NAME: 'organization_id' },
  { TABLE_NAME: 'clients', COLUMN_NAME: 'phone' },
  { TABLE_NAME: 'clients', COLUMN_NAME: 'is_active' },
  { TABLE_NAME: 'patient_owners', COLUMN_NAME: 'ownership_type' },
  { TABLE_NAME: 'patient_owners', COLUMN_NAME: 'active' },
  { TABLE_NAME: 'appointments', COLUMN_NAME: 'patient_id' },
  { TABLE_NAME: 'medical_records', COLUMN_NAME: 'patient_id' },
];

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      userId: parseInt(req.headers['x-user-id'] || '1', 10),
      orgId: parseInt(req.headers['x-org-id'] || '5', 10),
      branchId: parseInt(req.headers['x-branch-id'] || '10', 10),
      roles: (req.headers['x-user-roles'] || 'veterinarian').split(','),
    };
    next();
  });
  app.use('/patients', require('../../services/patients/src/routes/patients.routes'));
  app.use('/clients', require('../../services/patients/src/routes/clients.routes'));
  app.use((err, _req, res, _next) => {
    res.status(500).json({ success: false, error: { message: err.message } });
  });
  return app;
}

const AUTH = {
  'X-User-Id': '1',
  'X-Org-Id': '5',
  'X-Branch-Id': '10',
  'X-User-Roles': 'veterinarian',
};

let app;
beforeAll(() => { app = buildApp(); });
beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockImplementation((sql) => {
    if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) return Promise.resolve(SCHEMA_ROWS);
    return Promise.resolve([]);
  });
});

describe('GET /patients', () => {
  test('200 - returns paginated list', async () => {
    db.query.mockImplementation((sql) => {
      if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) return Promise.resolve(SCHEMA_ROWS);
      if (sql.includes('COUNT(DISTINCT p.id)')) return Promise.resolve([{ total: 2 }]);
      return Promise.resolve([
        { id: 1, name: 'Fido', species: 'Dog', is_active: true },
        { id: 2, name: 'Miau', species: 'Cat', is_active: true },
      ]);
    });

    const res = await request(app).get('/patients').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta.total).toBe(2);
  });

  test('200 - accepts default pagination with limit only', async () => {
    db.query.mockImplementation((sql, params) => {
      if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) return Promise.resolve(SCHEMA_ROWS);
      if (sql.includes('COUNT(DISTINCT p.id)')) return Promise.resolve([{ total: 0 }]);
      expect(params.limit).toBe(1);
      expect(params.offset).toBe(0);
      return Promise.resolve([]);
    });

    const res = await request(app).get('/patients?limit=1').set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.meta.page).toBe(1);
    expect(res.body.meta.limit).toBe(1);
  });

  test('200 - accepts query string page and limit', async () => {
    db.query.mockImplementation((sql, params) => {
      if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) return Promise.resolve(SCHEMA_ROWS);
      if (sql.includes('COUNT(DISTINCT p.id)')) return Promise.resolve([{ total: 1 }]);
      expect(params.limit).toBe(12);
      expect(params.offset).toBe(0);
      return Promise.resolve([{ id: 1, name: 'Fido' }]);
    });

    const res = await request(app).get('/patients?page=1&limit=12').set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.meta.limit).toBe(12);
  });

  test('200 - accepts search with limit only', async () => {
    db.query.mockImplementation((sql, params) => {
      if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) return Promise.resolve(SCHEMA_ROWS);
      if (sql.includes('COUNT(DISTINCT p.id)')) return Promise.resolve([{ total: 0 }]);
      expect(params.s).toBe('%test%');
      expect(params.limit).toBe(1);
      return Promise.resolve([]);
    });

    const res = await request(app).get('/patients?search=test&limit=1').set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

describe('GET /patients/:id', () => {
  test('200 - returns patient with owners, allergies, conditions', async () => {
    db.queryOne
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce({ id: 1, name: 'Fido', organization_id: 5 });
    db.query
      .mockImplementationOnce((sql) => {
        expect(sql).toContain('SELECT cl.id');
        return Promise.resolve([{ id: 99, first_name: 'Owner', ownership_type: 'primary' }]);
      })
      .mockImplementationOnce(() => Promise.resolve([]))
      .mockImplementationOnce(() => Promise.resolve([]));

    const res = await request(app).get('/patients/1').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Fido');
    expect(res.body.data.owners).toHaveLength(1);
  });
});

describe('GET /patients/:id/timeline', () => {
  test('200 - builds timeline from direct queries', async () => {
    db.queryOne.mockResolvedValueOnce({ id: 1 });
    db.query.mockImplementation((sql) => {
      if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) return Promise.resolve(SCHEMA_ROWS);
      if (sql.includes('FROM appointments')) return Promise.resolve([{ id: 10, event_at: '2026-04-01T10:00:00Z', title: 'Checkup' }]);
      if (sql.includes('FROM medical_records')) return Promise.resolve([{ id: 20, event_at: '2026-04-02T10:00:00Z', title: 'Medical record' }]);
      return Promise.resolve([]);
    });

    const res = await request(app).get('/patients/1/timeline').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].type).toBe('medical_record');
  });

  test('200 - timeline degrades gracefully when one optional source query fails', async () => {
    db.queryOne.mockResolvedValueOnce({ id: 1 });
    db.query.mockImplementation((sql) => {
      if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) {
        return Promise.resolve([
          ...SCHEMA_ROWS,
          { TABLE_NAME: 'tele_sessions', COLUMN_NAME: 'patient_id' },
          { TABLE_NAME: 'tele_sessions', COLUMN_NAME: 'scheduled_at' },
          { TABLE_NAME: 'tele_sessions', COLUMN_NAME: 'reason' },
        ]);
      }
      if (sql.includes('FROM appointments')) return Promise.resolve([{ id: 10, event_at: '2026-04-01T10:00:00Z', title: 'Checkup' }]);
      if (sql.includes('FROM medical_records')) return Promise.resolve([{ id: 20, event_at: '2026-04-02T10:00:00Z', title: 'Medical record' }]);
      if (sql.includes('FROM tele_sessions')) return Promise.reject(new Error('tele source failed'));
      return Promise.resolve([]);
    });

    const res = await request(app).get('/patients/1/timeline').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });
});

describe('POST /patients', () => {
  test('201 - creates patient with organization and owner link', async () => {
    const mockConn = {
      queryOne: jest.fn().mockResolvedValue({ id: 99 }),
      query: jest.fn()
        .mockResolvedValueOnce([{ insertId: 42 }])
        .mockResolvedValueOnce([{ affectedRows: 1 }]),
    };
    db.transaction.mockImplementationOnce((fn) => fn(mockConn));

    const res = await request(app).post('/patients').set(AUTH).send({
      name: 'Rex',
      speciesId: 1,
      primaryOwnerId: 99,
      sex: 'male',
    });

    expect(res.status).toBe(201);
    expect(mockConn.queryOne).toHaveBeenCalled();
    expect(mockConn.query.mock.calls[0][0]).toMatch(/organization_id/);
  });
});

describe('PUT /patients/:id', () => {
  test('204 - updates canonical and legacy-compatible fields', async () => {
    db.queryOne.mockResolvedValueOnce({ id: 1 });
    db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

    const res = await request(app)
      .put('/patients/1')
      .set(AUTH)
      .send({ name: 'Rex Renamed', microchipNumber: 'abc', birthDate: '2020-01-01' });

    expect(res.status).toBe(204);
    const [sql] = db.query.mock.calls[0];
    expect(sql).toMatch(/microchip_number/);
    expect(sql).toMatch(/birth_date/);
  });
});

describe('Owners and reference endpoints', () => {
  test('GET /patients/:id/owners returns owners', async () => {
    db.queryOne.mockResolvedValueOnce({ id: 1 });
    db.query.mockResolvedValueOnce([{ id: 99, first_name: 'Owner' }]);

    const res = await request(app).get('/patients/1/owners').set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  test('POST /patients/:id/owners performs transactional upsert', async () => {
    const mockConn = {
      queryOne: jest.fn()
        .mockResolvedValueOnce(null),
      query: jest.fn().mockResolvedValue([{ affectedRows: 1 }]),
    };
    db.queryOne
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce({ id: 99 });
    db.transaction.mockImplementationOnce((fn) => fn(mockConn));

    const res = await request(app)
      .post('/patients/1/owners')
      .set(AUTH)
      .send({ clientId: 99, ownershipType: 'secondary' });

    expect(res.status).toBe(201);
    expect(mockConn.query).toHaveBeenCalled();
  });

  test('GET /patients/species/all returns species list', async () => {
    db.query.mockResolvedValueOnce([
      { id: 1, common_name: 'Dog', category: 'Mammals' },
      { id: 2, common_name: 'Cat', category: 'Mammals' },
    ]);

    const res = await request(app).get('/patients/species/all').set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });
});

describe('Clients', () => {
  test('POST /clients stores branch and organization', async () => {
    db.query
      .mockImplementationOnce((sql) => {
        expect(sql).toContain('INFORMATION_SCHEMA.COLUMNS');
        return Promise.resolve(SCHEMA_ROWS);
      })
      .mockImplementationOnce((sql) => {
        expect(sql).toMatch(/branch_id/);
        expect(sql).toMatch(/organization_id/);
        return Promise.resolve([{ insertId: 500 }]);
      });

    const res = await request(app).post('/clients').set(AUTH).send({
      firstName: 'Jane',
      lastName: 'Doe',
      phone: '+5491111111111',
      email: 'jane@example.com',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(500);
  });
});
