'use strict';

const {
  getTenantContext,
  scopeParams,
  buildOrgScope,
  buildBranchScope,
  checkRowTenantAccess,
} = require('../../shared/tenantScope');

describe('tenantScope helpers', () => {
  test('extracts org and branch from req.user', () => {
    const req = { user: { orgId: 10, branchId: 20 } };
    expect(getTenantContext(req)).toEqual({ orgId: 10, branchId: 20 });
    expect(scopeParams(req, { foo: 'bar' })).toEqual({ orgId: 10, branchId: 20, foo: 'bar' });
  });

  test('builds reusable SQL scopes', () => {
    expect(buildOrgScope('p')).toBe('p.organization_id = :orgId');
    expect(buildBranchScope('a')).toBe('a.branch_id = :branchId');
  });

  test('detects org mismatch', () => {
    const result = checkRowTenantAccess(
      { organization_id: 2, branch_id: 3 },
      { user: { orgId: 1, branchId: 3, roles: ['org_admin'] } },
      { requireBranch: true }
    );
    expect(result).toEqual({ ok: false, reason: 'org_mismatch' });
  });

  test('detects branch mismatch', () => {
    const result = checkRowTenantAccess(
      { organization_id: 1, branch_id: 99 },
      { user: { orgId: 1, branchId: 3, roles: ['org_admin'] } },
      { requireBranch: true }
    );
    expect(result).toEqual({ ok: false, reason: 'branch_mismatch' });
  });

  test('denies a row without organization scope', () => {
    const result = checkRowTenantAccess(
      { branch_id: 3 },
      { user: { orgId: 1, branchId: 3, roles: [] } },
      { requireBranch: true }
    );
    expect(result).toEqual({ ok: false, reason: 'missing_resource_org_scope' });
  });

  test('denies a row without branch scope when branch is required', () => {
    const result = checkRowTenantAccess(
      { organization_id: 1 },
      { user: { orgId: 1, branchId: 3, roles: [] } },
      { requireBranch: true }
    );
    expect(result).toEqual({ ok: false, reason: 'missing_resource_branch_scope' });
  });
});
