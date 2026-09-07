'use strict';

jest.mock('../../shared/db');
jest.mock('../../shared/redis', () => ({
  createRedisClient: jest.fn(() => ({ isReady: true, publish: jest.fn().mockResolvedValue(1) })),
  connectRedis: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../shared/messaging', () => ({
  sendSms: jest.fn(),
  sendWhatsApp: jest.fn(),
  sendTemplate: jest.fn(),
}));
jest.mock('../../shared/fcm', () => ({
  subscribeToTopic: jest.fn().mockResolvedValue(undefined),
  unsubscribeFromTopic: jest.fn().mockResolvedValue(undefined),
  sendToTopic: jest.fn().mockResolvedValue(undefined),
  sendToMultiple: jest.fn().mockResolvedValue({ sent: 0, failedTokens: [] }),
}));

const request = require('supertest');
const db = require('../../shared/db');

process.env.INTERNAL_SECRET = '';
process.env.NODE_ENV = 'test';

const app = require('../../services/notifications/src/index');

const AUTH = {
  'X-User-Id': '7',
  'X-Org-Id': '3',
  'X-Branch-Id': '11',
  'X-User-Roles': 'org_admin',
};

const SCHEMA_ROWS = [
  { TABLE_NAME: 'notification_logs', COLUMN_NAME: 'id' },
  { TABLE_NAME: 'notification_logs', COLUMN_NAME: 'user_id' },
  { TABLE_NAME: 'notification_logs', COLUMN_NAME: 'client_id' },
  { TABLE_NAME: 'notification_logs', COLUMN_NAME: 'branch_id' },
  { TABLE_NAME: 'notification_logs', COLUMN_NAME: 'title' },
  { TABLE_NAME: 'notification_logs', COLUMN_NAME: 'type' },
  { TABLE_NAME: 'notification_logs', COLUMN_NAME: 'body' },
  { TABLE_NAME: 'notification_logs', COLUMN_NAME: 'created_at' },
  { TABLE_NAME: 'notification_logs', COLUMN_NAME: 'is_read' },
  { TABLE_NAME: 'notification_logs', COLUMN_NAME: 'url' },
  { TABLE_NAME: 'user_fcm_tokens', COLUMN_NAME: 'user_id' },
];

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockImplementation((sql) => {
    if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) return Promise.resolve(SCHEMA_ROWS);
    return Promise.resolve([]);
  });
});

describe('notifications service', () => {
  test('GET /notifications reads legacy-compatible columns and unread count', async () => {
    let dataCalls = 0;
    db.query.mockImplementation((sql) => {
      if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) return Promise.resolve(SCHEMA_ROWS);
      dataCalls += 1;
      if (dataCalls === 1) {
        expect(sql).toMatch(/AS notification_type/);
        expect(sql).toMatch(/AS message/);
        expect(sql).toMatch(/is_read/);
        return Promise.resolve([{ id: 1, notification_type: 'alert', message: 'Hola' }]);
      }
      return Promise.resolve([{ unread: 2 }]);
    });

    const res = await request(app).get('/notifications?unreadOnly=true').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.unreadCount).toBe(2);
  });

  test('PATCH /notifications/:id/read updates available read marker', async () => {
    db.query.mockImplementation((sql) => {
      if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) return Promise.resolve(SCHEMA_ROWS);
      expect(sql).toMatch(/is_read = 1/);
      return Promise.resolve([{ affectedRows: 1 }]);
    });

    const res = await request(app).patch('/notifications/99/read').set(AUTH);
    expect(res.status).toBe(204);
  });

  test('POST /notifications/push inserts only columns present in AWS schema variant', async () => {
    const executed = [];
    db.query.mockImplementation((sql) => {
      if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) return Promise.resolve(SCHEMA_ROWS);
      executed.push(sql);
      return Promise.resolve([{ affectedRows: 1 }]);
    });

    const res = await request(app)
      .post('/notifications/push')
      .set(AUTH)
      .send({
        targetUserIds: [8],
        type: 'alert',
        title: 'Titulo',
        message: 'Mensaje',
        severity: 'high',
        actionUrl: '/x',
      });

    expect(res.status).toBe(201);
    expect(executed[0]).toMatch(/INSERT INTO notification_logs/);
    expect(executed[0]).toContain('type');
    expect(executed[0]).toContain('body');
    expect(executed[0]).not.toContain('notification_type');
    expect(executed[0]).not.toContain('message, severity');
  });

  test('POST /notifications/reminders/generate inserts reminders directly into AWS tables', async () => {
    const executed = [];
    db.transaction.mockImplementation(async (fn) => {
      const conn = {
        query: jest.fn((sql) => {
          executed.push(sql);
          if (sql.includes('INSERT INTO reminders')) {
            return Promise.resolve([{ affectedRows: 3 }]);
          }
          return Promise.resolve([]);
        }),
      };
      return fn(conn);
    });

    const res = await request(app)
      .post('/notifications/reminders/generate')
      .set(AUTH);

    expect(res.status).toBe(200);
    expect(executed.some(sql => sql.includes('sp_generate_reminders'))).toBe(false);
    expect(executed.filter(sql => sql.includes('INSERT INTO reminders'))).toHaveLength(3);
    expect(executed[0]).toContain('scheduled_send_at');
  });
});
