'use strict';

const DANGEROUS_INCOMING_HEADERS = [
  'x-user-id',
  'x-user-email',
  'x-user-roles',
  'x-user-permissions',
  'x-jti',
  'x-org-id',
  'x-tenant-id',
  'x-branch-id',
  'x-internal-sig',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-forwarded-port',
];

function shouldPreservePublicOrgHint(req) {
  const path = req.originalUrl || req.url || '';
  return /^\/api\/v[12]\/portal\/auth(\/|$)/.test(path);
}

function normalizeOrgHint(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw == null) return null;
  const normalized = String(raw).trim();
  return /^\d+$/.test(normalized) ? normalized : null;
}

function sanitizeIncomingHeaders(req, _res, next) {
  req.clientIp = req.ip || req.socket?.remoteAddress || '';
  if (shouldPreservePublicOrgHint(req)) {
    req.publicOrgIdHint = normalizeOrgHint(req.headers['x-org-id']);
  }
  for (const header of DANGEROUS_INCOMING_HEADERS) {
    delete req.headers[header];
  }
  next();
}

module.exports = {
  sanitizeIncomingHeaders,
  DANGEROUS_INCOMING_HEADERS,
  shouldPreservePublicOrgHint,
  normalizeOrgHint,
};
