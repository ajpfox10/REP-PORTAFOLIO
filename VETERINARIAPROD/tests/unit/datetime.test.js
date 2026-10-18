'use strict';

const { toMySqlDateTime } = require('../../shared/datetime');

describe('toMySqlDateTime', () => {
  test('convierte ISO con zona a UTC sin sufijo', () => {
    expect(toMySqlDateTime('2026-10-25T11:00:00.000Z')).toBe('2026-10-25 11:00:00');
    expect(toMySqlDateTime('2026-10-25T08:00:00-03:00')).toBe('2026-10-25 11:00:00');
  });

  test('respeta la hora local cuando no trae zona', () => {
    expect(toMySqlDateTime('2026-10-25T10:30')).toBe('2026-10-25 10:30');
    expect(toMySqlDateTime('2026-10-25 10:30:00')).toBe('2026-10-25 10:30:00');
  });

  test('acepta Date y devuelve null si no hay valor', () => {
    expect(toMySqlDateTime(new Date('2026-01-02T03:04:05.678Z'))).toBe('2026-01-02 03:04:05');
    expect(toMySqlDateTime('')).toBeNull();
    expect(toMySqlDateTime(undefined)).toBeNull();
  });
});
