import http from './client'

export const adminUsersApi = {
  list:       (params) => http.get('/auth/admin/users', { params }),
  create:     (data)   => http.post('/auth/admin/users', data),
  deactivate: (id)     => http.patch(`/auth/admin/users/${id}/deactivate`),
  updateRole: (id, role) => http.patch(`/auth/admin/users/${id}/role`, { role }),
  getAuthPolicy: () => http.get('/auth/admin/auth/policy'),
  updateAuthPolicy: (data) => http.patch('/auth/admin/auth/policy', data),
  getLogs:         (params) => http.get('/auth/audit/export', { params }),
  getAlerts:       ()       => http.get('/auth/audit/alerts'),
  getTableList:    ()       => http.get('/auth/admin/preview'),
  getTablePreview: (table)  => http.get(`/auth/admin/preview/${table}`),
  getFeatureFlags: (orgId)  => http.get(`/auth/admin/features/orgs/${orgId}`),
  updateFeatureFlags: (orgId, flags) => http.patch(`/auth/admin/features/orgs/${orgId}`, { flags }),
}
