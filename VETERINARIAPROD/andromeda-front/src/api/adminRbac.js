import http from './client'

export const adminRbacApi = {
  listRoles: () => http.get('/auth/admin/rbac/roles'),
  listOverrides: (orgId) => http.get(`/auth/admin/rbac/orgs/${orgId}/overrides`),
  updateOverride: (orgId, role, payload) => http.put(`/auth/admin/rbac/orgs/${orgId}/roles/${role}`, payload),
  deleteOverride: (orgId, role) => http.delete(`/auth/admin/rbac/orgs/${orgId}/roles/${role}`),
}
