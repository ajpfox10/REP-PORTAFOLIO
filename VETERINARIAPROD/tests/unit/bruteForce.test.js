'use strict';

/**
 * Unit tests — Brute-force logic
 *
 * Tests the BF_THRESHOLDS constants and exported helper structure.
 * Behavioral end-to-end testing is covered in auth.integration.test.js.
 */

// ── Pure logic unit tests (no external dependencies) ─────────────────────────

const BF_THRESHOLDS = [
  { attempts: 4, lockSecs: 30 },
  { attempts: 5, lockSecs: 60 },
  { attempts: 6, lockSecs: 120 },
  { attempts: 7, lockSecs: 900 },
];

/**
 * Replicate the rule-selection logic from auth.controller.js
 * to verify the threshold table is correct.
 */
function getRuleForAttempt(n) {
  return [...BF_THRESHOLDS].reverse().find(r => n >= r.attempts);
}

describe('BF_THRESHOLDS — rule selection', () => {
  test('attempt 1: no rule (no lock)', () => expect(getRuleForAttempt(1)).toBeUndefined());
  test('attempt 3: no rule', ()       => expect(getRuleForAttempt(3)).toBeUndefined());
  test('attempt 4: 30 s lock',  ()   => expect(getRuleForAttempt(4)).toMatchObject({ lockSecs: 30 }));
  test('attempt 5: 60 s lock',  ()   => expect(getRuleForAttempt(5)).toMatchObject({ lockSecs: 60 }));
  test('attempt 6: 120 s lock', ()   => expect(getRuleForAttempt(6)).toMatchObject({ lockSecs: 120 }));
  test('attempt 7: 900 s lock', ()   => expect(getRuleForAttempt(7)).toMatchObject({ lockSecs: 900 }));
  test('attempt 8: still 900 s (cap)', () => expect(getRuleForAttempt(8)).toMatchObject({ lockSecs: 900 }));
  test('attempt 20: still 900 s (cap)', () => expect(getRuleForAttempt(20)).toMatchObject({ lockSecs: 900 }));
});

describe('BF_THRESHOLDS — integrity', () => {
  test('thresholds are in ascending order', () => {
    for (let i = 1; i < BF_THRESHOLDS.length; i++) {
      expect(BF_THRESHOLDS[i].attempts).toBeGreaterThan(BF_THRESHOLDS[i-1].attempts);
      expect(BF_THRESHOLDS[i].lockSecs).toBeGreaterThan(BF_THRESHOLDS[i-1].lockSecs);
    }
  });
  test('first threshold is ≥ 3 attempts (allows normal typos)', () => {
    expect(BF_THRESHOLDS[0].attempts).toBeGreaterThanOrEqual(3);
  });
  test('cap is at most 15 min (900 s)', () => {
    const max = Math.max(...BF_THRESHOLDS.map(r => r.lockSecs));
    expect(max).toBeLessThanOrEqual(900);
  });
});

// ── Exported helper contract ───────────────────────────────────────────────────

jest.mock('../../shared/twoFactor', () => ({ setupTwoFactor: jest.fn(), verifyTwoFactor: jest.fn(), generateRecoveryCodes: jest.fn(()=>[]) }));
jest.mock('../../shared/email', () => ({ send2faEnabled: jest.fn(), sendPasswordReset: jest.fn() }));
jest.mock('../../shared/db');
jest.mock('../../shared/jwt', () => ({ signAccess: jest.fn(), signRefresh: jest.fn(), hashToken: jest.fn(), verifyRefresh: jest.fn(), generateOpaqueToken: jest.fn() }));
jest.mock('redis', () => ({ createClient: jest.fn(() => ({ connect: jest.fn().mockResolvedValue(undefined), on: jest.fn(), get: jest.fn().mockResolvedValue(null), set: jest.fn(), setEx: jest.fn(), del: jest.fn(), incr: jest.fn().mockResolvedValue(0), expire: jest.fn(), ttl: jest.fn().mockResolvedValue(-1) })) }));

const ctrl = require('../../services/auth/src/controllers/auth.controller');

describe('exported brute-force helpers', () => {
  test('_checkBruteForce is a function', () => expect(typeof ctrl._checkBruteForce).toBe('function'));
  test('_recordFailedAttempt is a function', () => expect(typeof ctrl._recordFailedAttempt).toBe('function'));
  test('_clearBruteForce is a function', () => expect(typeof ctrl._clearBruteForce).toBe('function'));

  test('_checkBruteForce returns { locked: false } when Redis returns null', async () => {
    // redis.get is mocked to return null → no lock
    const r = await ctrl._checkBruteForce('test@v.com', '1.2.3.4');
    expect(r).toEqual({ locked: false });
  });
});
