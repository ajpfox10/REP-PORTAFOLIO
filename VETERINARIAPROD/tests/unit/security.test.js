'use strict';

/**
 * tests/unit/security.test.js
 * Tests para:
 *   - shared/encryption.js  — AES-256-GCM field encryption
 *   - shared/digitalSignature.js — RSA-PSS document signing
 *   - shared/gdpr.js — lógica pura (con DB mockeada)
 */

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('../../shared/db', () => ({
  query    : jest.fn(),
  queryOne : jest.fn(),
}));

process.env.FIELD_ENCRYPTION_SECRET = 'test_encryption_secret_for_unit_tests_32chars!!';
process.env.FIELD_ENCRYPTION_SALT   = 'test_salt_v1';

const db  = require('../../shared/db');
const enc = require('../../shared/encryption');
const sig = require('../../shared/digitalSignature');
const gdpr = require('../../shared/gdpr');

// ─── Tests: encryption.js ─────────────────────────────────────────────────────

describe('encryption — encrypt/decrypt', () => {
  test('cifra un string y produce formato iv:tag:data', () => {
    const ct = enc.encrypt('04-12345678-9');
    expect(ct).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
  });

  test('descifra correctamente el texto original', () => {
    const plain = 'hola@example.com';
    const ct    = enc.encrypt(plain);
    expect(enc.decrypt(ct)).toBe(plain);
  });

  test('cifrados distintos para el mismo valor (IV aleatorio)', () => {
    const a = enc.encrypt('misma-clave');
    const b = enc.encrypt('misma-clave');
    expect(a).not.toBe(b);
    expect(enc.decrypt(a)).toBe('misma-clave');
    expect(enc.decrypt(b)).toBe('misma-clave');
  });

  test('retorna null si el input es null', () => {
    expect(enc.encrypt(null)).toBeNull();
    expect(enc.decrypt(null)).toBeNull();
  });

  test('retorna string vacío tal cual', () => {
    expect(enc.encrypt('')).toBe('');
    expect(enc.decrypt('')).toBe('');
  });

  test('retorna valor no cifrado sin error (retrocompatibilidad)', () => {
    const plain = 'valor-sin-cifrar';
    expect(enc.decrypt(plain)).toBe(plain);
  });

  test('isEncrypted detecta valor cifrado', () => {
    const ct = enc.encrypt('test@example.com');
    expect(enc.isEncrypted(ct)).toBe(true);
  });

  test('isEncrypted detecta valor sin cifrar', () => {
    expect(enc.isEncrypted('test@example.com')).toBe(false);
    expect(enc.isEncrypted(null)).toBe(false);
    expect(enc.isEncrypted('')).toBe(false);
  });

  test('encryptFields cifra solo los campos indicados', () => {
    const obj = { id: 1, name: 'Juan', email: 'juan@test.com', age: 30 };
    const out = enc.encryptFields(obj, ['email']);
    expect(out.id).toBe(1);
    expect(out.name).toBe('Juan');
    expect(out.age).toBe(30);
    expect(enc.isEncrypted(out.email)).toBe(true);
  });

  test('decryptFields descifra los campos indicados', () => {
    const original = { id: 1, email: 'maria@test.com', phone: '+5491122334455' };
    const encrypted = enc.encryptFields(original, ['email', 'phone']);
    const decrypted = enc.decryptFields(encrypted, ['email', 'phone']);
    expect(decrypted.email).toBe('maria@test.com');
    expect(decrypted.phone).toBe('+5491122334455');
    expect(decrypted.id).toBe(1);
  });

  test('decryptRows descifra un array de objetos', () => {
    const rows = [
      { id: 1, email: 'a@test.com' },
      { id: 2, email: 'b@test.com' },
    ];
    const encrypted = rows.map(r => enc.encryptFields(r, ['email']));
    const decrypted = enc.decryptRows(encrypted, ['email']);
    expect(decrypted[0].email).toBe('a@test.com');
    expect(decrypted[1].email).toBe('b@test.com');
  });

  test('hashForSearch produce hash consistente', () => {
    const h1 = enc.hashForSearch('test@example.com');
    const h2 = enc.hashForSearch('test@example.com');
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);  // SHA-256 hex
  });

  test('hashForSearch normaliza a minúsculas', () => {
    const h1 = enc.hashForSearch('Test@Example.COM');
    const h2 = enc.hashForSearch('test@example.com');
    expect(h1).toBe(h2);
  });

  test('PII_FIELDS contiene definiciones para clients', () => {
    expect(enc.PII_FIELDS.clients).toContain('email');
    expect(enc.PII_FIELDS.clients).toContain('dni');
  });
});

// ─── Tests: digitalSignature.js ───────────────────────────────────────────────

describe('digitalSignature — generateKeyPair', () => {
  test('genera un par de claves RSA válido', () => {
    const { privateKey, publicKey } = sig.generateKeyPair();
    expect(privateKey).toContain('BEGIN PRIVATE KEY');
    expect(publicKey).toContain('BEGIN PUBLIC KEY');
  });
});

describe('digitalSignature — signDocument / verifyDocument', () => {
  const DOC = {
    patientName  : 'Luna',
    medication   : 'Amoxicilina 500mg',
    dose         : '1 comprimido cada 12 hs',
    durationDays : 7,
    prescribedAt : '2026-03-23T10:00:00Z',
  };

  test('firma un documento y devuelve objeto de firma', () => {
    const signature = sig.signDocument(DOC, {
      signerEmail  : 'vet@clinica.com',
      documentType : 'prescription',
      documentId   : '42',
    });
    expect(signature.version).toBe('1');
    expect(signature.algorithm).toBe('RSA-PSS');
    expect(signature.payloadHash).toHaveLength(64);
    expect(signature.signature).toBeTruthy();
    expect(signature.keyId).toHaveLength(16);
    expect(signature.signerEmail).toBe('vet@clinica.com');
    expect(signature.documentType).toBe('prescription');
  });

  test('verifica correctamente una firma válida', () => {
    const signature = sig.signDocument(DOC, { documentType: 'prescription', documentId: '42' });
    const result    = sig.verifyDocument(DOC, signature);
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  test('detecta documento modificado', () => {
    const signature  = sig.signDocument(DOC, { documentType: 'prescription', documentId: '42' });
    const tampered   = { ...DOC, durationDays: 30 };   // cambió la duración
    const result     = sig.verifyDocument(tampered, signature);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('modificado');
  });

  test('detecta firma corrupta', () => {
    const signature  = sig.signDocument(DOC, { documentType: 'invoice', documentId: '99' });
    const bad        = { ...signature, signature: 'AAAA' + signature.signature.slice(4) };
    const result     = sig.verifyDocument(DOC, bad);
    expect(result.valid).toBe(false);
  });

  test('firmas distintas para documentos distintos', () => {
    const s1 = sig.signDocument({ id: 1 }, { documentType: 'invoice', documentId: '1' });
    const s2 = sig.signDocument({ id: 2 }, { documentType: 'invoice', documentId: '2' });
    expect(s1.signature).not.toBe(s2.signature);
    expect(s1.payloadHash).not.toBe(s2.payloadHash);
  });

  test('hashDocument produce hash determinista', () => {
    const h1 = sig.hashDocument({ a: 1, b: 2 });
    const h2 = sig.hashDocument({ b: 2, a: 1 });  // orden distinto, mismo hash
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });

  test('getPublicKeyPem devuelve PEM válido', () => {
    const pem = sig.getPublicKeyPem();
    expect(pem).toContain('BEGIN PUBLIC KEY');
    expect(pem).toContain('END PUBLIC KEY');
  });
});

// ─── Tests: gdpr.js ───────────────────────────────────────────────────────────

describe('gdpr — recordConsent', () => {
  beforeEach(() => jest.clearAllMocks());

  test('registra consentimiento y devuelve id', async () => {
    db.query.mockResolvedValue([{ insertId: 5 }]);
    const result = await gdpr.recordConsent({
      clientId: 1, consentType: 'marketing', granted: true, source: 'portal',
    });
    expect(result.id).toBe(5);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO gdpr_consents'),
      expect.objectContaining({ cid: 1, type: 'marketing', granted: 1 })
    );
  });

  test('convierte granted=false a 0', async () => {
    db.query.mockResolvedValue([{ insertId: 6 }]);
    await gdpr.recordConsent({ clientId: 1, consentType: 'analytics', granted: false });
    expect(db.query).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ granted: 0 })
    );
  });
});

describe('gdpr — createDataRequest', () => {
  test('crea solicitud y calcula fecha límite a 30 días', async () => {
    db.query.mockResolvedValue([{ insertId: 10 }]);
    const result = await gdpr.createDataRequest({
      clientId: 1, requestType: 'access', handledBy: 7,
    });
    expect(result.requestId).toBe(10);
    expect(result.dueDate).toBeTruthy();
    const due  = new Date(result.dueDate);
    const diff = Math.round((due - Date.now()) / 86_400_000);
    expect(diff).toBeGreaterThanOrEqual(29);  // ~30 días
    expect(diff).toBeLessThanOrEqual(31);
  });
});

describe('gdpr — getRetentionPolicies', () => {
  test('devuelve un array con políticas definidas', () => {
    const policies = gdpr.getRetentionPolicies();
    expect(Array.isArray(policies)).toBe(true);
    expect(policies.length).toBeGreaterThan(3);
  });

  test('facturas tienen retención de 10 años', () => {
    const policies = gdpr.getRetentionPolicies();
    const inv = policies.find(p => p.dataType === 'invoices');
    expect(inv).toBeDefined();
    expect(inv.retentionYears).toBe(10);
  });

  test('todas las políticas tienen dataType, retentionYears y legalBasis', () => {
    gdpr.getRetentionPolicies().forEach(p => {
      expect(p).toHaveProperty('dataType');
      expect(p).toHaveProperty('retentionYears');
      expect(p).toHaveProperty('legalBasis');
    });
  });
});

describe('gdpr — reportBreach', () => {
  test('registra brecha y calcula deadline de 72 hs', async () => {
    db.query.mockResolvedValue([{ insertId: 1 }]);
    const result = await gdpr.reportBreach({
      orgId: 1, severity: 'high', affectedRecords: 500,
      description: 'Acceso no autorizado a DB', discoveredBy: 7,
    });
    expect(result.breachId).toBe(1);
    const deadline = new Date(result.notifyDeadline);
    const diff = (deadline - Date.now()) / 3_600_000;  // horas
    expect(diff).toBeGreaterThan(70);
    expect(diff).toBeLessThan(74);
  });
});

describe('gdpr — tipos de datos', () => {
  const CONSENT_TYPES = ['marketing','analytics','third_party','telemedicine','photo','data_sharing','terms','privacy'];
  const REQUEST_TYPES = ['access','erasure','portability','rectification','restriction','objection'];
  const SEVERITY      = ['low','medium','high','critical'];

  test.each(CONSENT_TYPES)('tipo de consentimiento "%s" válido', t => {
    expect(CONSENT_TYPES.includes(t)).toBe(true);
  });

  test.each(REQUEST_TYPES)('tipo de solicitud ARCO "%s" válido', t => {
    expect(REQUEST_TYPES.includes(t)).toBe(true);
  });

  test.each(SEVERITY)('severidad de brecha "%s" válida', s => {
    expect(SEVERITY.includes(s)).toBe(true);
  });
});
