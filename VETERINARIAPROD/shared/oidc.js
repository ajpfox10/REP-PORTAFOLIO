'use strict';

const crypto = require('crypto');
const axios = require('axios');

const discoveryCache = new Map();
const jwksCache     = new Map(); // jwks_uri → { keys, expiresAt }

function normalizeProvider(provider) {
  return String(provider || '').trim().toLowerCase();
}

function getSupportedProviders() {
  return ['google', 'microsoft'];
}

function getProviderDefaults(provider) {
  switch (normalizeProvider(provider)) {
    case 'google':
      return {
        issuer: 'https://accounts.google.com',
        scopes: ['openid', 'email', 'profile'],
      };
    case 'microsoft':
      return {
        issuer: 'https://login.microsoftonline.com/common/v2.0',
        scopes: ['openid', 'email', 'profile'],
      };
    default:
      throw new Error(`Unsupported OIDC provider '${provider}'`);
  }
}

function getRedirectUri(provider) {
  const p = normalizeProvider(provider);
  const appUrl = (process.env.APP_URL || process.env.GATEWAY_URL || 'http://localhost:4050').replace(/\/$/, '');
  return `${appUrl}/api/v1/auth/sso/${p}/callback`;
}

function getEnvConfig(provider) {
  const p = normalizeProvider(provider).toUpperCase();
  const defaults = getProviderDefaults(provider);
  return {
    clientId: process.env[`OIDC_${p}_CLIENT_ID`] || process.env[`${p}_CLIENT_ID`] || '',
    clientSecret: process.env[`OIDC_${p}_CLIENT_SECRET`] || process.env[`${p}_CLIENT_SECRET`] || '',
    issuer: process.env[`OIDC_${p}_ISSUER`] || defaults.issuer,
    scopes: (process.env[`OIDC_${p}_SCOPES`] || defaults.scopes.join(' ')).split(/[,\s]+/).filter(Boolean),
  };
}

const DISCOVERY_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora — BUG-018

async function getDiscovery(provider, issuerOverride) {
  const issuer = issuerOverride || getEnvConfig(provider).issuer;
  const cacheKey = `${normalizeProvider(provider)}:${issuer}`;
  const cached = discoveryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data; // BUG-018: TTL de caché

  const url = issuer.endsWith('/.well-known/openid-configuration')
    ? issuer
    : `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
  const { data } = await axios.get(url, { timeout: 10000 });
  discoveryCache.set(cacheKey, { data, expiresAt: Date.now() + DISCOVERY_CACHE_TTL_MS });
  return data;
}

function buildPkcePair() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

async function buildAuthorizationUrl(provider, config) {
  const discovery = await getDiscovery(provider, config.issuer);
  const state = crypto.randomUUID();
  const nonce = crypto.randomUUID();
  const pkce = buildPkcePair();
  const url = new URL(discovery.authorization_endpoint);

  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri || getRedirectUri(provider));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', (config.scopes || []).join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('code_challenge', pkce.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('prompt', 'select_account');

  return { url: url.toString(), state, nonce, verifier: pkce.verifier };
}

async function exchangeCode(provider, config, code, codeVerifier) {
  const discovery = await getDiscovery(provider, config.issuer);
  const payload = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri || getRedirectUri(provider),
    code_verifier: codeVerifier,
  });
  const { data } = await axios.post(discovery.token_endpoint, payload.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 10000,
  });
  return data;
}

function decodeJwtWithoutVerify(token) {
  const parts = String(token || '').split('.');
  if (parts.length < 2) throw new Error('Invalid JWT structure');
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
}

/**
 * Obtiene las claves JWKS del provider con caché de 1 hora.
 */
async function fetchJwks(jwksUri) {
  const cached = jwksCache.get(jwksUri);
  if (cached && cached.expiresAt > Date.now()) return cached.keys;

  const { data } = await axios.get(jwksUri, { timeout: 5000 });
  const keys = data.keys || [];
  jwksCache.set(jwksUri, { keys, expiresAt: Date.now() + 3_600_000 });
  return keys;
}

/**
 * Verifica un ID token OIDC completo:
 *   1. Valida estructura JWT
 *   2. Rechaza algoritmos distintos de RS256
 *   3. Descarga JWKS del provider y verifica la firma RSA
 *   4. Valida claims estándar: exp, iat, iss, aud, nonce
 *
 * @param {string} provider   — 'google' | 'microsoft'
 * @param {object} config     — { clientId, issuer, ... }
 * @param {string} token      — id_token JWT
 * @param {object} [opts]     — { nonce }
 * @returns {object}          — claims verificados
 * @throws                    — si la firma o cualquier claim es inválido
 */
async function verifyIdToken(provider, config, token, { nonce } = {}) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT structure');

  const [headerB64, payloadB64, signatureB64] = parts;

  const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
  if (header.alg !== 'RS256') throw new Error(`Unsupported algorithm: ${header.alg}`);

  const claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));

  // Obtener JWKS del provider via discovery
  const discovery = await getDiscovery(provider, config.issuer);
  const keys = await fetchJwks(discovery.jwks_uri);

  // Seleccionar clave por kid; fallback a primera clave RSA de firma
  const jwk = header.kid
    ? keys.find((k) => k.kid === header.kid)
    : keys.find((k) => k.kty === 'RSA' && (!k.use || k.use === 'sig'));
  if (!jwk) throw new Error(`No JWKS key found for kid="${header.kid}"`);

  // Verificar firma RS256
  const signingInput = Buffer.from(`${headerB64}.${payloadB64}`);
  const signature    = Buffer.from(signatureB64, 'base64url');
  const publicKey    = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const valid        = crypto.verify(
    'SHA256',
    signingInput,
    { key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING },
    signature,
  );
  if (!valid) throw new Error('ID token signature verification failed');

  // Validar claims temporales
  const now = Math.floor(Date.now() / 1000);
  if (!claims.exp || claims.exp < now) throw new Error('ID token expired');
  if (claims.iat && claims.iat > now + 300) throw new Error('ID token issued in the future');

  // Validar issuer — BUG-017: Microsoft /common/ debe validar contra el tenant específico
  const issuer = config.issuer || '';
  if (issuer && issuer.includes('/common/')) {
    // Para /common/, el iss real del token contiene el tenant; validar que sea de Microsoft
    if (!claims.iss || !claims.iss.includes('login.microsoftonline.com')) {
      throw new Error(`Invalid Microsoft issuer: "${claims.iss}"`);
    }
    // Si se configuró un tenant específico, validarlo
    if (config.tenantId && !claims.iss.includes(config.tenantId)) {
      throw new Error(`Microsoft tenant mismatch: expected "${config.tenantId}", got "${claims.iss}"`);
    }
  } else if (issuer) {
    const expectedIss = discovery.issuer || issuer;
    if (claims.iss !== expectedIss) throw new Error(`Invalid issuer: "${claims.iss}"`);
  }

  // Validar audience
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(config.clientId)) {
    throw new Error(`Invalid audience: "${claims.aud}"`);
  }

  // Validar nonce
  if (nonce && claims.nonce !== nonce) throw new Error('Nonce mismatch');

  return claims;
}

module.exports = {
  normalizeProvider,
  getSupportedProviders,
  getProviderDefaults,
  getRedirectUri,
  getEnvConfig,
  getDiscovery,
  buildAuthorizationUrl,
  exchangeCode,
  verifyIdToken,
  decodeJwtWithoutVerify, // conservado para compatibilidad interna — no usar para ID tokens
};
