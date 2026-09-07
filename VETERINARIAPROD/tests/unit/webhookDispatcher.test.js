'use strict';

jest.mock('axios', () => ({ post: jest.fn() }));
jest.mock('../../shared/db', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
}));
jest.mock('../../shared/webhooks/signature', () => ({
  HEADER: 'X-Webhook-Signature',
  sign: jest.fn(() => 'signed-payload'),
}));
jest.mock('../../shared/metrics', () => ({
  webhookDeliveries: { inc: jest.fn() },
}));

describe('webhook dispatcher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('claims due deliveries before posting and skips deliveries already claimed elsewhere', async () => {
    const axios = require('axios');
    const db = require('../../shared/db');
    const { webhookDeliveries } = require('../../shared/metrics');
    const { processPending } = require('../../shared/webhooks/dispatcher');

    db.query.mockImplementation(async (sql, params = {}) => {
      if (sql.includes('SELECT id')) {
        return [{ id: 10 }, { id: 11 }];
      }
      if (sql.includes('attempt_count = attempt_count + 1')) {
        return [{ affectedRows: params.id === 10 ? 1 : 0 }];
      }
      if (sql.includes('response_status')) {
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected query: ${sql}`);
    });
    db.queryOne.mockResolvedValue({
      id: 10,
      endpoint_id: 1,
      event_type: 'patient.created',
      payload: '{"patientId":42}',
      attempt_count: 1,
      url: 'https://example.test/webhooks/patient',
      secret: 'secret',
    });
    axios.post.mockResolvedValue({ status: 204, data: { accepted: true } });

    await processPending();

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('attempt_count = attempt_count + 1'),
      expect.objectContaining({ id: 10, leaseUntil: expect.any(Date) }),
    );
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('attempt_count = attempt_count + 1'),
      expect.objectContaining({ id: 11, leaseUntil: expect.any(Date) }),
    );
    expect(db.queryOne).toHaveBeenCalledTimes(1);
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post).toHaveBeenCalledWith(
      'https://example.test/webhooks/patient',
      { patientId: 42 },
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Webhook-Signature': 'signed-payload',
          'X-Webhook-Event': 'patient.created',
          'X-Delivery-Id': '10',
        }),
      }),
    );
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('response_status'),
      expect.objectContaining({ id: 10, status: 'delivered', attempt: 1 }),
    );
    expect(webhookDeliveries.inc).toHaveBeenCalledWith({ event: 'patient.created', result: 'success' });
  });
});
