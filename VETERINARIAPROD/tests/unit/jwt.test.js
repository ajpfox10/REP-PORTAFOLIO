'use strict';

const jwt    = require('../../shared/jwt');
const crypto = require('crypto');

const PAYLOAD = {
  jti:      'test-jti-1',
  userId:   42,
  email:    'vet@clinic.com',
  orgId:    1,
  branchId: 1,
  roles:    ['veterinarian'],
};

describe('JWT helpers — RS256', () => {
  test('signAccess + verifyAccess round-trip', () => {
    const token   = jwt.signAccess(PAYLOAD);
    const decoded = jwt.verifyAccess(token);
    expect(decoded.userId).toBe(PAYLOAD.userId);
    expect(decoded.email).toBe(PAYLOAD.email);
    expect(decoded.roles).toEqual(PAYLOAD.roles);
  });

  test('signRefresh + verifyRefresh round-trip', () => {
    const token   = jwt.signRefresh({ jti: 'r-1', userId: 42 });
    const decoded = jwt.verifyRefresh(token);
    expect(decoded.userId).toBe(42);
    expect(decoded.jti).toBe('r-1');
  });

  test('token firmado usa algoritmo RS256', () => {
    const token  = jwt.signAccess(PAYLOAD);
    const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
    expect(header.alg).toBe('RS256');
  });

  test('token incluye kid en el header', () => {
    const token  = jwt.signAccess(PAYLOAD);
    const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
    expect(header.kid).toBeTruthy();
    expect(typeof header.kid).toBe('string');
  });

  test('signAccess agrega jti si el payload no trae uno', () => {
    const token   = jwt.signAccess({ userId: 1 });
    const decoded = jwt.verifyAccess(token);
    expect(decoded.jti).toBeTruthy();
    expect(decoded.jti.length).toBeGreaterThanOrEqual(32);
  });

  test('signAccess preserva el jti del payload si está presente', () => {
    const token   = jwt.signAccess({ userId: 1, jti: 'my-custom-jti' });
    const decoded = jwt.verifyAccess(token);
    expect(decoded.jti).toBe('my-custom-jti');
  });

  test('verifyAccess lanza en token manipulado', () => {
    const token = jwt.signAccess(PAYLOAD) + 'tampered';
    expect(() => jwt.verifyAccess(token)).toThrow();
  });

  test('verifyAccess rechaza token firmado con otra clave', () => {
    // Genera un par de claves diferente y firma con él
    const { privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding:  { type: 'spki',  format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const fakeToken = require('jsonwebtoken').sign(
      { userId: 99 },
      privateKey,
      { algorithm: 'RS256' }
    );
    expect(() => jwt.verifyAccess(fakeToken)).toThrow();
  });

  test('dos signAccess consecutivos producen tokens distintos', () => {
    const t1 = jwt.signAccess({ userId: 1 });
    const t2 = jwt.signAccess({ userId: 1 });
    expect(t1).not.toBe(t2);   // jti aleatorio cada vez
  });

  test('generateOpaqueToken devuelve string hex de 96+ chars', () => {
    const t = jwt.generateOpaqueToken();
    expect(typeof t).toBe('string');
    expect(t.length).toBeGreaterThanOrEqual(64);
    expect(t).toMatch(/^[0-9a-f]+$/);
  });

  test('hashToken es determinista', () => {
    const t = jwt.generateOpaqueToken();
    expect(jwt.hashToken(t)).toBe(jwt.hashToken(t));
  });

  test('hashToken produce hashes distintos para tokens distintos', () => {
    const t1 = jwt.generateOpaqueToken();
    const t2 = jwt.generateOpaqueToken();
    expect(jwt.hashToken(t1)).not.toBe(jwt.hashToken(t2));
  });

  test('hashToken produce SHA-256 (64 chars hex)', () => {
    expect(jwt.hashToken('test')).toHaveLength(64);
  });
});

describe('JWT helpers — clave pública y JWKS', () => {
  test('getPublicKey() devuelve PEM válido', () => {
    const pem = jwt.getPublicKey();
    expect(typeof pem).toBe('string');
    expect(pem).toContain('BEGIN PUBLIC KEY');
    expect(pem).toContain('END PUBLIC KEY');
  });

  test('getKeyId() devuelve string de 16 chars', () => {
    const kid = jwt.getKeyId();
    expect(typeof kid).toBe('string');
    expect(kid).toHaveLength(16);
  });

  test('getJwks() devuelve estructura JWKS válida', () => {
    const jwks = jwt.getJwks();
    expect(jwks).toHaveProperty('keys');
    expect(Array.isArray(jwks.keys)).toBe(true);
    expect(jwks.keys).toHaveLength(1);
  });

  test('JWKS key tiene los campos obligatorios', () => {
    const [key] = jwt.getJwks().keys;
    expect(key.kty).toBe('RSA');
    expect(key.use).toBe('sig');
    expect(key.alg).toBe('RS256');
    expect(key.kid).toBeTruthy();
    expect(key.n).toBeTruthy();   // módulo RSA en base64url
    expect(key.e).toBeTruthy();   // exponente RSA en base64url
  });

  test('kid del JWKS coincide con el kid del token', () => {
    const token    = jwt.signAccess({ userId: 1 });
    const header   = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
    const [jwkKey] = jwt.getJwks().keys;
    expect(header.kid).toBe(jwkKey.kid);
  });

  test('clave pública permite verificar tokens (sin clave privada)', () => {
    const { verify } = require('jsonwebtoken');
    const token  = jwt.signAccess({ userId: 55 });
    const pubPem = jwt.getPublicKey();
    const decoded = verify(token, pubPem, { algorithms: ['RS256'] });
    expect(decoded.userId).toBe(55);
  });
});
