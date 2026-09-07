'use strict';

describe('eventBus DLQ handling', () => {
  let redis;
  let metricInc;

  beforeEach(() => {
    jest.resetModules();
    metricInc = jest.fn();
    redis = {
      isReady: true,
      xGroupCreate: jest.fn().mockResolvedValue('OK'),
      xReadGroup: jest
        .fn()
        .mockResolvedValueOnce([
          {
            name: 'vetmanager:events',
            messages: [
              {
                id: '1-0',
                message: {
                  topic: 'notifications.push',
                  payload: JSON.stringify({ hello: 'world' }),
                  meta: JSON.stringify({ orgId: 1 }),
                  ts: '2026-05-10T08:00:00.000Z',
                },
              },
            ],
          },
        ])
        .mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve([]), 25))),
      xAck: jest.fn().mockResolvedValue(1),
      xAdd: jest.fn().mockResolvedValue('2-0'),
    };

    jest.doMock('../../shared/redis', () => ({
      getRedisSingleton: jest.fn().mockResolvedValue(redis),
    }));
    jest.doMock('../../shared/metrics', () => ({
      eventBusMessages: { inc: metricInc },
    }));
  });

  test('writes failed consumer messages to DLQ and acknowledges original message', async () => {
    const { subscribe, DLQ_STREAM } = require('../../shared/eventBus');

    const stop = await subscribe('consumer-a', async () => {
      throw new Error('boom');
    }, ['notifications.push']);

    await new Promise((resolve) => setTimeout(resolve, 20));
    await stop();

    expect(redis.xAdd).toHaveBeenCalledWith(DLQ_STREAM, '*', expect.objectContaining({
      topic: 'notifications.push',
      consumer: 'consumer-a',
    }));
    expect(redis.xAck).toHaveBeenCalledWith('vetmanager:events', 'vetmanager:consumer-a', '1-0');
    expect(metricInc).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'notifications.push',
      direction: 'consume',
      result: 'failure',
    }));
    expect(metricInc).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'notifications.push',
      direction: 'consume',
      result: 'dlq',
    }));
  });
});
