'use strict';

function getRequestHost(req) {
  const forwardedHost = req?.headers?.['x-forwarded-host'];
  const hostHeader = forwardedHost || req?.headers?.host || '';
  return String(hostHeader).split(',')[0].trim().split(':')[0].toLowerCase();
}

function isLocalHost(host) {
  return ['localhost', '127.0.0.1', '::1'].includes(String(host || '').toLowerCase());
}

function isHttpsRequest(req) {
  const forwardedProto = String(req?.headers?.['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  return Boolean(req?.secure) || forwardedProto === 'https';
}

function resolveCookiePolicy(req, {
  sameSite = 'none',
  secureOverride,
} = {}) {
  const normalizedSameSite = ['lax', 'strict', 'none'].includes(String(sameSite).toLowerCase())
    ? String(sameSite).toLowerCase()
    : 'none';

  const host = getRequestHost(req);
  const localHost = isLocalHost(host);
  const secure = typeof secureOverride === 'boolean'
    ? secureOverride
    : (isHttpsRequest(req) || (!localHost && normalizedSameSite === 'none'));

  const effectiveSameSite = !secure && normalizedSameSite === 'none'
    ? 'lax'
    : normalizedSameSite;

  return {
    secure,
    sameSite: effectiveSameSite,
    host,
    localHost,
  };
}

module.exports = {
  resolveCookiePolicy,
  isLocalHost,
  isHttpsRequest,
};
