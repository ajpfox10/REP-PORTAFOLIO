'use strict';

const R = require('./response');

function getTenantContext(req) {
  // SEC: para requests autenticados, el orgId/branchId SIEMPRE viene del JWT (req.user).
  // Los headers x-org-id y x-branch-id solo se aceptan cuando NO hay usuario autenticado
  // (e.g. llamadas internas de servicios sin JWT de usuario).
  // Aceptar los headers de un usuario autenticado permitiría escalada de privilegios
  // hacia otro tenant simplemente enviando un header diferente.
  const fromJwt = req?.user?.orgId || req?.user?.organization_id;
  const fromHeader = req?.headers?.['x-org-id'] || null;

  const orgId = fromJwt != null
    ? fromJwt
    : fromHeader;   // solo para llamadas internas sin JWT de usuario

  const branchFromJwt = req?.user?.branchId || req?.user?.branch_id;
  const branchFromHeader = req?.headers?.['x-branch-id'] || null;

  const branchId = branchFromJwt != null
    ? branchFromJwt
    : (fromJwt != null ? null : branchFromHeader);  // branch header solo si tampoco hay orgId de JWT

  return { orgId: orgId || null, branchId: branchId || null };
}

function scopeParams(req, extra = {}) {
  const { orgId, branchId } = getTenantContext(req);
  return { orgId, branchId, ...extra };
}

function buildOrgScope(alias, column = 'organization_id', paramName = 'orgId') {
  return `${alias}.${column} = :${paramName}`;
}

function buildBranchScope(alias, column = 'branch_id', paramName = 'branchId') {
  return `${alias}.${column} = :${paramName}`;
}

function requireTenantContext({ requireBranch = false } = {}) {
  return (req, res, next) => {
    const { orgId, branchId } = getTenantContext(req);
    if (!orgId) return R.error(res, 403, 'Missing organization scope', null, 'TENANT_001');
    if (requireBranch && !branchId) return R.error(res, 403, 'Missing branch scope', null, 'TENANT_002');
    next();
  };
}

function checkRowTenantAccess(row, req, {
  orgField = 'organization_id',
  branchField = 'branch_id',
  allowSuperadmin = true,
  requireOrg = true,
  requireBranch = false,
} = {}) {
  if (!row) return { ok: false, reason: 'resource_missing' };
  if (allowSuperadmin && req?.user?.roles?.includes('superadmin')) return { ok: true };

  const { orgId, branchId } = getTenantContext(req);
  const rowOrgId = row?.[orgField] ?? row?.orgId ?? null;
  const rowBranchId = row?.[branchField] ?? row?.branchId ?? null;

  if (requireOrg && (orgId === null || orgId === undefined)) {
    return { ok: false, reason: 'missing_org_scope' };
  }
  if (requireOrg && (rowOrgId === null || rowOrgId === undefined)) {
    return { ok: false, reason: 'missing_resource_org_scope' };
  }
  if (rowOrgId !== null && rowOrgId !== undefined && orgId !== null && orgId !== undefined) {
    if (String(rowOrgId) !== String(orgId)) return { ok: false, reason: 'org_mismatch' };
  }

  if (requireBranch && (branchId === null || branchId === undefined)) {
    return { ok: false, reason: 'missing_branch_scope' };
  }

  if (requireBranch && (rowBranchId === null || rowBranchId === undefined)) {
    return { ok: false, reason: 'missing_resource_branch_scope' };
  }

  if (requireBranch && rowBranchId !== null && rowBranchId !== undefined) {
    if (String(rowBranchId) !== String(branchId)) return { ok: false, reason: 'branch_mismatch' };
  }

  return { ok: true };
}

function enforceRowTenantAccess(row, req, res, options = {}) {
  const result = checkRowTenantAccess(row, req, options);
  if (result.ok) return true;
  const code = result.reason === 'resource_missing' ? 'RESOURCE_NOT_FOUND'
    : result.reason.includes('branch') ? 'BRANCH_SCOPE_MISMATCH'
      : 'TENANT_SCOPE_MISMATCH';
  R.error(res, 403, 'Cross-tenant access denied', { reason: result.reason }, code);
  return false;
}

module.exports = {
  getTenantContext,
  scopeParams,
  buildOrgScope,
  buildBranchScope,
  requireTenantContext,
  checkRowTenantAccess,
  enforceRowTenantAccess,
};
