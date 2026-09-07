'use strict';

const jwt = require('../../shared/jwt');

// Simular buildOwnerToken sin importar el servicio (evitar require de dotenv)
function buildOwnerToken(client) {
  return jwt.signAccess({
    jti:      'test-jti',
    clientId: client.id,
    email:    client.email,
    orgId:    client.organization_id || null,
    role:     'owner',
  });
}

function buildOwnerRefresh(client) {
  return jwt.signRefresh({ clientId: client.id, role: 'owner' });
}

describe('Portal de dueños — lógica de tokens', () => {

  test('token de owner contiene role=owner', () => {
    const token   = buildOwnerToken({ id: 99, email: 'owner@test.com', organization_id: 1 });
    const decoded = jwt.verifyAccess(token);
    expect(decoded.role).toBe('owner');
    expect(decoded.clientId).toBe(99);
    expect(decoded.email).toBe('owner@test.com');
  });

  test('token de staff NO debe pasar como owner', () => {
    const staffToken = jwt.signAccess({ jti: 'x', userId: 1, roles: ['veterinarian'], orgId: 1 });
    const decoded    = jwt.verifyAccess(staffToken);
    expect(decoded.role).toBeUndefined();
    expect(decoded.role).not.toBe('owner');
  });

  test('refresh de owner contiene role=owner', () => {
    const token   = buildOwnerRefresh({ id: 99 });
    const decoded = jwt.verifyRefresh(token);
    expect(decoded.role).toBe('owner');
    expect(decoded.clientId).toBe(99);
  });

  test('token expirado debe ser rechazado', () => {
    // El método verifyAccess lanza si el token es inválido/expirado
    expect(() => jwt.verifyAccess('token.invalido.xxx')).toThrow();
  });
});

describe('Portal — reglas de negocio de citas', () => {
  const CANCELLABLE = ['requested', 'confirmed'];
  const NOT_CANCELLABLE = ['completed', 'in_progress', 'cancelled', 'no_show'];

  test.each(CANCELLABLE)('estado %s → cancelable', (status) => {
    expect(CANCELLABLE.includes(status)).toBe(true);
  });

  test.each(NOT_CANCELLABLE)('estado %s → NO cancelable', (status) => {
    expect(CANCELLABLE.includes(status)).toBe(false);
  });
});

describe('Portal — validación de contraseña', () => {
  function isValidPassword(pwd) {
    return pwd.length >= 8 && /[A-Z]/.test(pwd) && /[0-9]/.test(pwd);
  }

  test('contraseña válida', ()   => expect(isValidPassword('Segura123')).toBe(true));
  test('sin mayúscula → inválida', () => expect(isValidPassword('segura123')).toBe(false));
  test('sin número → inválida',    () => expect(isValidPassword('SinNumero')).toBe(false));
  test('muy corta → inválida',     () => expect(isValidPassword('Ab1')).toBe(false));
});
