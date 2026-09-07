'use strict';

/**
 * shared/jwt.js
 * JWT RS256 asimétrico.
 *
 * Configuración de claves (en orden de prioridad):
 *   1. JWT_KEYRING_JSON  (current + claves activas por kid)    ← producción/rotación coordinada
 *   2. JWT_PRIVATE_KEY + JWT_PUBLIC_KEY  (env, PEM o base64)  ← compatibilidad
 *   3. JWT_KEY_FILE  (ruta a archivo PEM con clave privada)    ← staging
 *   4. Par de claves efímero RSA-2048 generado en memoria      ← dev/test
 *
 * En NODE_ENV=production sin JWT_PRIVATE_KEY/JWT_PUBLIC_KEY → error al arrancar.
 */

const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const fs     = require('fs');
const { createLogger } = require('./logger');
const { getSecret } = require('./secrets');

const log = createLogger('jwt');

// ─── Gestión de claves ────────────────────────────────────────────────────────
//
// Key rotation: se soportan DOS pares activos simultáneamente.
//   - Clave ACTUAL  → JWT_PRIVATE_KEY / JWT_PUBLIC_KEY    (firma y verificación)
//   - Clave ANTIGUA → JWT_PRIVATE_KEY_OLD / JWT_PUBLIC_KEY_OLD  (solo verificación, grace period)
//
// Durante la rotación:
//   1. Generar nuevo par RSA-2048
//   2. Renombrar la variable actual a _OLD
//   3. Setear las nuevas variables
//   4. Reiniciar pods gradualmente (rolling deploy)
//   5. Después del grace period (ej: 30 min = TTL del access token), remover _OLD

let _privateKey    = null;
let _publicKey     = null;
let _keyId         = null;
let _verifyKeys    = [];    // [{ kid, publicKey }]

function _normalisePem(raw) {
  if (!raw) return null;
  const text = String(raw);
  if (!text.includes('-----')) return Buffer.from(text, 'base64').toString('utf8');
  return text;
}

function _loadPem(envVar) {
  const raw = getSecret(envVar, { trim: false });
  if (!raw) return null;
  return _normalisePem(raw);
}

function _kidForPublicKey(pubPem) {
  return crypto.createHash('sha256').update(pubPem).digest('hex').slice(0, 16);
}

function _readKeyring() {
  const raw = getSecret('JWT_KEYRING_JSON', { trim: false });
  if (!raw) return null;

  try {
    const jsonText = String(raw).trim().startsWith('{')
      ? raw
      : Buffer.from(raw, 'base64').toString('utf8');
    const parsed = JSON.parse(jsonText);
    const keys = Array.isArray(parsed.keys) ? parsed.keys : [];
    const currentKid = parsed.current || parsed.currentKid || null;

    const normalised = keys.map((entry) => {
      const publicKey = _normalisePem(entry.publicKey || entry.public || entry.pub);
      const privateKey = _normalisePem(entry.privateKey || entry.private || entry.priv);
      if (!publicKey) return null;
      return {
        kid: entry.kid || _kidForPublicKey(publicKey),
        publicKey,
        privateKey,
      };
    }).filter(Boolean);

    if (!normalised.length) return null;
    const current = normalised.find((entry) => entry.kid === currentKid && entry.privateKey)
      || normalised.find((entry) => entry.privateKey);
    if (!current) {
      throw new Error('JWT_KEYRING_JSON must include one signing key with privateKey');
    }

    return { current, keys: normalised };
  } catch (err) {
    log.error('JWT keyring load failed', { error: err.message });
    throw err;
  }
}

function _initKeys() {
  if (_publicKey !== null) return;   // ya inicializadas

  const keyring = _readKeyring();
  if (keyring) {
    _privateKey = keyring.current.privateKey;
    _publicKey = keyring.current.publicKey;
    _keyId = keyring.current.kid;
    _verifyKeys = keyring.keys.map((entry) => ({ kid: entry.kid, publicKey: entry.publicKey }));
    return;
  }

  const privPem = _loadPem('JWT_PRIVATE_KEY');
  const pubPem  = _loadPem('JWT_PUBLIC_KEY');

  if (privPem && pubPem) {
    _privateKey = privPem;
    _publicKey  = pubPem;
    _keyId = _kidForPublicKey(pubPem);
    // Cargar clave anterior si existe (rotación en curso)
    const oldPublicKey = _loadPem('JWT_PUBLIC_KEY_OLD') || null;
    _verifyKeys = [{ kid: _keyId, publicKey: _publicKey }];
    if (oldPublicKey) {
      _verifyKeys.push({ kid: _kidForPublicKey(oldPublicKey), publicKey: oldPublicKey });
    }
    return;
  }

  // Fallback: archivo PEM (staging)
  const keyFile = getSecret('JWT_KEY_FILE');
  if (keyFile) {
    try {
      const privFile = fs.readFileSync(keyFile, 'utf8');
      const keyObj   = crypto.createPrivateKey(privFile);
      const pubObj   = crypto.createPublicKey(keyObj);
      _privateKey = privFile;
      _publicKey  = pubObj.export({ type: 'spki', format: 'pem' });
      _keyId = _kidForPublicKey(_publicKey);
      _verifyKeys = [{ kid: _keyId, publicKey: _publicKey }];
      return;
    } catch (err) {
      log.warn('JWT key file fallback failed', { error: err.message, keyFile });
    }
  }

  // Producción sin claves → error explícito
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'JWT_PRIVATE_KEY y JWT_PUBLIC_KEY deben estar configurados en producción. ' +
      'Generá un par RSA-2048 y asignalo como variables de entorno.'
    );
  }

  // Dev / test → par efímero (generado una sola vez por proceso)
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength:      2048,
    publicKeyEncoding:  { type: 'spki',  format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  _privateKey = privateKey;
  _publicKey  = publicKey;
  _keyId = _kidForPublicKey(publicKey);
  _verifyKeys = [{ kid: _keyId, publicKey }];
}

// ─── Configuración de expiración ──────────────────────────────────────────────

const ACCESS_EXP  = process.env.JWT_ACCESS_EXPIRES  || '15m';
const REFRESH_EXP = process.env.JWT_REFRESH_EXPIRES || '7d';
const PENDING_EXP = process.env.JWT_2FA_PENDING_EXPIRES || '5m';

const TOKEN_TYPES = Object.freeze({
  ACCESS: 'access',
  REFRESH: 'refresh',
  TWO_FACTOR_PENDING: '2fa_pending',
});

// ─── Operaciones de token ─────────────────────────────────────────────────────

/**
 * Firma un access token (RS256).
 * Agrega jti (JWT ID) si el payload no trae uno.
 * @param {object} payload  { userId, orgId, branchId, roles, email, tokenVersion? }
 */
function _signTyped(payload, tokenType, expiresIn) {
  _initKeys();
  return jwt.sign(
    {
      ...payload,
      tokenType,
      jti: payload.jti || crypto.randomBytes(16).toString('hex'),
    },
    _privateKey,
    { expiresIn, algorithm: 'RS256', keyid: _keyId }
  );
}

function signAccess(payload) {
  return _signTyped(payload, TOKEN_TYPES.ACCESS, ACCESS_EXP);
}

/**
 * Firma un refresh token (RS256).
 */
function signRefresh(payload) {
  return _signTyped(payload, TOKEN_TYPES.REFRESH, REFRESH_EXP);
}

/**
 * Firma un token pendiente de completar el segundo factor.
 */
function signPending(payload) {
  return _signTyped(
    { ...payload, scope: TOKEN_TYPES.TWO_FACTOR_PENDING },
    TOKEN_TYPES.TWO_FACTOR_PENDING,
    PENDING_EXP
  );
}

/**
 * Rechaza explícitamente tokens con alg:none o algoritmos simétricos (HS*).
 * Lanza JsonWebTokenError antes de intentar la verificación criptográfica.
 * Esto previene el ataque de "algorithm confusion" donde un atacante cambia
 * el header alg a 'none' o a HS256 para bypassear la firma.
 */
function _rejectUnsafeAlgorithm(token) {
  // Decodificar header sin verificar firma (solo para inspeccionar alg)
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded) throw new jwt.JsonWebTokenError('Token malformado');

  const alg = (decoded.header?.alg || '').toLowerCase();

  // Rechazar alg:none y todos los algoritmos simétricos HMAC
  if (alg === 'none' || alg === '' || alg.startsWith('hs')) {
    throw new jwt.JsonWebTokenError(
      `Algoritmo no permitido: ${decoded.header?.alg || 'none'}. Solo se acepta RS256.`
    );
  }
}

/**
 * Verifica un access token. Lanza si es inválido o expirado.
 * Durante rotación, intenta la clave actual y luego la anterior.
 */
function _verificationOrder(token) {
  _initKeys();
  const decoded = jwt.decode(token, { complete: true });
  const kid = decoded?.header?.kid || null;
  if (!kid) return _verifyKeys.length ? _verifyKeys : [{ kid: _keyId, publicKey: _publicKey }];
  const preferred = _verifyKeys.filter((entry) => entry.kid === kid);
  const fallback = _verifyKeys.filter((entry) => entry.kid !== kid);
  return [...preferred, ...fallback];
}

function _verifyWithKeyring(token) {
  _rejectUnsafeAlgorithm(token);   // protección alg:none antes de verify
  let lastError;
  for (const entry of _verificationOrder(token)) {
    try {
      return jwt.verify(token, entry.publicKey, { algorithms: ['RS256'] });
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

function _verifyTyped(token, expectedType) {
  const decoded = _verifyWithKeyring(token);
  if (decoded.tokenType !== expectedType) {
    throw new jwt.JsonWebTokenError(`Invalid token type: expected ${expectedType}`);
  }
  return decoded;
}

function verifyAccess(token) {
  return _verifyTyped(token, TOKEN_TYPES.ACCESS);
}

/**
 * Verifica un refresh token.
 * Durante rotación, intenta la clave actual y luego la anterior.
 */
function verifyRefresh(token) {
  return _verifyTyped(token, TOKEN_TYPES.REFRESH);
}

/**
 * Verifica un token pendiente de completar 2FA.
 */
function verifyPending(token) {
  return _verifyTyped(token, TOKEN_TYPES.TWO_FACTOR_PENDING);
}

/**
 * Genera un token opaco para refresh tokens almacenados en DB.
 */
function generateOpaqueToken() {
  return crypto.randomBytes(48).toString('hex');
}

/**
 * Hash SHA-256 de un token para almacenamiento seguro.
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Retorna la clave pública PEM actual (para verificación externa).
 */
function getPublicKey() {
  _initKeys();
  return _publicKey;
}

/**
 * Retorna el kid (fingerprint de la clave pública).
 */
function getKeyId() {
  _initKeys();
  return _keyId;
}

/**
 * Genera un JWK (JSON Web Key) a partir de una clave pública PEM.
 */
function _toJwk(pubPem, kid) {
  const keyObject = crypto.createPublicKey(pubPem);
  const jwk = keyObject.export({ format: 'jwk' });
  return { ...jwk, use: 'sig', alg: 'RS256', kid };
}

/**
 * Retorna el JWKS completo con todas las claves activas.
 * Incluye la clave anterior durante rotación (grace period).
 * Compatible con el endpoint /.well-known/jwks.json: res.json(getJwks())
 */
function getJwks() {
  _initKeys();
  const keys = _verifyKeys.map((entry) => _toJwk(entry.publicKey, entry.kid));
  return { keys };
}

/** Alias — retorna un solo JWK (la clave actual). Útil cuando solo se necesita la clave activa. */
function getJwksSet() {
  return getJwks();
}

module.exports = {
  TOKEN_TYPES,
  signAccess,
  signRefresh,
  signPending,
  verifyAccess,
  verifyRefresh,
  verifyPending,
  generateOpaqueToken,
  hashToken,
  getPublicKey,
  getKeyId,
  getJwks,
  getJwksSet,
};
