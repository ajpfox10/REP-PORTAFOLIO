'use strict';

/**
 * Contract tests — Patients service response shapes.
 *
 * Verifies that the patients service returns the exact fields
 * that the frontend and gateway consumers depend on.
 */

const request = require('supertest');

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../../shared/db', () => ({
  query:    jest.fn(),
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
    get:     jest.fn().mockResolvedValue(null),
    set:     jest.fn().mockResolvedValue('OK'),
    setEx:   jest.fn().mockResolvedValue('OK'),
    del:     jest.fn().mockResolvedValue(1),
    ping:    jest.fn().mockResolvedValue('PONG'),
    quit:    jest.fn().mockResolvedValue(undefined),
    on:      jest.fn(),
    isReady: true,
  };
  return { createClient: jest.fn(() => client) };
});

const db  = require('../../shared/db');
const app = require('../../services/patients/src/index');

const USER_HEADERS = {
  'x-user-id':    '1',
  'x-org-id':     '10',
  'x-branch-id':  '5',
  'x-user-roles': 'org_admin',   // org_admin has patients:*, clients:*, etc.
  'x-user-email': 'admin@clinic.com',
};

const LIST_SCHEMA_ROWS = [
  { TABLE_NAME: 'patients', COLUMN_NAME: 'organization_id' },
  { TABLE_NAME: 'patients', COLUMN_NAME: 'is_active' },
  { TABLE_NAME: 'patients', COLUMN_NAME: 'chip_number' },
  { TABLE_NAME: 'patients', COLUMN_NAME: 'tattoo_number' },
  { TABLE_NAME: 'patients', COLUMN_NAME: 'sex' },
  { TABLE_NAME: 'patients', COLUMN_NAME: 'birthdate' },
  { TABLE_NAME: 'patients', COLUMN_NAME: 'coat_color_id' },
  { TABLE_NAME: 'patients', COLUMN_NAME: 'body_condition_score' },
  { TABLE_NAME: 'clients', COLUMN_NAME: 'branch_id' },
  { TABLE_NAME: 'clients', COLUMN_NAME: 'phone' },
  { TABLE_NAME: 'patient_owners', COLUMN_NAME: 'ownership_type' },
];

// ── Contract: GET /patients (list) ────────────────────────────────────────────

describe('Contract — GET /patients', () => {
  const PATIENT_LIST_ITEM_SHAPE = {
    id:            null,
    name:          'string',
    species:       null,  // string or null
    primary_owner: null,
  };

  const PAGINATED_SHAPE = {
    success: 'boolean',
    data:    null,  // array
    meta: {
      total:   null,
      page:    null,
      limit:   null,
    },
  };

  it('paginated response has required shape', async () => {
    db.query.mockImplementation((sql) => {
      if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) return Promise.resolve(LIST_SCHEMA_ROWS);
      if (sql.includes('COUNT')) return Promise.resolve([{ total: 2 }]);
      return Promise.resolve([
        { id: 1, name: 'Buddy', species: 'Dog', primary_owner: 'John Doe', owner_id: 5, is_active: 1 },
        { id: 2, name: 'Whiskers', species: 'Cat', primary_owner: 'Jane Smith', owner_id: 6, is_active: 1 },
      ]);
    });

    const res = await request(app)
      .get('/patients')
      .set(USER_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toBeDefined();
    expect(typeof res.body.meta.total).toBe('number');

    // Each patient must have id and name
    if (res.body.data.length > 0) {
      const patient = res.body.data[0];
      expect(patient.id).toBeDefined();
      expect(typeof patient.name).toBe('string');
    }
  });

  it('supports GET /patients?limit=1', async () => {
    db.query.mockImplementation((sql) => {
      if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) return Promise.resolve(LIST_SCHEMA_ROWS);
      if (sql.includes('COUNT')) return Promise.resolve([{ total: 1 }]);
      return Promise.resolve([
        { id: 1, name: 'Buddy', species: 'Dog', primary_owner: 'John Doe', owner_id: 5, is_active: 1 },
      ]);
    });

    const res = await request(app)
      .get('/patients?limit=1')
      .set(USER_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta.limit).toBe(1);
  });
});

// ── Contract: GET /patients/:id (detail) ─────────────────────────────────────

describe('Contract — GET /patients/:id', () => {
  const PATIENT_DETAIL_SHAPE = {
    success: 'boolean',
    data: {
      id:      null,
      name:    'string',
      owners:  null,   // array
      allergies: null, // array
      chronicConditions: null, // array
    },
  };

  it('detail response has required fields', async () => {
    const fakePatient = {
      id: 1, name: 'Buddy', species_name: 'Dog', breed_name: 'Labrador',
      organization_id: 10, is_active: 1, sex: 'male',
    };

    let detailQueryCall = 0;
    db.query.mockImplementation((sql) => {
      if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) return Promise.resolve(LIST_SCHEMA_ROWS);
      detailQueryCall += 1;
      if (detailQueryCall === 1) return Promise.resolve([{ id: 5, first_name: 'John', last_name: 'Doe', ownership_type: 'primary' }]);
      if (detailQueryCall === 2) return Promise.resolve([]);
      return Promise.resolve([]);
    });
    db.queryOne
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce(fakePatient);

    const res = await request(app)
      .get('/patients/1')
      .set(USER_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const { data } = res.body;
    expect(data.id).toBe(1);
    expect(data.name).toBe('Buddy');
    expect(Array.isArray(data.owners)).toBe(true);
    expect(Array.isArray(data.allergies)).toBe(true);
    expect(Array.isArray(data.chronicConditions)).toBe(true);
  });

  it('404 response has standard shape', async () => {
    db.query.mockImplementation((sql) => {
      if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) return Promise.resolve(LIST_SCHEMA_ROWS);
      return Promise.resolve([]);
    });
    db.queryOne.mockResolvedValueOnce(null);

    const res = await request(app)
      .get('/patients/99999')
      .set(USER_HEADERS);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(typeof res.body.error.message).toBe('string');
  });
});

// ── Contract: POST /patients (create) ────────────────────────────────────────

describe('Contract — POST /patients', () => {
  it('201 response has required fields', async () => {
    db.transaction.mockResolvedValueOnce(1);

    const res = await request(app)
      .post('/patients')
      .set(USER_HEADERS)
      .send({
        name: 'Rex', speciesId: 1, primaryOwnerId: 5, sex: 'male',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('400 missing fields has standard error shape', async () => {
    const res = await request(app)
      .post('/patients')
      .set(USER_HEADERS)
      .send({ name: 'Rex' }); // missing required fields

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(typeof res.body.error.message).toBe('string');
  });
});

// ── Contract: GET /species/all ────────────────────────────────────────────────

describe('Contract — GET /species/all', () => {
  it('returns array of species with id and common_name', async () => {
    db.query.mockResolvedValueOnce([
      { id: 1, common_name: 'Dog', scientific_name: 'Canis lupus', category: 'Mammal' },
      { id: 2, common_name: 'Cat', scientific_name: 'Felis catus', category: 'Mammal' },
    ]);

    const res = await request(app)
      .get('/patients/species/all')
      .set(USER_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);

    if (res.body.data.length > 0) {
      const sp = res.body.data[0];
      expect(sp.id).toBeDefined();
      expect(typeof sp.common_name).toBe('string');
    }
  });

  it('exposes the public alias /species/all on the full service app', async () => {
    db.query.mockResolvedValueOnce([
      { id: 1, common_name: 'Dog', scientific_name: 'Canis lupus', category: 'Mammal' },
    ]);

    const res = await request(app)
      .get('/species/all')
      .set(USER_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0].common_name).toBe('Dog');
  });
});
