'use strict';

describe('serviceTargets discovery', () => {
  afterEach(() => {
    delete process.env.SERVICE_DISCOVERY_MODE;
    delete process.env.SERVICE_DISCOVERY_HEALTH_AWARE;
    jest.resetModules();
    jest.restoreAllMocks();
    delete global.fetch;
  });

  test('env mode returns configured fallback directly', async () => {
    process.env.SERVICE_DISCOVERY_MODE = 'env';
    jest.doMock('../../shared/serviceRegistry', () => ({
      resolveServiceTarget: jest.fn(),
      resolveServiceTargets: jest.fn().mockResolvedValue([]),
      listServices: jest.fn().mockResolvedValue([]),
    }));

    const { resolveRuntimeServiceTarget } = require('../../shared/serviceTargets');
    await expect(resolveRuntimeServiceTarget('auth')).resolves.toBe('http://localhost:4051');
  });

  test('runtime mode prefers DNS-discovered targets', async () => {
    process.env.SERVICE_DISCOVERY_MODE = 'runtime';
    jest.doMock('dns', () => ({
      promises: {
        lookup: jest.fn().mockResolvedValue([{ address: '10.0.0.1', family: 4 }]),
      },
    }));
    jest.doMock('../../shared/serviceRegistry', () => ({
      resolveServiceTarget: jest.fn(),
      resolveServiceTargets: jest.fn().mockResolvedValue([]),
      listServices: jest.fn().mockResolvedValue([]),
    }));
    global.fetch = jest.fn().mockResolvedValue({ status: 200 });

    const { resolveRuntimeServiceTarget } = require('../../shared/serviceTargets');
    await expect(resolveRuntimeServiceTarget('auth')).resolves.toBe('http://auth:4051');
  });

  test('hybrid mode uses registry instances when present', async () => {
    process.env.SERVICE_DISCOVERY_MODE = 'hybrid';
    jest.doMock('dns', () => ({
      promises: {
        lookup: jest.fn().mockRejectedValue(new Error('no dns')),
      },
    }));
    jest.doMock('../../shared/serviceRegistry', () => ({
      resolveServiceTarget: jest.fn(),
      resolveServiceTargets: jest.fn().mockResolvedValue([
        { url: 'http://auth-a:4051', updatedAt: '2026-05-10T10:00:00.000Z' },
        { url: 'http://auth-b:4051', updatedAt: '2026-05-10T09:00:00.000Z' },
      ]),
      listServices: jest.fn().mockResolvedValue([]),
    }));
    global.fetch = jest.fn().mockResolvedValue({ status: 200 });

    const { resolveRuntimeServiceTarget } = require('../../shared/serviceTargets');
    await expect(resolveRuntimeServiceTarget('auth')).resolves.toBe('http://auth-a:4051');
    await expect(resolveRuntimeServiceTarget('auth')).resolves.toBe('http://auth-b:4051');
  });

  test('health-aware selection skips unhealthy targets', async () => {
    process.env.SERVICE_DISCOVERY_MODE = 'hybrid';
    jest.doMock('dns', () => ({
      promises: {
        lookup: jest.fn().mockRejectedValue(new Error('no dns')),
      },
    }));
    jest.doMock('../../shared/serviceRegistry', () => ({
      resolveServiceTarget: jest.fn(),
      resolveServiceTargets: jest.fn().mockResolvedValue([
        { url: 'http://auth-a:4051', updatedAt: '2026-05-10T10:00:00.000Z' },
        { url: 'http://auth-b:4051', updatedAt: '2026-05-10T09:00:00.000Z' },
      ]),
      listServices: jest.fn().mockResolvedValue([]),
    }));
    global.fetch = jest.fn(async (url) => {
      if (String(url).startsWith('http://auth-a:4051')) return { status: 503 };
      return { status: 200 };
    });

    const { resolveRuntimeServiceTarget } = require('../../shared/serviceTargets');
    await expect(resolveRuntimeServiceTarget('auth')).resolves.toBe('http://auth-b:4051');
  });
});
