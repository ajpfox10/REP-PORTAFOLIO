'use strict';

// Testea la lógica de topics y sanitización sin llamar a Firebase

describe('FCM — lógica de topics y datos', () => {

  describe('Nombres de topics', () => {
    function orgTopic(orgId)          { return `org_${orgId}`; }
    function branchTopic(branchId)    { return `branch_${branchId}`; }
    function roleTopic(orgId, role)   { return `role_${orgId}_${role}`; }

    test('topic de org',    () => expect(orgTopic(42)).toBe('org_42'));
    test('topic de branch', () => expect(branchTopic(7)).toBe('branch_7'));
    test('topic de rol',    () => expect(roleTopic(42, 'veterinarian')).toBe('role_42_veterinarian'));
  });

  describe('sanitizeData — FCM solo acepta string values', () => {
    function sanitizeData(data = {}) {
      const out = {};
      for (const [k, v] of Object.entries(data)) out[k] = String(v);
      return out;
    }

    test('convierte números a string', () => {
      expect(sanitizeData({ invoiceId: 123, amount: 99.5 }))
        .toEqual({ invoiceId: '123', amount: '99.5' });
    });

    test('convierte booleanos a string', () => {
      expect(sanitizeData({ critical: true, active: false }))
        .toEqual({ critical: 'true', active: 'false' });
    });

    test('mantiene strings', () => {
      expect(sanitizeData({ title: 'Alerta', type: 'lab' }))
        .toEqual({ title: 'Alerta', type: 'lab' });
    });

    test('objeto vacío → objeto vacío', () => {
      expect(sanitizeData({})).toEqual({});
    });
  });

  describe('Plataformas válidas', () => {
    const VALID = ['web', 'android', 'ios'];
    test.each(VALID)('%s es válida', p => expect(VALID.includes(p)).toBe(true));
    test('desktop no es válida', () => expect(VALID.includes('desktop')).toBe(false));
  });

  describe('Tokens inválidos deben desactivarse', () => {
    function shouldDeactivate(fcmError) {
      const INVALID_CODES = [
        'messaging/registration-token-not-registered',
        'messaging/invalid-registration-token',
      ];
      return INVALID_CODES.includes(fcmError);
    }

    test('token no registrado → desactivar', () =>
      expect(shouldDeactivate('messaging/registration-token-not-registered')).toBe(true));
    test('token inválido → desactivar', () =>
      expect(shouldDeactivate('messaging/invalid-registration-token')).toBe(true));
    test('error de red → no desactivar', () =>
      expect(shouldDeactivate('messaging/internal-error')).toBe(false));
  });
});
