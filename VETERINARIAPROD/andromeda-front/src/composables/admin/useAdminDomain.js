import { adminRbacApi } from '../../api/adminRbac'
import { adminUsersApi } from '../../api/adminUsers'
import { platformApi } from '../../api/platform'
import { extractErrorMessage } from '../../utils/errors'

export const ADMIN_ROLES = [
  { value: 'org_admin', label: 'Administrador de organizacion' },
  { value: 'branch_manager', label: 'Gerente de sucursal' },
  { value: 'veterinarian', label: 'Veterinario' },
  { value: 'vet_technician', label: 'Tecnico veterinario' },
  { value: 'surgeon', label: 'Cirujano' },
  { value: 'tele_vet', label: 'Veterinario (telemedicina)' },
  { value: 'receptionist', label: 'Recepcionista' },
  { value: 'groomer', label: 'Groomer' },
  { value: 'grooming_manager', label: 'Jefe de grooming' },
  { value: 'pharmacist', label: 'Farmaceutico' },
  { value: 'accountant', label: 'Contador' },
  { value: 'lab_technician', label: 'Tecnico de laboratorio' },
  { value: 'imaging_tech', label: 'Tecnico de imagenes' },
  { value: 'read_only', label: 'Solo lectura' },
]

function unwrapData(response) {
  return response?.data?.data ?? response?.data ?? response
}

export function firstRole(roles) {
  if (!roles) return ''
  return String(roles).split(',')[0]?.trim()
}

export function formatRoleLabel(roles) {
  if (!roles) return ''
  const first = firstRole(roles)
  const found = ADMIN_ROLES.find((role) => role.value === first)
  return found ? found.label : first
}

export function parsePermissions(text) {
  return String(text || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

export function normalizePortalHealth(response) {
  const services = response?.services || response?.data?.services || {}
  const portal = services.portal || {}
  const status = String(portal.status || 'unknown').toLowerCase()
  const statusMap = {
    ok: { label: 'Operativo', statusClass: 'portal-health-card--ok', badgeClass: 'badge--active' },
    ready: { label: 'Listo', statusClass: 'portal-health-card--ok', badgeClass: 'badge--active' },
    degraded: { label: 'Degradado', statusClass: 'portal-health-card--degraded', badgeClass: 'badge--role' },
    error: { label: 'Con error', statusClass: 'portal-health-card--error', badgeClass: 'badge--inactive' },
    unreachable: { label: 'Inalcanzable', statusClass: 'portal-health-card--error', badgeClass: 'badge--inactive' },
    unknown: { label: 'Desconocido', statusClass: 'portal-health-card--unknown', badgeClass: 'badge--role' },
  }
  const mapped = statusMap[status] || statusMap.unknown
  const checks = portal.checks && typeof portal.checks === 'object' ? portal.checks : {}

  return {
    status,
    statusLabel: mapped.label,
    statusClass: mapped.statusClass,
    badgeClass: mapped.badgeClass,
    latency: portal.latency ?? null,
    source: portal.source || '',
    target: portal.target || '',
    checkedAt: response?.ts || new Date().toISOString(),
    checks: Object.entries(checks).map(([name, value]) => ({
      name,
      value: typeof value === 'string'
        ? value
        : Array.isArray(value)
          ? value.join(', ')
          : value && typeof value === 'object'
            ? JSON.stringify(value)
            : String(value),
    })),
  }
}

export async function listUsers(params = {}) {
  const { data } = await adminUsersApi.list(params)
  return {
    rows: data.data || [],
    meta: data.meta || { page: params.page || 1, totalPages: 1 },
  }
}

export async function createAdminUser(payload) {
  return adminUsersApi.create(payload)
}

export async function deactivateAdminUser(id) {
  return adminUsersApi.deactivate(id)
}

export async function updateAdminUserRole(id, role) {
  return adminUsersApi.updateRole(id, role)
}

export async function loadAuthPolicy() {
  const { data } = await adminUsersApi.getAuthPolicy()
  const payload = data?.data || data
  return Boolean(payload?.two_factor_optional_enabled ?? payload?.twoFactorOptionalEnabled)
}

export async function updateAuthPolicy(enabled) {
  return adminUsersApi.updateAuthPolicy({ twoFactorOptionalEnabled: enabled })
}

export async function loadFeatureFlags(orgId) {
  const { data } = await adminUsersApi.getFeatureFlags(orgId)
  const payload = data?.data || {}
  return {
    flags: payload.flags || {},
    definitions: payload.definitions || [],
  }
}

export async function updateFeatureFlags(orgId, flags) {
  const { data } = await adminUsersApi.updateFeatureFlags(orgId, flags)
  return data?.data?.flags || {}
}

export async function loadOverrides(orgId) {
  const [rolesRes, overridesRes] = await Promise.allSettled([
    adminRbacApi.listRoles(),
    adminRbacApi.listOverrides(orgId),
  ])
  if (rolesRes.status === 'rejected' && overridesRes.status === 'rejected') {
    throw rolesRes.reason
  }
  return {
    roleCatalog: rolesRes.status === 'fulfilled' ? (rolesRes.value.data?.data || []) : [],
    overrides: overridesRes.status === 'fulfilled' ? (overridesRes.value.data?.data || []) : [],
  }
}

export async function saveOverride(orgId, role, payload) {
  return adminRbacApi.updateOverride(orgId, role, payload)
}

export async function deleteOverride(orgId, role) {
  return adminRbacApi.deleteOverride(orgId, role)
}

export async function loadLogs() {
  const { data } = await adminUsersApi.getLogs({ limit: 50 })
  return data?.data?.rows || data?.rows || []
}

export async function loadTableList() {
  const { data } = await adminUsersApi.getTableList()
  return data?.data?.tables || []
}

export async function loadTablePreview(tableName) {
  const { data } = await adminUsersApi.getTablePreview(tableName)
  return data?.data || null
}

export async function loadPortalHealth() {
  try {
    return normalizePortalHealth(await platformApi.healthDeep())
  } catch (err) {
    return { error: true, message: err?.message || 'Health check failed' }
  }
}

export function extractAdminError(error, fallback) {
  return extractErrorMessage(error, fallback, { includeRequestId: true })
}

export default function useAdminDomain() {
  return {
    ADMIN_ROLES,
    firstRole,
    formatRoleLabel,
    parsePermissions,
    normalizePortalHealth,
    listUsers,
    createAdminUser,
    deactivateAdminUser,
    updateAdminUserRole,
    loadAuthPolicy,
    updateAuthPolicy,
    loadFeatureFlags,
    updateFeatureFlags,
    loadOverrides,
    saveOverride,
    deleteOverride,
    loadLogs,
    loadTableList,
    loadTablePreview,
    loadPortalHealth,
    extractAdminError,
  }
}
