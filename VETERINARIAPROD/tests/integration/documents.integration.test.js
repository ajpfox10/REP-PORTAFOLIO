'use strict';

jest.mock('../../shared/db');
jest.mock('../../shared/minio', () => ({
  uploadFile: jest.fn(),
  getPresignedUrl: jest.fn(),
  getObjectBuffer: jest.fn(),
  BUCKETS: { documents: 'documents-inbox' },
}));

process.env.INTERNAL_SECRET = '';
process.env.NODE_ENV = 'test';

const request = require('supertest');
const db = require('../../shared/db');
const minio = require('../../shared/minio');
const app = require('../../services/documents/src/index');

const AUTH = {
  'X-User-Id': '1',
  'X-Org-Id': '3',
  'X-Branch-Id': '11',
  'X-User-Roles': 'org_admin',
  'X-User-Email': 'admin@clinic.com',
};

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockResolvedValue([]);
  db.queryOne.mockResolvedValue(null);
  db.transaction.mockImplementation(async (callback) => callback({
    query: db.query,
    queryOne: db.queryOne,
  }));
});

describe('documents service', () => {
  test('PATCH /mail-accounts/:id is mounted and returns 204 when the account exists', async () => {
    db.queryOne.mockResolvedValueOnce({
      id: 7,
      org_id: 3,
      settings_json: '{}',
    });
    db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

    const res = await request(app)
      .patch('/documents/mail-accounts/7')
      .set(AUTH)
      .send({ displayName: 'Cuenta principal' });

    expect(res.status).toBe(204);
  });

  test('GET /inbox/:id is mounted and returns the document detail', async () => {
    db.queryOne.mockResolvedValueOnce({
      id: 15,
      org_id: 3,
      account_id: 9,
      patient_id: 44,
      subject: 'Resultado',
      metadata_json: '{}',
      provider: 'gmail',
      email_address: 'ops@clinic.com',
      patient_name: 'Firulais',
    });

    const res = await request(app)
      .get('/documents/inbox/15')
      .set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      id: 15,
      subject: 'Resultado',
    });
  });

  test('GET /inbox/:id/download-url is mounted and returns a presigned URL', async () => {
    db.queryOne.mockResolvedValueOnce({
      storage_path: 'http://minio/documents-inbox/documents/3/15/file.pdf',
    });
    minio.getPresignedUrl.mockResolvedValueOnce('https://signed.example/documents/15');

    const res = await request(app)
      .get('/documents/inbox/15/download-url')
      .set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      url: 'https://signed.example/documents/15',
      expiresIn: 3600,
    });
  });

  test('POST /mail-accounts/:id/sync returns 501 for unsupported Outlook provider', async () => {
    db.queryOne.mockResolvedValueOnce({
      id: 7,
      org_id: 3,
      provider: 'outlook',
      email_address: 'ops@clinic.com',
      display_name: 'Outlook',
      folder_name: 'INBOX',
      is_active: 1,
      last_synced_at: null,
      last_error: null,
      created_at: '2026-05-10T00:00:00.000Z',
      updated_at: '2026-05-10T00:00:00.000Z',
      settings_json: '{}',
    });

    const res = await request(app)
      .post('/documents/mail-accounts/7/sync')
      .set(AUTH);

    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('DOCUMENTS_PROVIDER_NOT_IMPLEMENTED');
    expect(res.body.error.details).toMatchObject({
      provider: 'outlook',
      remoteSyncSupported: false,
    });
  });

  test('POST /inbox/:id/ingest returns 501 for unsupported automatic ingestion category', async () => {
    db.queryOne.mockResolvedValueOnce({
      id: 15,
      org_id: 3,
      patient_id: 44,
      document_category: 'prescription',
      storage_path: 'http://minio/documents-inbox/documents/3/15/file.pdf',
      metadata_json: '{}',
    });

    const res = await request(app)
      .post('/documents/inbox/15/ingest')
      .set(AUTH);

    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('DOCUMENTS_INGESTION_NOT_IMPLEMENTED');
    expect(res.body.error.details).toMatchObject({
      category: 'prescription',
      automaticIngestionImplemented: false,
    });
  });
});
