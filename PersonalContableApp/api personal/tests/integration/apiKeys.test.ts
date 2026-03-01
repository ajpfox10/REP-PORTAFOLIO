// tests/integration/apiKeys.test.ts
import request from 'supertest';
import { Sequelize } from 'sequelize';
import { createTestApp, cleanupTestApp } from '../helpers/createTestApp';
import crypto from 'crypto';

const sha256Hex = (s: string) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

describe('API Keys Management', () => {
  let app: any;
  let sequelize: Sequelize;
  let testUser: any;
  let accessToken: string;
  let testRole: any;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    sequelize = ctx.sequelize;

    // Create test role with necessary permissions
    const [roleResult] = await sequelize.query(
      `INSERT INTO roles (nombre, descripcion) 
       VALUES ('api_keys_test_role', 'Test Role for API Keys')`
    );
    testRole = { id: (roleResult as any).insertId };

    // Create permissions for API keys management
    const perms = ['api:access', 'apikeys:read', 'apikeys:write', 'apikeys:delete'];
    for (const perm of perms) {
      const [permResult] = await sequelize.query(
        `INSERT IGNORE INTO permisos (clave, descripcion, created_at, updated_at) 
         VALUES (:clave, :clave, NOW(), NOW())`,
        { replacements: { clave: perm } }
      );

      const [permRows] = await sequelize.query(
        `SELECT id FROM permisos WHERE clave = :clave LIMIT 1`,
        { replacements: { clave: perm } }
      );

      const permId = (permRows[0] as any).id;

      await sequelize.query(
        `INSERT IGNORE INTO roles_permisos (rol_id, permiso_id, created_at, updated_at) 
         VALUES (:rol_id, :permiso_id, NOW(), NOW())`,
        { replacements: { rol_id: testRole.id, permiso_id: permId } }
      );
    }

    // Create test user - reuse auth test pattern
    const passwordHash = '$2a$10$XXXXX'; // Dummy hash, won't be used for login
    const testEmail = `test-apikeys-${Date.now()}@example.com`;
    
    const [userResult] = await sequelize.query(
      `INSERT INTO usuarios (email, nombre, password_hash, rol_id, active, created_at, updated_at) 
       VALUES (:email, 'Test User', :password_hash, :rol_id, 1, NOW(), NOW())`,
      {
        replacements: {
          email: testEmail,
          password_hash: passwordHash,
          rol_id: testRole.id,
        },
      }
    );

    testUser = {
      id: (userResult as any).insertId,
      email: testEmail,
      roleId: testRole.id,
    };

    // Get access token (mock approach - create JWT directly or use API key)
    // For simplicity, create an API key that will be used for auth
    const masterKey = `test-master-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const masterKeyHash = sha256Hex(masterKey);

    await sequelize.query(
      `INSERT INTO api_keys (name, key_hash, role_id, created_at, updated_at)
       VALUES ('Test Master Key', :key_hash, :role_id, NOW(), NOW())`,
      {
        replacements: {
          key_hash: masterKeyHash,
          role_id: testRole.id,
        },
      }
    );

    accessToken = masterKey;
  });

  afterAll(async () => {
    // Cleanup
    if (testUser) {
      await sequelize.query(
        `DELETE FROM usuarios WHERE id = :id`,
        { replacements: { id: testUser.id } }
      );
    }
    if (testRole) {
      await sequelize.query(
        `DELETE FROM roles WHERE id = :id`,
        { replacements: { id: testRole.id } }
      );
    }
    await cleanupTestApp();
  });

  describe('POST /api/v1/api-keys', () => {
    it('should create a new API key successfully', async () => {
      const res = await request(app)
        .post('/api/v1/api-keys')
        .set('x-api-key', accessToken)
        .send({
          name: 'Test API Key',
          roleId: testRole.id,
        });

      expect(res.status).toBe(201);
      expect(res.body.ok).toBe(true);
      expect(res.body.data).toHaveProperty('id');
      expect(res.body.data).toHaveProperty('apiKey');
      expect(res.body.data).toHaveProperty('name', 'Test API Key');
      expect(res.body.data.apiKey).toMatch(/^[a-f0-9]{64}$/); // 32 bytes = 64 hex chars
    });

    it('should reject creation without authentication', async () => {
      const res = await request(app)
        .post('/api/v1/api-keys')
        .send({
          name: 'Test API Key',
          roleId: testRole.id,
        });

      expect(res.status).toBe(401);
    });

    it('should reject creation with invalid role ID', async () => {
      const res = await request(app)
        .post('/api/v1/api-keys')
        .set('x-api-key', accessToken)
        .send({
          name: 'Test API Key',
          roleId: 99999,
        });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/v1/api-keys', () => {
    let createdKeyId: number;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/v1/api-keys')
        .set('x-api-key', accessToken)
        .send({
          name: 'List Test Key',
          roleId: testRole.id,
        });
      createdKeyId = res.body.data.id;
    });

    it('should list all API keys', async () => {
      const res = await request(app)
        .get('/api/v1/api-keys')
        .set('x-api-key', accessToken);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
      
      const keys = res.body.data;
      expect(keys.every((k: any) => !k.keyHash)).toBe(true); // Key hash should not be exposed
    });

    it('should reject without authentication', async () => {
      const res = await request(app)
        .get('/api/v1/api-keys');

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/api-keys/:id', () => {
    let testKeyId: number;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/v1/api-keys')
        .set('x-api-key', accessToken)
        .send({
          name: 'Get Test Key',
          roleId: testRole.id,
        });
      testKeyId = res.body.data.id;
    });

    it('should get specific API key by ID', async () => {
      const res = await request(app)
        .get(`/api/v1/api-keys/${testKeyId}`)
        .set('x-api-key', accessToken);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.id).toBe(testKeyId);
      expect(res.body.data.name).toBe('Get Test Key');
      expect(res.body.data).not.toHaveProperty('keyHash');
    });

    it('should return 404 for non-existent key', async () => {
      const res = await request(app)
        .get('/api/v1/api-keys/99999')
        .set('x-api-key', accessToken);

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/v1/api-keys/:id/revoke', () => {
    let keyToRevoke: { id: number; key: string };

    beforeEach(async () => {
      const res = await request(app)
        .post('/api/v1/api-keys')
        .set('x-api-key', accessToken)
        .send({
          name: 'Key To Revoke',
          roleId: testRole.id,
        });
      keyToRevoke = { id: res.body.data.id, key: res.body.data.apiKey };
    });

    it('should revoke an API key successfully', async () => {
      const res = await request(app)
        .delete(`/api/v1/api-keys/${keyToRevoke.id}/revoke`)
        .set('x-api-key', accessToken);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      // Verify the key no longer works
      const testRes = await request(app)
        .get('/api/v1/api-keys')
        .set('x-api-key', keyToRevoke.key);

      expect(testRes.status).toBe(401);
    });

    it('should return 404 for non-existent key', async () => {
      const res = await request(app)
        .delete('/api/v1/api-keys/99999/revoke')
        .set('x-api-key', accessToken);

      expect(res.status).toBe(404);
    });
  });

  describe('API Key Authentication', () => {
    let testApiKey: string;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/v1/api-keys')
        .set('x-api-key', accessToken)
        .send({
          name: 'Auth Test Key',
          roleId: testRole.id,
        });
      testApiKey = res.body.data.apiKey;
    });

    it('should authenticate with valid API key', async () => {
      const res = await request(app)
        .get('/api/v1/api-keys')
        .set('x-api-key', testApiKey);

      expect(res.status).toBe(200);
    });

    it('should reject invalid API key', async () => {
      const res = await request(app)
        .get('/api/v1/api-keys')
        .set('x-api-key', 'invalid-key-123456');

      expect(res.status).toBe(401);
    });

    it('should reject request without API key', async () => {
      const res = await request(app)
        .get('/api/v1/api-keys');

      expect(res.status).toBe(401);
    });
  });

  describe('API Key Permissions', () => {
    it('should respect role permissions', async () => {
      // Create a role without apikeys:write permission
      const [limitedRoleResult] = await sequelize.query(
        `INSERT INTO roles (nombre, descripcion) 
         VALUES ('limited_role', 'Limited Role')`
      );
      const limitedRoleId = (limitedRoleResult as any).insertId;

      // Give only read permission
      const [permRows] = await sequelize.query(
        `SELECT id FROM permisos WHERE clave = 'apikeys:read' LIMIT 1`
      );
      const permId = (permRows[0] as any).id;

      await sequelize.query(
        `INSERT INTO roles_permisos (rol_id, permiso_id, created_at, updated_at) 
         VALUES (:rol_id, :permiso_id, NOW(), NOW())`,
        { replacements: { rol_id: limitedRoleId, permiso_id: permId } }
      );

      // Create API key with limited role
      const limitedKey = `limited-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const limitedKeyHash = sha256Hex(limitedKey);

      await sequelize.query(
        `INSERT INTO api_keys (name, key_hash, role_id, created_at, updated_at)
         VALUES ('Limited Key', :key_hash, :role_id, NOW(), NOW())`,
        {
          replacements: {
            key_hash: limitedKeyHash,
            role_id: limitedRoleId,
          },
        }
      );

      // Should be able to read
      const readRes = await request(app)
        .get('/api/v1/api-keys')
        .set('x-api-key', limitedKey);

      expect(readRes.status).toBe(200);

      // Should not be able to write
      const writeRes = await request(app)
        .post('/api/v1/api-keys')
        .set('x-api-key', limitedKey)
        .send({
          name: 'Unauthorized Key',
          roleId: limitedRoleId,
        });

      expect(writeRes.status).toBe(403);

      // Cleanup
      await sequelize.query(
        `DELETE FROM roles WHERE id = :id`,
        { replacements: { id: limitedRoleId } }
      );
    });
  });
});
