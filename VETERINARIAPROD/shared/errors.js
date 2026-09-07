'use strict';

/**
 * Catálogo unificado de códigos de error para toda la API.
 *
 * Formato de código:  DOMAIN_NNNNN
 * - AUTH_xxxxx   → autenticación y sesiones
 * - RBAC_xxxxx   → permisos y roles
 * - VAL_xxxxx    → validación de input
 * - DB_xxxxx     → base de datos
 * - TENANT_xxxxx → multi-tenant
 * - RATE_xxxxx   → rate limiting / brute force
 * - SVC_xxxxx    → servicios internos
 * - BIZ_xxxxx    → reglas de negocio
 *
 * Uso en un controller:
 *   const { AppError, E } = require('../../../../shared/errors');
 *   throw new AppError(E.AUTH_TOKEN_EXPIRED);
 *
 * Uso en response.js / error handlers:
 *   res.status(err.httpStatus).json({ success: false, error: { message: err.message, code: err.code } });
 */

const CATALOG = {
  // ── Autenticación ──────────────────────────────────────────────────────────
  AUTH_TOKEN_MISSING:       { code: 'AUTH_001', message: 'Authentication token required',          http: 401 },
  AUTH_TOKEN_INVALID:       { code: 'AUTH_002', message: 'Invalid or malformed token',             http: 401 },
  AUTH_TOKEN_EXPIRED:       { code: 'AUTH_003', message: 'Token has expired',                      http: 401 },
  AUTH_TOKEN_REVOKED:       { code: 'AUTH_004', message: 'Token has been revoked',                 http: 401 },
  AUTH_TOKEN_REUSED:        { code: 'AUTH_005', message: 'Refresh token already used — possible token theft. All sessions revoked.', http: 401 },
  AUTH_TOKEN_NOT_FOUND:     { code: 'AUTH_006', message: 'Refresh token not found or expired',     http: 401 },
  AUTH_CREDENTIALS_INVALID: { code: 'AUTH_007', message: 'Invalid email or password',              http: 401 },
  AUTH_ACCOUNT_LOCKED:      { code: 'AUTH_008', message: 'Account locked due to failed attempts',  http: 429 },
  AUTH_2FA_REQUIRED:        { code: 'AUTH_009', message: 'Two-factor authentication required',     http: 401 },
  AUTH_2FA_INVALID:         { code: 'AUTH_010', message: 'Invalid two-factor code',                http: 401 },
  AUTH_2FA_ALREADY_ENABLED: { code: 'AUTH_011', message: 'Two-factor authentication already enabled', http: 409 },
  AUTH_API_KEY_INVALID:     { code: 'AUTH_012', message: 'Invalid API key',                        http: 401 },
  AUTH_SESSION_NOT_FOUND:   { code: 'AUTH_013', message: 'Session not found',                      http: 404 },
  AUTH_PASSWORD_WEAK:       { code: 'AUTH_014', message: 'Password does not meet complexity requirements', http: 400 },
  AUTH_RESET_TOKEN_INVALID: { code: 'AUTH_015', message: 'Password reset token is invalid or expired', http: 400 },

  // ── Permisos / RBAC ───────────────────────────────────────────────────────
  RBAC_FORBIDDEN:           { code: 'RBAC_001', message: 'Insufficient permissions',               http: 403 },
  RBAC_ROLE_NOT_FOUND:      { code: 'RBAC_002', message: 'Role not found',                         http: 404 },
  RBAC_PERMISSION_DENIED:   { code: 'RBAC_003', message: 'Permission denied for this resource',    http: 403 },
  RBAC_BRANCH_MISMATCH:     { code: 'RBAC_004', message: 'Resource belongs to a different branch', http: 403 },
  RBAC_ORG_MISMATCH:        { code: 'RBAC_005', message: 'Resource belongs to a different organization', http: 403 },

  // ── Validación de input ───────────────────────────────────────────────────
  VAL_MISSING_FIELD:        { code: 'VAL_001', message: 'Required field missing',                  http: 400 },
  VAL_INVALID_FORMAT:       { code: 'VAL_002', message: 'Field has invalid format',                http: 400 },
  VAL_INVALID_EMAIL:        { code: 'VAL_003', message: 'Invalid email address',                   http: 400 },
  VAL_INVALID_UUID:         { code: 'VAL_004', message: 'Invalid UUID format',                     http: 400 },
  VAL_INVALID_DATE:         { code: 'VAL_005', message: 'Invalid date format (expected ISO 8601)', http: 400 },
  VAL_INVALID_PAGINATION:   { code: 'VAL_006', message: 'Invalid pagination parameters',           http: 400 },
  VAL_BODY_TOO_LARGE:       { code: 'VAL_007', message: 'Request body exceeds size limit',         http: 413 },
  VAL_INVALID_JSON:         { code: 'VAL_008', message: 'Invalid JSON body',                       http: 400 },
  VAL_NO_FIELDS:            { code: 'VAL_009', message: 'No valid fields provided for update',     http: 400 },

  // ── Base de datos ─────────────────────────────────────────────────────────
  DB_NOT_FOUND:             { code: 'DB_001', message: 'Resource not found',                       http: 404 },
  DB_DUPLICATE:             { code: 'DB_002', message: 'Duplicate entry — resource already exists', http: 409 },
  DB_FK_VIOLATION:          { code: 'DB_003', message: 'Referenced resource not found',            http: 422 },
  DB_TRANSACTION_FAILED:    { code: 'DB_004', message: 'Database transaction failed',              http: 500 },
  DB_CONNECTION_ERROR:      { code: 'DB_005', message: 'Database connection error',                http: 503 },

  // ── Multi-tenant ──────────────────────────────────────────────────────────
  TENANT_NOT_FOUND:         { code: 'TENANT_001', message: 'Tenant not found',                     http: 404 },
  TENANT_INACTIVE:          { code: 'TENANT_002', message: 'Tenant account is inactive',           http: 403 },
  TENANT_PLAN_EXCEEDED:     { code: 'TENANT_003', message: 'Usage limit for your plan exceeded',   http: 429 },
  TENANT_FEATURE_DISABLED:  { code: 'TENANT_004', message: 'This feature is not available on your plan', http: 403 },

  // ── Rate limiting / Brute force ───────────────────────────────────────────
  RATE_TOO_MANY_REQUESTS:   { code: 'RATE_001', message: 'Too many requests — please slow down',  http: 429 },
  RATE_BRUTE_FORCE:         { code: 'RATE_002', message: 'Too many failed attempts — try again later', http: 429 },

  // ── Servicios internos ────────────────────────────────────────────────────
  SVC_UNAVAILABLE:          { code: 'SVC_001', message: 'Service temporarily unavailable',        http: 503 },
  SVC_CIRCUIT_OPEN:         { code: 'SVC_002', message: 'Upstream service circuit open',          http: 503 },
  SVC_TIMEOUT:              { code: 'SVC_003', message: 'Upstream service request timed out',     http: 504 },
  SVC_INTERNAL:             { code: 'SVC_004', message: 'Internal server error',                  http: 500 },

  // ── Reglas de negocio ─────────────────────────────────────────────────────
  BIZ_APPOINTMENT_CONFLICT: { code: 'BIZ_001', message: 'Time slot is already booked',            http: 409 },
  BIZ_PATIENT_INACTIVE:     { code: 'BIZ_002', message: 'Patient is not active',                  http: 422 },
  BIZ_INSUFFICIENT_STOCK:   { code: 'BIZ_003', message: 'Insufficient stock for this operation',  http: 422 },
  BIZ_INVOICE_ALREADY_PAID: { code: 'BIZ_004', message: 'Invoice has already been paid',          http: 409 },
  BIZ_TRANSFER_SAME_BRANCH: { code: 'BIZ_005', message: 'Cannot transfer to the same branch',    http: 422 },
};

/**
 * Error application con código, mensaje y HTTP status integrados.
 *
 * @example
 *   throw new AppError(E.AUTH_TOKEN_EXPIRED);
 *   throw new AppError(E.DB_NOT_FOUND, 'Patient not found');
 *   throw new AppError(E.RBAC_FORBIDDEN, null, { required: 'patients:update' });
 */
class AppError extends Error {
  constructor(entry, customMessage = null, meta = null) {
    super(customMessage || entry.message);
    this.code       = entry.code;
    this.httpStatus = entry.http;
    this.meta       = meta;
    this.isAppError = true;
  }
}

/**
 * Express error handler middleware que convierte AppError a response estándar.
 * Usar DESPUÉS del error handler de DB en serviceBase.js.
 */
function appErrorHandler(err, _req, res, next) {
  if (!err.isAppError) return next(err);
  res.status(err.httpStatus).json({
    success: false,
    error: {
      message: err.message,
      code:    err.code,
      ...(_req?.requestId ? { requestId: _req.requestId } : {}),
      ...(_req?.traceId ? { traceId: _req.traceId } : {}),
      ...(err.meta ? { details: err.meta } : {}),
    },
  });
}

module.exports = { E: CATALOG, AppError, appErrorHandler };
