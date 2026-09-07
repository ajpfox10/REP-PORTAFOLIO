'use strict';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  jest.resetModules();
});

describe('gateway websocket token extraction', () => {
  test('prefers Authorization header over query token', () => {
    process.env.NODE_ENV = 'production';
    const { getTokenFromRequest } = require('../../gateway/src/websocket');

    const token = getTokenFromRequest({
      headers: { authorization: 'Bearer header-token' },
      url: '/ws?token=query-token',
    });

    expect(token).toBe('header-token');
  });

  test('rejects query token fallback in production', () => {
    process.env.NODE_ENV = 'production';
    const { getTokenFromRequest } = require('../../gateway/src/websocket');

    const token = getTokenFromRequest({
      headers: {},
      url: '/ws?token=query-token',
    });

    expect(token).toBeNull();
  });

  test('allows query token fallback in development', () => {
    process.env.NODE_ENV = 'development';
    const { getTokenFromRequest } = require('../../gateway/src/websocket');

    const token = getTokenFromRequest({
      headers: {},
      url: '/ws?token=query-token',
    });

    expect(token).toBe('query-token');
  });
});

describe('gateway websocket broadcast scoping', () => {
  let userSockets;
  let broadcast;

  function makeSocket() {
    return {
      readyState: 1,
      send: jest.fn(),
      isAlive: true,
    };
  }

  beforeEach(() => {
    jest.resetModules();
    ({ userSockets, broadcast } = require('../../gateway/src/websocket.connections'));
    userSockets.clear();
  });

  afterEach(() => {
    userSockets.clear();
  });

  test('broadcasts only to sockets in the matching org', () => {
    const orgMatch = makeSocket();
    const orgMiss = makeSocket();
    orgMatch.userContext = { userId: '1', orgId: '10', branchId: '5', roles: ['org_admin'] };
    orgMiss.userContext = { userId: '2', orgId: '20', branchId: '5', roles: ['org_admin'] };
    userSockets.set('1', new Set([orgMatch]));
    userSockets.set('2', new Set([orgMiss]));

    broadcast({ type: 'org_notice', orgId: '10', data: { msg: 'x' } });

    expect(orgMatch.send).toHaveBeenCalledTimes(1);
    expect(orgMiss.send).not.toHaveBeenCalled();
  });

  test('broadcasts only to sockets in the matching branch', () => {
    const branchMatch = makeSocket();
    const branchMiss = makeSocket();
    branchMatch.userContext = { userId: '1', orgId: '10', branchId: '99', roles: ['receptionist'] };
    branchMiss.userContext = { userId: '2', orgId: '10', branchId: '11', roles: ['receptionist'] };
    userSockets.set('1', new Set([branchMatch]));
    userSockets.set('2', new Set([branchMiss]));

    broadcast({ type: 'branch_notice', branchId: '99', data: { msg: 'x' } });

    expect(branchMatch.send).toHaveBeenCalledTimes(1);
    expect(branchMiss.send).not.toHaveBeenCalled();
  });

  test('broadcasts only to matching user ids and respects tenant scope', () => {
    const targetMatch = makeSocket();
    const targetWrongOrg = makeSocket();
    targetMatch.userContext = { userId: '7', orgId: '10', branchId: '5', roles: ['veterinarian'] };
    targetWrongOrg.userContext = { userId: '7', orgId: '20', branchId: '5', roles: ['veterinarian'] };
    userSockets.set('7', new Set([targetMatch, targetWrongOrg]));

    broadcast({
      type: 'direct_notice',
      targetUserIds: ['7'],
      orgId: '10',
      branchId: '5',
      data: { msg: 'x' },
    });

    expect(targetMatch.send).toHaveBeenCalledTimes(1);
    expect(targetWrongOrg.send).not.toHaveBeenCalled();
  });
});
