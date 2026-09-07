'use strict';

jest.mock('../../shared/cache', () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
}));

const cache = require('../../shared/cache');
const {
  hasPermission,
  getEffectivePermissions,
  hasPermissionDynamic,
  setRoleOverride,
  ROLE_PERMISSIONS,
} = require('../../shared/rbac');

beforeEach(() => jest.clearAllMocks());

describe('hasPermission() — estático (sin cambios)', () => {
  test('veterinarian puede leer pacientes', () => {
    expect(hasPermission(['veterinarian'], 'patients:read')).toBe(true);
  });

  test('receptionist NO puede eliminar pacientes', () => {
    expect(hasPermission(['receptionist'], 'patients:delete')).toBe(false);
  });

  test('superadmin tiene todo con wildcard *', () => {
    expect(hasPermission(['superadmin'], 'any:permission')).toBe(true);
  });

  test('rol desconocido → sin permisos', () => {
    expect(hasPermission(['rol_inventado'], 'patients:read')).toBe(false);
  });
});

describe('getEffectivePermissions() — dinámico', () => {
  test('sin orgId devuelve permisos base', async () => {
    const perms = await getEffectivePermissions('veterinarian', null);
    expect(perms).toEqual(ROLE_PERMISSIONS['veterinarian']);
  });

  test('sin override en cache devuelve permisos base', async () => {
    const perms = await getEffectivePermissions('veterinarian', '99');
    expect(perms).toEqual(ROLE_PERMISSIONS['veterinarian']);
  });

  test('override con grant agrega permisos', async () => {
    cache.get.mockResolvedValue({ grant: ['billing:read'], revoke: [] });
    const perms = await getEffectivePermissions('veterinarian', '42');
    expect(perms).toContain('billing:read');
  });

  test('override con revoke quita permisos', async () => {
    cache.get.mockResolvedValue({ grant: [], revoke: ['telemedicine:create'] });
    const perms = await getEffectivePermissions('veterinarian', '42');
    expect(perms).not.toContain('telemedicine:create');
    // otros permisos intactos
    expect(perms).toContain('patients:read');
  });

  test('grant y revoke combinados', async () => {
    cache.get.mockResolvedValue({ grant: ['invoices:delete'], revoke: ['reports:read'] });
    const perms = await getEffectivePermissions('veterinarian', '42');
    expect(perms).toContain('invoices:delete');
    expect(perms).not.toContain('reports:read');
  });

  test('fallo de cache → devuelve permisos base', async () => {
    cache.get.mockRejectedValue(new Error('Redis down'));
    const perms = await getEffectivePermissions('veterinarian', '42');
    expect(perms).toEqual(ROLE_PERMISSIONS['veterinarian']);
  });
});

describe('hasPermissionDynamic()', () => {
  test('permiso concedido por grant dinámico', async () => {
    cache.get.mockResolvedValue({ grant: ['billing:read'], revoke: [] });
    expect(await hasPermissionDynamic(['veterinarian'], 'billing:read', '42')).toBe(true);
  });

  test('permiso denegado por revoke dinámico', async () => {
    cache.get.mockResolvedValue({ grant: [], revoke: ['telemedicine:create'] });
    expect(await hasPermissionDynamic(['veterinarian'], 'telemedicine:create', '42')).toBe(false);
  });

  test('permiso existente sin overrides', async () => {
    expect(await hasPermissionDynamic(['veterinarian'], 'patients:read', '42')).toBe(true);
  });
});

describe('setRoleOverride()', () => {
  test('guarda override en cache con la clave correcta', async () => {
    await setRoleOverride('42', 'veterinarian', ['billing:read'], ['reports:read']);
    expect(cache.set).toHaveBeenCalledWith(
      'rbac:org:42:role:veterinarian',
      { grant: ['billing:read'], revoke: ['reports:read'] },
      expect.any(Number)
    );
  });
});
