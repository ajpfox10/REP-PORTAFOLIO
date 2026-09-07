'use strict';

/**
 * shared/digitalSignature.js
 * Firma digital de documentos con RSA-PSS (SHA-256) o Ed25519.
 *
 * Casos de uso:
 *   - Prescripciones digitales
 *   - Facturas AFIP
 *   - Actas de alta/baja
 *   - Consentimientos informados
 *
 * Formato de firma: JSON con { algorithm, keyId, timestamp, signature, payload_hash }
 *
 * La clave privada puede estar en:
 *   - Variable de entorno SIGNING_PRIVATE_KEY (PEM, base64)
 *   - Archivo path SIGNING_KEY_FILE
 *
 * Uso:
 *   const { signDocument, verifyDocument, generateKeyPair } = require('./digitalSignature');
 *   const sig = await signDocument({ type: 'prescription', id: 42, ... });
 *   const ok  = verifyDocument(sig);
 */

const crypto = require('crypto');
const fs     = require('fs');

// ─── Constantes ───────────────────────────────────────────────────────────────

const ALGORITHM_RSA  = 'RSA-PSS';
const ALGORITHM_ED   = 'Ed25519';
const HASH_ALG       = 'sha256';
const SIGNATURE_VER  = '1';

// ─── Gestión de claves ────────────────────────────────────────────────────────

let _privateKey = null;
let _publicKey  = null;

function _loadKeys () {
  if (_privateKey) return;

  // Intento 1: env var SIGNING_PRIVATE_KEY (PEM en base64 o directo)
  if (process.env.SIGNING_PRIVATE_KEY) {
    const pem = process.env.SIGNING_PRIVATE_KEY.includes('-----')
      ? process.env.SIGNING_PRIVATE_KEY
      : Buffer.from(process.env.SIGNING_PRIVATE_KEY, 'base64').toString('utf8');
    _privateKey = crypto.createPrivateKey(pem);
    _publicKey  = crypto.createPublicKey(_privateKey);
    return;
  }

  // Intento 2: archivo
  const keyFile = process.env.SIGNING_KEY_FILE;
  if (keyFile && fs.existsSync(keyFile)) {
    const pem = fs.readFileSync(keyFile, 'utf8');
    _privateKey = crypto.createPrivateKey(pem);
    _publicKey  = crypto.createPublicKey(_privateKey);
    return;
  }

  // En producción, una clave efímera invalidaría todas las firmas tras un reinicio
  // y entre instancias (sin no-repudio real). Abortar explícitamente como en jwt.js.
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'SIGNING_PRIVATE_KEY o SIGNING_KEY_FILE deben estar configurados en producción. ' +
      'Una clave efímera rompe la verificación de firmas (recetas, consentimientos, AFIP).'
    );
  }

  // Fallback: generar par efímero en memoria (solo para dev/test)
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength   : 2048,
    publicKeyEncoding  : { type: 'spki',  format: 'pem' },
    privateKeyEncoding : { type: 'pkcs8', format: 'pem' },
  });
  _privateKey = crypto.createPrivateKey(privateKey);
  _publicKey  = crypto.createPublicKey(publicKey);
}

/**
 * Genera un nuevo par de claves RSA-2048 y devuelve PEM strings.
 * Útil para setup inicial o rotación de claves.
 */
function generateKeyPair () {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength      : 2048,
    publicKeyEncoding  : { type: 'spki',  format: 'pem' },
    privateKeyEncoding : { type: 'pkcs8', format: 'pem' },
  });
  return { privateKey, publicKey };
}

/**
 * Devuelve la clave pública en formato PEM (para compartir con clientes/terceros).
 */
function getPublicKeyPem () {
  _loadKeys();
  return _publicKey.export({ type: 'spki', format: 'pem' });
}

// ─── Firmar ───────────────────────────────────────────────────────────────────

/**
 * Firma un documento.
 * @param {object} document — cualquier objeto JSON serializable
 * @param {object} [opts]
 * @param {string} [opts.signerEmail]   — email del firmante (auditoría)
 * @param {string} [opts.documentType] — tipo: 'prescription','invoice','consent','discharge'
 * @param {string} [opts.documentId]   — ID del documento en DB
 * @returns {object} — { version, algorithm, keyId, timestamp, signerEmail, documentType, documentId, payloadHash, signature }
 */
function signDocument (document, opts = {}) {
  _loadKeys();

  const { signerEmail, documentType, documentId } = opts;

  const timestamp   = new Date().toISOString();
  const canonical   = JSON.stringify(document, Object.keys(document).sort());
  const payloadHash = crypto.createHash(HASH_ALG).update(canonical, 'utf8').digest('hex');

  // Contenido a firmar: hash + timestamp + tipo + id
  const signingInput = `${payloadHash}|${timestamp}|${documentType || ''}|${documentId || ''}`;

  const signature = crypto.sign(HASH_ALG, Buffer.from(signingInput, 'utf8'), {
    key     : _privateKey,
    padding : crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  });

  const keyId = crypto.createHash('sha256')
    .update(getPublicKeyPem())
    .digest('hex')
    .slice(0, 16);  // fingerprint corto

  return {
    version      : SIGNATURE_VER,
    algorithm    : ALGORITHM_RSA,
    keyId,
    timestamp,
    signerEmail  : signerEmail || null,
    documentType : documentType || null,
    documentId   : documentId  || null,
    payloadHash,
    signature    : signature.toString('base64'),
  };
}

/**
 * Verifica una firma creada con `signDocument`.
 * @param {object} document  — el documento original
 * @param {object} signatureObj — objeto retornado por signDocument
 * @returns {{ valid: boolean, reason?: string }}
 */
function verifyDocument (document, signatureObj) {
  _loadKeys();

  try {
    const { timestamp, documentType, documentId, payloadHash, signature } = signatureObj;

    // Verificar hash del payload
    const canonical     = JSON.stringify(document, Object.keys(document).sort());
    const expectedHash  = crypto.createHash(HASH_ALG).update(canonical, 'utf8').digest('hex');
    if (expectedHash !== payloadHash) {
      return { valid: false, reason: 'El contenido del documento fue modificado' };
    }

    // Verificar firma RSA-PSS
    const signingInput = `${payloadHash}|${timestamp}|${documentType || ''}|${documentId || ''}`;
    const isValid = crypto.verify(
      HASH_ALG,
      Buffer.from(signingInput, 'utf8'),
      {
        key       : _publicKey,
        padding   : crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
      },
      Buffer.from(signature, 'base64')
    );

    return isValid
      ? { valid: true }
      : { valid: false, reason: 'Firma inválida' };
  } catch (err) {
    return { valid: false, reason: err.message };
  }
}

/**
 * Genera hash de integridad para un documento (sin firma, solo checksum).
 * Útil para audit trail de documentos sin clave privada.
 */
function hashDocument (document) {
  const canonical = JSON.stringify(document, Object.keys(document).sort());
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

module.exports = {
  generateKeyPair,
  getPublicKeyPem,
  signDocument,
  verifyDocument,
  hashDocument,
};
