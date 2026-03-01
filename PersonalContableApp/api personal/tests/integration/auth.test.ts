// tests/integration/auth.test.ts
import request from 'supertest';
import { Sequelize } from 'sequelize';
import { createTestApp, cleanupTestApp } from '../helpers/createTestApp';
import { hashPassword } from '../../src/auth/password';
import crypto from 'crypto';

describe('Authentication Flow', () => {
  let app: any;
  let sequelize: Sequelize;
  let testUser: any;
  let testUserPassword = 'Test123456!';

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    sequelize = ctx.sequelize;

    // Create test user
    const passwordHash = await hashPassword(testUserPassword);
    
    // Get or create test role
    const [roleRows] = await sequelize.query(
      `SELECT id FROM roles WHERE nombre = 'test_role' LIMIT 1`
    );
    
    let roleId: number;
    if (!roleRows.length) {
      const [result] = await sequelize.query(
        `INSERT INTO roles (nombre, descripcion) 
         VALUES ('test_role', 'Test Role')`
      );
      roleId = (result as any).insertId;
    } else {
      roleId = (roleRows[0] as any).id;
    }

    const testEmail = `test-auth-${Date.now()}@example.com`;
    const [result] = await sequelize.query(
      `INSERT INTO usuarios (email, nombre, password_hash, rol_id, active, created_at, updated_at) 
       VALUES (:email, 'Test User', :password_hash, :rol_id, 1, NOW(), NOW())`,
      {
        replacements: {
          email: testEmail,
          password_hash: passwordHash,
          rol_id: roleId,
        },
      }
    );

    testUser = {
      id: (result as any).insertId,
      email: testEmail,
      roleId,
    };
  });

  afterAll(async () => {
    // Cleanup test user
    if (testUser) {
      await sequelize.query(
        `DELETE FROM usuarios WHERE id = :id`,
        { replacements: { id: testUser.id } }
      );
    }
    await cleanupTestApp();
  });

  describe('POST /api/v1/auth/login', () => {
    it('should login successfully with valid credentials', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testUser.email,
          password: testUserPassword,
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data).toHaveProperty('accessToken');
      expect(res.body.data).toHaveProperty('refreshToken');
      expect(res.body.data).toHaveProperty('user');
      expect(res.body.data.user.email).toBe(testUser.email);
      expect(res.body.data).toHaveProperty('permissions');
      expect(Array.isArray(res.body.data.permissions)).toBe(true);
    });

    it('should reject login with invalid email', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: testUserPassword,
        });

      expect(res.status).toBe(401);
      expect(res.body.ok).toBe(false);
      expect(res.body.error).toContain('Credenciales inválidas');
    });

    it('should reject login with invalid password', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testUser.email,
          password: 'WrongPassword123!',
        });

      expect(res.status).toBe(401);
      expect(res.body.ok).toBe(false);
      expect(res.body.error).toContain('Credenciales inválidas');
    });

    it('should reject login with missing fields', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testUser.email,
        });

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    });

    it('should reject login with invalid email format', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'not-an-email',
          password: testUserPassword,
        });

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    let accessToken: string;
    let refreshToken: string;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testUser.email,
          password: testUserPassword,
        });

      accessToken = res.body.data.accessToken;
      refreshToken = res.body.data.refreshToken;
    });

    it('should refresh tokens successfully with valid refresh token', async () => {
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({
          refreshToken,
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data).toHaveProperty('accessToken');
      expect(res.body.data).toHaveProperty('refreshToken');
      expect(res.body.data.accessToken).not.toBe(accessToken);
      expect(res.body.data.refreshToken).not.toBe(refreshToken);
    });

    it('should reject refresh with invalid token', async () => {
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({
          refreshToken: 'invalid-token',
        });

      expect(res.status).toBe(401);
      expect(res.body.ok).toBe(false);
    });

    it('should reject refresh with missing token', async () => {
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    });

    it('should detect token reuse', async () => {
      // Get a fresh token pair
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testUser.email,
          password: testUserPassword,
        });

      const token1 = loginRes.body.data.refreshToken;

      // Use it once
      const refreshRes = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: token1 });

      expect(refreshRes.status).toBe(200);

      // Try to reuse the same token - should fail
      const reuseRes = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: token1 });

      expect(reuseRes.status).toBe(401);
      expect(reuseRes.body.ok).toBe(false);
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    let refreshToken: string;

    beforeEach(async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testUser.email,
          password: testUserPassword,
        });

      refreshToken = res.body.data.refreshToken;
    });

    it('should logout successfully and revoke refresh token', async () => {
      const res = await request(app)
        .post('/api/v1/auth/logout')
        .send({ refreshToken });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      // Try to use the revoked token - should fail
      const refreshRes = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken });

      expect(refreshRes.status).toBe(401);
    });

    it('should return success even with invalid token', async () => {
      const res = await request(app)
        .post('/api/v1/auth/logout')
        .send({ refreshToken: 'invalid-token' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('should reject logout with missing token', async () => {
      const res = await request(app)
        .post('/api/v1/auth/logout')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    });
  });

  describe('POST /api/v1/auth/forgot-password', () => {
    it('should return success for existing email', async () => {
      const res = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({
          email: testUser.email,
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.message).toContain('recibirás instrucciones');
    });

    it('should return success for non-existent email (security)', async () => {
      const res = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({
          email: 'nonexistent@example.com',
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('should reject invalid email format', async () => {
      const res = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({
          email: 'not-an-email',
        });

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    });

    it('should create a reset token in database', async () => {
      await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({
          email: testUser.email,
        });

      const [rows] = await sequelize.query(
        `SELECT * FROM password_reset_tokens 
         WHERE usuario_id = :id AND used_at IS NULL AND expires_at > NOW()
         ORDER BY created_at DESC LIMIT 1`,
        { replacements: { id: testUser.id } }
      );

      expect(rows.length).toBeGreaterThan(0);
    });
  });

  describe('POST /api/v1/auth/reset-password', () => {
    let resetToken: string;

    beforeEach(async () => {
      // Generate a reset token
      const tokenPlain = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(tokenPlain, 'utf8').digest('hex');
      
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 1);

      await sequelize.query(
        `INSERT INTO password_reset_tokens (usuario_id, token_hash, expires_at, created_at, updated_at)
         VALUES (:usuario_id, :token_hash, :expires_at, NOW(), NOW())`,
        {
          replacements: {
            usuario_id: testUser.id,
            token_hash: tokenHash,
            expires_at: expiresAt,
          },
        }
      );

      resetToken = tokenPlain;
    });

    it('should reset password successfully with valid token', async () => {
      const newPassword = 'NewPassword123!';

      const res = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({
          token: resetToken,
          newPassword,
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      // Verify can login with new password
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testUser.email,
          password: newPassword,
        });

      expect(loginRes.status).toBe(200);

      // Reset back to original password for other tests
      testUserPassword = newPassword;
    });

    it('should reject invalid reset token', async () => {
      const res = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({
          token: 'invalid-token',
          newPassword: 'NewPassword123!',
        });

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    });

    it('should reject short password', async () => {
      const res = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({
          token: resetToken,
          newPassword: 'short',
        });

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    });

    it('should mark token as used after reset', async () => {
      await request(app)
        .post('/api/v1/auth/reset-password')
        .send({
          token: resetToken,
          newPassword: 'NewPassword123!',
        });

      // Try to reuse the same token
      const res = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({
          token: resetToken,
          newPassword: 'AnotherPassword123!',
        });

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    });
  });
});
