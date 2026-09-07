'use strict';

/**
 * Subdomain tenant resolver middleware.
 *
 * Extracts the org slug from the subdomain and sets `req.tenantSlug`.
 * The downstream auth middleware already sets orgId from the JWT.
 * This middleware enables:
 *   1. Routing validation — reject tokens used on the wrong subdomain
 *   2. Public routes (e.g. portal login) that need orgId before auth
 *
 * Example:
 *   clinic-peludo.vetmanagerpro.com  →  req.tenantSlug = 'clinic-peludo'
 *   localhost / IP                   →  req.tenantSlug = null (dev mode)
 *
 * To map slug → orgId, the gateway checks Redis cache first, then
 * calls the auth service (internal). Result cached 60 min.
 *
 * Config:
 *   ROOT_DOMAIN  — e.g. "vetmanagerpro.com" (default: skip resolution)
 *   INTERNAL_AUTH_URL — e.g. "http://auth:4051" (for slug→orgId lookup)
 */

const { get: cacheGet, set: cacheSet } = require('../../../shared/cache');
const { callInternalService, buildSignedInternalHeaders } = require('../../../shared/internalService');
const { createLogger } = require('../../../shared/logger');
const _rawCacheTtl = parseInt(process.env.SUBDOMAIN_CACHE_TTL || '3600', 10);
const SLUG_CACHE_TTL = Number.isFinite(_rawCacheTtl) && _rawCacheTtl > 0 ? _rawCacheTtl : 3600;
const log = createLogger('gateway-subdomain');

/**
 * Extract slug from hostname.
 * "clinic-peludo.vetmanagerpro.com" + "vetmanagerpro.com" → "clinic-peludo"
 * Returns null if hostname doesn't match ROOT_DOMAIN or is a bare IP/localhost.
 */
// Sólo se permiten slugs con letras, dígitos y guiones (RFC-1123 label).
// Esto previene cache-key injection y path traversal en la URL interna.
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$|^[a-z0-9]$/i;

function extractSlug(hostname) {
  const rootDomain = process.env.ROOT_DOMAIN || "";
  if (!rootDomain || !hostname) return null;
  if (!hostname.endsWith(`.${rootDomain}`)) return null;
  const slug = hostname.slice(0, -(rootDomain.length + 1));
  // Only single-level slug (no dots) and valid RFC-1123 characters
  if (!slug || slug.includes('.')) return null;
  if (!SLUG_RE.test(slug)) return null;
  return slug;
}

/**
 * Resolve slug → orgId via cache then auth service.
 * Returns null on failure (non-blocking).
 */
async function resolveSlug(slug) {
  const key    = `tenant:slug:${slug}`;
  const cached = await cacheGet(key);
  if (cached) return cached.orgId;

  try {
    const path = `/internal/orgs/by-slug/${encodeURIComponent(slug)}`;
    const res = await callInternalService('auth', {
      method: 'GET',
      path,
      headers: buildSignedInternalHeaders('GET', path, ''),
      traceContext: { traceId: null, spanId: null, serviceName: 'gateway' },
      timeoutMs: 2000,
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.orgId) {
      await cacheSet(key, { orgId: data.orgId }, SLUG_CACHE_TTL);
      return data.orgId;
    }
  } catch (error) {
    log.warn('Subdomain org lookup degraded - continuing', { slug, error: error?.message });
  }
  return null;
}

/**
 * Middleware — attaches `req.tenantSlug` and `req.tenantOrgId`.
 * Blocks with 503 when a subdomain slug is detected but cannot be resolved
 * (auth service down or unknown slug). No-ops on localhost/direct IP.
 */
async function subdomainMiddleware(req, res, next) {
  try {
    const hostname = req.hostname;
    const slug     = extractSlug(hostname);
    req.tenantSlug  = slug;

    if (slug) {
      req.tenantOrgId = await resolveSlug(slug);
      if (!req.tenantOrgId) {
        log.error('Subdomain slug resolved to null — blocking request', {
          slug,
          hostname,
          traceId: req.traceId,
          requestId: req.requestId,
        });
        return res.status(503).json({
          success: false,
          error: { message: 'Tenant temporarily unavailable', code: 'TENANT_UNAVAILABLE' },
        });
      }
    }
  } catch (error) {
    log.error('Subdomain middleware error — blocking request', {
      hostname: req.hostname,
      error: error?.message,
      traceId: req.traceId,
      requestId: req.requestId,
    });
    if (req.tenantSlug) {
      return res.status(503).json({
        success: false,
        error: { message: 'Tenant temporarily unavailable', code: 'TENANT_UNAVAILABLE' },
      });
    }
    req.tenantSlug  = null;
    req.tenantOrgId = null;
  }
  next();
}

/**
 * Express middleware: reject requests where the JWT orgId doesn't match
 * the subdomain's orgId.  Must run AFTER the JWT auth middleware that sets
 * req.user, and AFTER subdomainMiddleware that sets req.tenantOrgId.
 *
 * Skip check when:
 *   - no subdomain detected (localhost / direct IP)
 *   - user is superadmin (cross-org access allowed)
 */
function tenantMismatchGuard(req, res, next) {
  // Subdomain detectado pero no se pudo resolver → bloquear (auth service caído)
  if (req.tenantSlug && !req.tenantOrgId) {
    return res.status(503).json({
      success: false,
      error: { message: 'Tenant resolution temporarily unavailable', code: 'TENANT_UNAVAILABLE' },
    });
  }
  if (!req.tenantOrgId) return next();  // sin subdomain (localhost/IP directo) — ok
  if (!req.user?.orgId) return next();  // sin JWT aún — el auth guard lo rechaza

  if (req.user.roles?.includes('superadmin')) return next();

  if (String(req.user.orgId) !== String(req.tenantOrgId)) {
    return res.status(403).json({
      success: false,
      error: {
        message: 'Token does not belong to this tenant',
        code:    'RBAC_005',
      },
    });
  }
  next();
}

module.exports = { subdomainMiddleware, extractSlug, resolveSlug, tenantMismatchGuard };
