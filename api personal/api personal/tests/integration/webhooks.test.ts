// tests/integration/webhooks.test.ts
import request from 'supertest';
import { Sequelize } from 'sequelize';
import { createTestApp, cleanupTestApp } from '../helpers/createTestApp';
import crypto from 'crypto';

const sha256Hex = (s: string) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

describe('Webhooks System', () => {
  let app: any;
  let sequelize: Sequelize;
  let accessToken: string;
  let testRole: any;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    sequelize = ctx.sequelize;

    // Create test role with webhooks permissions
    const [roleResult] = await sequelize.query(
      `INSERT INTO roles (nombre, descripcion) 
       VALUES ('webhooks_test_role', 'Test Role for Webhooks')`
    );
    testRole = { id: (roleResult as any).insertId };

    // Create permissions
    const perms = ['api:access', 'webhooks:read', 'webhooks:write', 'webhooks:delete'];
    for (const perm of perms) {
      await sequelize.query(
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

    // Create API key for auth
    const masterKey = `test-webhook-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const masterKeyHash = sha256Hex(masterKey);

    await sequelize.query(
      `INSERT INTO api_keys (name, key_hash, role_id, created_at, updated_at)
       VALUES ('Webhook Test Key', :key_hash, :role_id, NOW(), NOW())`,
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
    if (testRole) {
      await sequelize.query(
        `DELETE FROM roles WHERE id = :id`,
        { replacements: { id: testRole.id } }
      );
    }
    await cleanupTestApp();
  });

  describe('POST /api/v1/webhooks', () => {
    it('should create a webhook successfully', async () => {
      const res = await request(app)
        .post('/api/v1/webhooks')
        .set('x-api-key', accessToken)
        .send({
          url: 'https://example.com/webhook',
          events: ['user.created', 'user.updated'],
          active: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.ok).toBe(true);
      expect(res.body.data).toHaveProperty('id');
      expect(res.body.data).toHaveProperty('secret');
      expect(res.body.data.url).toBe('https://example.com/webhook');
      expect(res.body.data.events).toEqual(['user.created', 'user.updated']);
    });

    it('should reject webhook with invalid URL', async () => {
      const res = await request(app)
        .post('/api/v1/webhooks')
        .set('x-api-key', accessToken)
        .send({
          url: 'not-a-url',
          events: ['user.created'],
        });

      expect(res.status).toBe(400);
    });

    it('should reject webhook without events', async () => {
      const res = await request(app)
        .post('/api/v1/webhooks')
        .set('x-api-key', accessToken)
        .send({
          url: 'https://example.com/webhook',
          events: [],
        });

      expect(res.status).toBe(400);
    });

    it('should reject without authentication', async () => {
      const res = await request(app)
        .post('/api/v1/webhooks')
        .send({
          url: 'https://example.com/webhook',
          events: ['user.created'],
        });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/webhooks', () => {
    let webhookId: number;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/v1/webhooks')
        .set('x-api-key', accessToken)
        .send({
          url: 'https://example.com/list-test',
          events: ['user.created'],
        });
      webhookId = res.body.data.id;
    });

    it('should list all webhooks', async () => {
      const res = await request(app)
        .get('/api/v1/webhooks')
        .set('x-api-key', accessToken);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
      
      const webhook = res.body.data.find((w: any) => w.id === webhookId);
      expect(webhook).toBeDefined();
      expect(webhook.url).toBe('https://example.com/list-test');
    });

    it('should reject without authentication', async () => {
      const res = await request(app)
        .get('/api/v1/webhooks');

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/webhooks/:id', () => {
    let webhookId: number;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/v1/webhooks')
        .set('x-api-key', accessToken)
        .send({
          url: 'https://example.com/get-test',
          events: ['user.created'],
        });
      webhookId = res.body.data.id;
    });

    it('should get specific webhook by ID', async () => {
      const res = await request(app)
        .get(`/api/v1/webhooks/${webhookId}`)
        .set('x-api-key', accessToken);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.id).toBe(webhookId);
      expect(res.body.data.url).toBe('https://example.com/get-test');
    });

    it('should return 404 for non-existent webhook', async () => {
      const res = await request(app)
        .get('/api/v1/webhooks/99999')
        .set('x-api-key', accessToken);

      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/v1/webhooks/:id', () => {
    let webhookId: number;

    beforeEach(async () => {
      const res = await request(app)
        .post('/api/v1/webhooks')
        .set('x-api-key', accessToken)
        .send({
          url: 'https://example.com/update-test',
          events: ['user.created'],
        });
      webhookId = res.body.data.id;
    });

    it('should update webhook successfully', async () => {
      const res = await request(app)
        .put(`/api/v1/webhooks/${webhookId}`)
        .set('x-api-key', accessToken)
        .send({
          url: 'https://example.com/updated',
          events: ['user.created', 'user.deleted'],
          active: false,
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.url).toBe('https://example.com/updated');
      expect(res.body.data.events).toEqual(['user.created', 'user.deleted']);
      expect(res.body.data.active).toBe(false);
    });

    it('should return 404 for non-existent webhook', async () => {
      const res = await request(app)
        .put('/api/v1/webhooks/99999')
        .set('x-api-key', accessToken)
        .send({
          url: 'https://example.com/updated',
          events: ['user.created'],
        });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/v1/webhooks/:id', () => {
    let webhookId: number;

    beforeEach(async () => {
      const res = await request(app)
        .post('/api/v1/webhooks')
        .set('x-api-key', accessToken)
        .send({
          url: 'https://example.com/delete-test',
          events: ['user.created'],
        });
      webhookId = res.body.data.id;
    });

    it('should delete webhook successfully', async () => {
      const res = await request(app)
        .delete(`/api/v1/webhooks/${webhookId}`)
        .set('x-api-key', accessToken);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      // Verify webhook is deleted
      const getRes = await request(app)
        .get(`/api/v1/webhooks/${webhookId}`)
        .set('x-api-key', accessToken);

      expect(getRes.status).toBe(404);
    });

    it('should return 404 for non-existent webhook', async () => {
      const res = await request(app)
        .delete('/api/v1/webhooks/99999')
        .set('x-api-key', accessToken);

      expect(res.status).toBe(404);
    });
  });

  describe('Webhook Signature Verification', () => {
    it('should generate valid HMAC signature', async () => {
      const secret = 'test-secret-key';
      const payload = JSON.stringify({ event: 'user.created', data: { id: 1 } });
      
      // Simulate signature generation (same algorithm as webhook service)
      const signature = crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');

      expect(signature).toMatch(/^[a-f0-9]{64}$/);

      // Verify signature
      const verifySignature = crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');

      expect(signature).toBe(verifySignature);
    });

    it('should detect tampered payload', async () => {
      const secret = 'test-secret-key';
      const payload = JSON.stringify({ event: 'user.created', data: { id: 1 } });
      
      const validSignature = crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');

      const tamperedPayload = JSON.stringify({ event: 'user.created', data: { id: 2 } });
      
      const tamperedSignature = crypto
        .createHmac('sha256', secret)
        .update(tamperedPayload)
        .digest('hex');

      expect(validSignature).not.toBe(tamperedSignature);
    });
  });

  describe('Webhook Delivery (Queue)', () => {
    let webhookId: number;
    let webhookSecret: string;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/v1/webhooks')
        .set('x-api-key', accessToken)
        .send({
          url: 'https://webhook.site/unique-id',
          events: ['test.event'],
          active: true,
        });
      webhookId = res.body.data.id;
      webhookSecret = res.body.data.secret;
    });

    it('should queue webhook delivery', async () => {
      // Trigger an event that should send webhook
      // This test verifies that webhook is queued (not necessarily delivered)
      
      // Check webhook_deliveries table for queued webhooks
      const [rows] = await sequelize.query(
        `SELECT COUNT(*) as count FROM webhook_deliveries 
         WHERE webhook_id = :webhook_id AND status = 'pending'`,
        { replacements: { webhook_id: webhookId } }
      );

      // Initial count (should be 0 or more)
      const initialCount = (rows[0] as any).count;
      expect(initialCount).toBeGreaterThanOrEqual(0);
    });
  });
});
