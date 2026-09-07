'use strict';

/**
 * Unit tests — db.transaction with decorated connection (savepoints, helpers)
 */

// We need to mock mysql2/promise before requiring db.js
let mockConn;
jest.mock('mysql2/promise', () => {
  mockConn = {
    beginTransaction:  jest.fn().mockResolvedValue(undefined),
    commit:            jest.fn().mockResolvedValue(undefined),
    rollback:          jest.fn().mockResolvedValue(undefined),
    release:           jest.fn(),
    execute:           jest.fn(),
  };

  const pool = {
    getConnection: jest.fn().mockResolvedValue(mockConn),
    execute:       jest.fn(),
  };

  return { createPool: jest.fn(() => pool) };
});

const db = require('../../shared/db');

beforeEach(() => {
  jest.clearAllMocks();
  mockConn.execute.mockResolvedValue([[{ id: 1 }], []]);
});

describe('db.transaction — decorated connection', () => {
  test('commits on success and releases connection', async () => {
    await db.transaction(async (conn) => {
      await conn.execute('SELECT 1');
    });

    expect(mockConn.beginTransaction).toHaveBeenCalledTimes(1);
    expect(mockConn.commit).toHaveBeenCalledTimes(1);
    expect(mockConn.rollback).not.toHaveBeenCalled();
    expect(mockConn.release).toHaveBeenCalledTimes(1);
  });

  test('rolls back and rethrows on error', async () => {
    mockConn.execute.mockRejectedValueOnce(new Error('DB error'));

    await expect(
      db.transaction(async (conn) => { await conn.execute('BAD SQL'); })
    ).rejects.toThrow('DB error');

    expect(mockConn.rollback).toHaveBeenCalledTimes(1);
    expect(mockConn.commit).not.toHaveBeenCalled();
    expect(mockConn.release).toHaveBeenCalledTimes(1); // always released
  });

  test('preserves the original error when rollback also fails', async () => {
    const original = new Error('DB error');
    mockConn.execute.mockRejectedValueOnce(original);
    mockConn.rollback.mockRejectedValueOnce(new Error('rollback failed'));

    await expect(
      db.transaction(async (conn) => { await conn.execute('BAD SQL'); })
    ).rejects.toBe(original);

    expect(original.rollbackError).toBeInstanceOf(Error);
    expect(original.rollbackError.message).toBe('rollback failed');
    expect(mockConn.release).toHaveBeenCalledTimes(1);
  });

  test('conn.query wraps execute and returns rows array', async () => {
    mockConn.execute.mockResolvedValueOnce([[{ name: 'Rex' }], []]);

    const rows = await db.transaction(async (conn) => conn.query('SELECT * FROM patients'));

    expect(rows).toEqual([{ name: 'Rex' }]);
  });

  test('conn.queryOne returns first row or null', async () => {
    mockConn.execute
      .mockResolvedValueOnce([[{ id: 1, name: 'Rex' }], []])  // first call
      .mockResolvedValueOnce([[], []]);                        // second call (empty)

    const [row1, row2] = await db.transaction(async (conn) => {
      const r1 = await conn.queryOne('SELECT * FROM patients WHERE id = ?', [1]);
      const r2 = await conn.queryOne('SELECT * FROM patients WHERE id = ?', [999]);
      return [r1, r2];
    });

    expect(row1).toEqual({ id: 1, name: 'Rex' });
    expect(row2).toBeNull();
  });

  test('conn.savepoint issues SAVEPOINT SQL', async () => {
    await db.transaction(async (conn) => {
      await conn.savepoint('sp1');
    });

    expect(mockConn.execute).toHaveBeenCalledWith('SAVEPOINT sp1');
  });

  test('conn.rollbackToSavepoint issues ROLLBACK TO SAVEPOINT SQL', async () => {
    await db.transaction(async (conn) => {
      await conn.rollbackToSavepoint('sp1');
    });

    expect(mockConn.execute).toHaveBeenCalledWith('ROLLBACK TO SAVEPOINT sp1');
  });

  test('conn.releaseSavepoint issues RELEASE SAVEPOINT SQL', async () => {
    await db.transaction(async (conn) => {
      await conn.releaseSavepoint('sp1');
    });

    expect(mockConn.execute).toHaveBeenCalledWith('RELEASE SAVEPOINT sp1');
  });

  test('partial rollback with savepoint leaves outer transaction intact', async () => {
    mockConn.execute
      .mockResolvedValueOnce([[{ insertId: 1 }], []])  // outer INSERT
      .mockResolvedValueOnce(undefined)                // SAVEPOINT sp1
      .mockRejectedValueOnce(new Error('inner error')) // inner INSERT fails
      .mockResolvedValueOnce(undefined)                // ROLLBACK TO SAVEPOINT sp1
      .mockResolvedValueOnce([[{ insertId: 2 }], []]); // recovery INSERT

    const result = await db.transaction(async (conn) => {
      await conn.execute('INSERT INTO a VALUES (?)', [1]);
      await conn.savepoint('sp1');
      try {
        await conn.execute('INSERT INTO b VALUES (?)', ['bad']);
      } catch (_) {
        await conn.rollbackToSavepoint('sp1');
        await conn.execute('INSERT INTO b VALUES (?)', ['good']);
      }
      return 'done';
    });

    expect(result).toBe('done');
    expect(mockConn.commit).toHaveBeenCalledTimes(1);
  });
});
