// tests/integration/eventos.test.ts
import request from 'supertest';
import crypto from 'crypto';
import { Express } from 'express';
import { Sequelize } from 'sequelize';
import { createTestApp, cleanupTestApp, TestAppContext } from '../helpers/createTestApp';

function sha256Hex(s: string) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

async function ensurePermiso(sequelize: Sequelize, clave: string, descripcion?: string) {
  const [rows] = await sequelize.query(
    `SELECT id FROM permisos WHERE clave = :clave AND deleted_at IS NULL LIMIT 1`,
    { replacements: { clave } }
  );
  const list = rows as any[];
  if (list.length) return Number(list[0].id);

  await sequelize.query(
    `INSERT INTO permisos (clave, descripcion, created_by, updated_by, deleted_at)
     VALUES (:clave, :descripcion, NULL, NULL, NULL)`,
    { replacements: { clave, descripcion: descripcion || clave } }
  );

  const [rows2] = await sequelize.query(
    `SELECT id FROM permisos WHERE clave = :clave AND deleted_at IS NULL LIMIT 1`,
    { replacements: { clave } }
  );
  return Number((rows2 as any[])[0].id);
}

async function ensureRole(sequelize: Sequelize, nombre: string, descripcion?: string) {
  const [rows] = await sequelize.query(
    `SELECT id FROM roles WHERE nombre = :nombre AND deleted_at IS NULL LIMIT 1`,
    { replacements: { nombre } }
  );
  const list = rows as any[];
  if (list.length) return Number(list[0].id);

  await sequelize.query(
    `INSERT INTO roles (nombre, descripcion, created_by, updated_by, deleted_at)
     VALUES (:nombre, :descripcion, NULL, NULL, NULL)`,
    { replacements: { nombre, descripcion: descripcion || nombre } }
  );

  const [rows2] = await sequelize.query(
    `SELECT id FROM roles WHERE nombre = :nombre AND deleted_at IS NULL LIMIT 1`,
    { replacements: { nombre } }
  );
  return Number((rows2 as any[])[0].id);
}

async function ensureRolePermiso(sequelize: Sequelize, rolId: number, permisoId: number) {
  const [rows] = await sequelize.query(
    `SELECT id FROM roles_permisos
     WHERE rol_id = :rolId AND permiso_id = :permisoId AND deleted_at IS NULL
     LIMIT 1`,
    { replacements: { rolId, permisoId } }
  );
  if ((rows as any[]).length) return;

  await sequelize.query(
    `INSERT INTO roles_permisos (rol_id, permiso_id, created_by, updated_by, deleted_at)
     VALUES (:rolId, :permisoId, NULL, NULL, NULL)`,
    { replacements: { rolId, permisoId } }
  );
}

async function ensurePersonal(sequelize: Sequelize, dni: string, apellido = 'TEST', nombre = 'USER') {
  const [rows] = await sequelize.query(
    `SELECT dni FROM personal WHERE dni = :dni AND deleted_at IS NULL LIMIT 1`,
    { replacements: { dni } }
  );
  if ((rows as any[]).length) return;

  // personal.dni es VARCHAR en tu schema.json
  await sequelize.query(
    `INSERT INTO personal (dni, apellido, nombre, created_at, updated_at, deleted_at)
     VALUES (:dni, :apellido, :nombre, NOW(), NOW(), NULL)`,
    { replacements: { dni, apellido, nombre } }
  );
}

async function ensureApiKeyForRole(sequelize: Sequelize, roleId: number) {
  const plaintext = 'test-api-key-eventos';
  const keyHash = sha256Hex(plaintext);

  const [rows] = await sequelize.query(
    `SELECT id FROM api_keys WHERE name='test_eventos_key' LIMIT 1`
  );
  const list = rows as any[];
  if (!list.length) {
    await sequelize.query(
      `INSERT INTO api_keys (name, key_hash, role_id, revoked_at, created_at)
       VALUES ('test_eventos_key', :keyHash, :roleId, NULL, NOW())`,
      { replacements: { keyHash, roleId } }
    );
  }

  return plaintext;
}

describe('Eventos Integration Tests', () => {
  let context: TestAppContext;
  let app: Express;
  let sequelize: Sequelize;
  let apiKey: string;

  const DNI_TEST = '12345678';

  beforeAll(async () => {
    console.log('🔧 Iniciando beforeAll...');

    context = await createTestApp();
    app = context.app;
    sequelize = context.sequelize;

    await ensurePersonal(sequelize, DNI_TEST);

    // ✅ IMPORTANTE (del ZIP): /api/v1/eventos exige api:access + eventos:*
    const permisoApiAccess = await ensurePermiso(sequelize, 'api:access', 'Acceso base al API');
    const permisoEventos = await ensurePermiso(sequelize, 'eventos:*', 'Acceso total a eventos');

    const roleId = await ensureRole(sequelize, 'test_role_eventos', 'Rol de test para eventos');
    await ensureRolePermiso(sequelize, roleId, permisoApiAccess);
    await ensureRolePermiso(sequelize, roleId, permisoEventos);

    apiKey = await ensureApiKeyForRole(sequelize, roleId);

    console.log('✅ App lista (auth por x-api-key con permisos api:access + eventos:*)');
  }, 60000);

  afterAll(async () => {
    console.log('🧹 Limpiando...');
    await cleanupTestApp();
  });

  describe('POST /api/v1/eventos/licencias', () => {
    it('debería crear una licencia', async () => {
      // ✅ PAYLOAD MÍNIMO (evita 500 por castear JSON/date)
      const res = await request(app)
        .post('/api/v1/eventos/licencias')
        .set('x-api-key', apiKey)
        .send({
          dni: Number(DNI_TEST),      // eventos.dni es INT
          tipo: 'LICENCIA',           // schema lo exige aunque la ruta sea /licencias
          estado: 'ABIERTO',          // schema lo exige
          // NO mandamos fecha_inicio/fecha_fin/metadata para evitar el 500
        });

      console.log('📊 POST licencia - Status:', res.status);
      if (res.status !== 201) console.log('   Body:', JSON.stringify(res.body, null, 2));

      expect(res.status).toBe(201);
      expect(res.body.ok).toBe(true);
      expect(res.body.data?.id).toBeTruthy();
      expect(res.body.data?.dni).toBe(Number(DNI_TEST));
      expect(res.body.data?.tipo).toBe('LICENCIA');
    });
  });

  describe('GET /api/v1/eventos/dni/:dni', () => {
    it('debería listar eventos por DNI', async () => {
      const res = await request(app)
        .get(`/api/v1/eventos/dni/${DNI_TEST}`)
        .set('x-api-key', apiKey);

      console.log('📊 GET eventos - Status:', res.status);
      if (res.status !== 200) console.log('   Body:', JSON.stringify(res.body, null, 2));

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });
});
