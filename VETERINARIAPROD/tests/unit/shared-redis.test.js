'use strict';

describe('shared/redis', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.resetModules();
  });

  test('prefers REDIS_URL when present', () => {
    process.env.REDIS_URL = 'redis://default:secret@example.internal:6379';
    process.env.REDIS_HOST = 'ignored-host';
    process.env.REDIS_PORT = '6380';

    const { buildRedisOptions } = require('../../shared/redis');
    const opts = buildRedisOptions();

    expect(opts.url).toBe('redis://default:secret@example.internal:6379');
    expect(opts.socket.connectTimeout).toBe(3000);
  });

  test('falls back to host and port when REDIS_URL is unresolved template text', () => {
    process.env.REDIS_URL = 'redis://${{REDISUSER}}:${{REDIS_PASSWORD}}@${{REDISHOST}}:${{REDISPORT}}';
    process.env.REDIS_HOST = 'redis.internal';
    process.env.REDIS_PORT = '6379';
    process.env.REDIS_PASSWORD = 'secret';

    const { buildRedisOptions } = require('../../shared/redis');
    const opts = buildRedisOptions();

    expect(opts.url).toBeUndefined();
    expect(opts.socket.host).toBe('redis.internal');
    expect(opts.socket.port).toBe(6379);
    expect(opts.password).toBe('secret');
  });
});
