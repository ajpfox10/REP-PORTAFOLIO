import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { authApi } from '../api/auth'
import { clearCsrfToken, ensureCsrfToken } from '../api/client'
import { extractErrorMessage, logError } from '../utils/errors'

const PREVIEW_AUTH_KEY = 'vet_preview_auth'
const IS_DEV_MODE = import.meta.env.DEV || import.meta.env.MODE === 'development'

const PREVIEW_USER = {
  id: 'preview-user',
  name: 'Preview Andromeda',
  email: 'preview@andromeda.local',
  org_id: 1,
  branch_id: 1,
  roles: ['superadmin', 'org_admin'],
  permissions: ['*'],
}

function isPreviewAuthEnabled() {
  if (!IS_DEV_MODE) return false
  return import.meta.env.VITE_PREVIEW_AUTH !== 'false' || localStorage.getItem(PREVIEW_AUTH_KEY) === '1'
}

function decodeBase64Url(value) {
  const normalized = String(value || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(String(value || '').length / 4) * 4, '=')
  return atob(normalized)
}

function parseJwt(token) {
  try {
    return JSON.parse(decodeBase64Url(token.split('.')[1]))
  } catch (error) {
    logError('auth.parseJwt', error)
    return null
  }
}

function normalizeRoles(input) {
  if (!input) return []
  if (Array.isArray(input)) {
    return input
      .map((role) => {
        if (!role) return null
        if (typeof role === 'string') return role.trim()
        if (typeof role === 'object') return String(role.name || role.role || role.value || '').trim()
        return null
      })
      .filter(Boolean)
  }
  if (typeof input === 'string') {
    return input.split(',').map((role) => role.trim()).filter(Boolean)
  }
  return []
}

function normalizePermissions(input) {
  if (!input) return []
  if (Array.isArray(input)) return input.map((permission) => String(permission).trim()).filter(Boolean)
  if (typeof input === 'string') return input.split(',').map((permission) => permission.trim()).filter(Boolean)
  return []
}

function normalizeUser(payload = {}) {
  if (!payload || typeof payload !== 'object') return null
  const normalized = { ...payload }
  normalized.roles = normalizeRoles(payload.roles)
  normalized.permissions = normalizePermissions(payload.permissions)
  return normalized
}

export const useAuthStore = defineStore('auth', () => {
  const accessToken = ref(null)
  const user = ref(null)
  const hydrated = ref(false)
  const hydrating = ref(false)
  let hydratePromise = null

  const isAuthenticated = computed(() => !!accessToken.value)
  const roles = computed(() => normalizeRoles(user.value?.roles))
  const orgId = computed(() => user.value?.org_id || null)

  function hasRole(...check) {
    return check.some((r) => roles.value.includes(r))
  }

  function can(permission) {
    if (roles.value.includes('superadmin')) return true
    const perms = user.value?.permissions || []
    if (perms.includes(permission) || perms.includes('*')) return true
    const [resource] = String(permission || '').split(':')
    return resource ? perms.includes(`${resource}:*`) : false
  }

  function setTokens(at) {
    const payload = parseJwt(at)
    if (payload?.exp && payload.exp * 1000 < Date.now()) {
      logError('auth.setTokens', new Error('Received already-expired access token'))
      return
    }
    accessToken.value = at
    if (payload) user.value = normalizeUser(payload)
  }

  async function bootstrap() {
    if (hydratePromise) return hydratePromise
    hydrating.value = true
    hydratePromise = (async () => {
      try {
        if (isPreviewAuthEnabled()) {
          accessToken.value = 'preview-token'
          user.value = normalizeUser(PREVIEW_USER)
          hydrated.value = true
          return
        }
        const hadSession = localStorage.getItem('vet_session') === '1'
        const isSsoCallback = typeof window !== 'undefined'
          && new URLSearchParams(window.location.search).get('sso') === 'success'
        if (!accessToken.value && (hadSession || isSsoCallback)) {
          try {
            await refresh()
          } catch (error) {
            localStorage.removeItem('vet_session')
            logError('auth.bootstrap.refresh', error)
          }
        }
        hydrated.value = true
      } finally {
        hydrating.value = false
        hydratePromise = null
      }
    })()

    return hydratePromise
  }

  async function login(credentials) {
    const res = await authApi.login(credentials)
    const payload = res.data?.data || res.data
    if (payload.requiresTwoFactor) {
      return { requiresTwoFactor: true, pendingToken: payload.pendingToken }
    }
    setTokens(payload.accessToken)
    localStorage.setItem('vet_session', '1')
    await ensureCsrfToken().catch((error) => {
      logError('auth.login.csrf', error)
    })
    user.value = payload.user ? normalizeUser({ ...user.value, ...payload.user }) : user.value
    await fetchMe().catch((error) => {
      logError('auth.login.fetchMe', error)
    })
    return { requiresTwoFactor: false }
  }

  async function twoFaChallenge(pendingToken, code) {
    const res = await authApi.twoFaChallenge({ pendingToken, code })
    const payload = res.data?.data || res.data
    setTokens(payload.accessToken)
    localStorage.setItem('vet_session', '1')
    await ensureCsrfToken().catch((error) => {
      logError('auth.twoFa.csrf', error)
    })
    await fetchMe().catch((error) => {
      logError('auth.twoFa.fetchMe', error)
    })
  }

  async function refresh() {
    const res = await authApi.refresh()
    const payload = res.data?.data || res.data
    setTokens(payload.accessToken)
    localStorage.setItem('vet_session', '1')
    clearCsrfToken()
    await ensureCsrfToken().catch((error) => {
      logError('auth.refresh.csrf', error)
    })
    await fetchMe({ _noAutoRefresh: true }).catch((error) => {
      logError('auth.refresh.fetchMe', error)
    })
  }

  async function fetchMe(cfg = {}) {
    const res = await authApi.me(cfg)
    const payload = res.data?.data || res.data
    user.value = normalizeUser({ ...user.value, ...payload })
  }

  function clearSession() {
    localStorage.removeItem('vet_session')
    localStorage.removeItem(PREVIEW_AUTH_KEY)
    accessToken.value = null
    user.value = null
    hydrated.value = false
    hydrating.value = false
    hydratePromise = null
    clearCsrfToken()
  }

  async function logout() {
    clearSession()
    try {
      await authApi.logout()
    } catch (error) {
      if (error?.response?.status !== 401) {
        logError('auth.logout', error)
      }
    }
  }

  function getUserFacingError(error, fallback) {
    return extractErrorMessage(error, fallback, { includeRequestId: true })
  }

  const allowedMenu = computed(() => {
    if (isPreviewAuthEnabled()) {
      return [
        { key: 'dashboard', label: 'Inicio', icon: '\u{1F3E0}', to: '/' },
        { key: 'appointments', label: 'Turnos', icon: '\u{1F4C5}', to: '/turnos' },
        { key: 'patients', label: 'Pacientes', icon: '\u{1F43E}', to: '/pacientes' },
        { key: 'medical', label: 'Evoluciones', icon: '\u{1F4CB}', to: '/evoluciones' },
        { key: 'vaccinations', label: 'Vacunas', icon: '\u{1F489}', to: '/vacunas' },
        { key: 'laboratorio', label: 'Laboratorio', icon: '\u{1F9EA}', to: '/laboratorio' },
        { key: 'imagenes', label: 'Imagenes', icon: '\u{1FA7B}', to: '/imagenes' },
        { key: 'patologia', label: 'Patologia', icon: '\u{1F52C}', to: '/patologia' },
        { key: 'cirugias', label: 'Cirugias', icon: '\u{1F52A}', to: '/cirugias' },
        { key: 'hospitalizaciones', label: 'Internados', icon: '\u{1F3E5}', to: '/hospitalizaciones' },
        { key: 'inventory', label: 'Inventario', icon: '\u{1F4E6}', to: '/inventario' },
        { key: 'grooming', label: 'Grooming', icon: '\u2702\uFE0F', to: '/grooming' },
        { key: 'telemedicine', label: 'Telemedicina', icon: '\u{1F4BB}', to: '/telemedicina' },
        { key: 'billing', label: 'Facturacion', icon: '\u{1F4B0}', to: '/facturacion' },
        { key: 'reports', label: 'Reportes', icon: '\u{1F4CA}', to: '/reportes' },
        { key: 'admin', label: 'Administrar', icon: '\u2699\uFE0F', to: '/admin' },
        { key: 'notifications', label: 'Notificaciones', icon: '\u{1F514}', to: '/notificaciones' },
        { key: 'documents', label: 'Documentos', icon: '\u{1F4E8}', to: '/documentos' },
        { key: 'ai', label: 'IA', icon: '\u{1F9E0}', to: '/ai' },
      ]
    }
    const r = roles.value
    const all = r.includes('superadmin') || r.includes('org_admin')

    const items = []

    // OT-107: imaging_tech and api_user added to relevant menu items
    if (all || r.some((x) => ['branch_manager', 'veterinarian', 'vet_technician', 'receptionist', 'tele_vet', 'read_only', 'imaging_tech', 'api_user'].includes(x))) {
      items.push({ key: 'dashboard', label: 'Inicio', icon: '\u{1F3E0}', to: '/' })
    }

    if (all || r.some((x) => ['veterinarian', 'vet_technician', 'receptionist', 'branch_manager', 'tele_vet', 'read_only'].includes(x))) {
      items.push({ key: 'appointments', label: 'Turnos', icon: '\u{1F4C5}', to: '/turnos' })
    }

    if (all || r.some((x) => ['veterinarian', 'vet_technician', 'branch_manager', 'read_only', 'imaging_tech'].includes(x))) {
      items.push({ key: 'patients', label: 'Pacientes', icon: '\u{1F43E}', to: '/pacientes' })
    }

    if (all || r.some((x) => ['veterinarian', 'vet_technician', 'surgeon', 'tele_vet', 'imaging_tech'].includes(x))) {
      items.push({ key: 'medical', label: 'Evoluciones', icon: '\u{1F4CB}', to: '/evoluciones' })
    }

    if (all || r.some((x) => ['veterinarian', 'vet_technician', 'surgeon', 'lab_technician'].includes(x))) {
      items.push({ key: 'vaccinations', label: 'Vacunas', icon: '\u{1F489}', to: '/vacunas' })
    }

    if (all || r.some((x) => ['veterinarian', 'vet_technician', 'lab_technician'].includes(x))) {
      items.push({ key: 'laboratorio', label: 'Laboratorio', icon: '\u{1F9EA}', to: '/laboratorio' })
    }

    if (all || r.some((x) => ['veterinarian', 'vet_technician', 'lab_technician', 'imaging_tech'].includes(x))) {
      items.push({ key: 'imagenes', label: 'Imagenes', icon: '\u{1FA7B}', to: '/imagenes' })
    }

    if (all || r.some((x) => ['veterinarian', 'vet_technician', 'lab_technician', 'imaging_tech'].includes(x))) {
      items.push({ key: 'patologia', label: 'Patologia', icon: '\u{1F52C}', to: '/patologia' })
    }

    if (all || r.some((x) => ['veterinarian', 'surgeon'].includes(x))) {
      items.push({ key: 'cirugias', label: 'Cirugias', icon: '\u{1F52A}', to: '/cirugias' })
    }

    if (all || r.some((x) => ['veterinarian', 'vet_technician', 'branch_manager'].includes(x))) {
      items.push({ key: 'hospitalizaciones', label: 'Internados', icon: '\u{1F3E5}', to: '/hospitalizaciones' })
    }

    if (all || r.some((x) => ['pharmacist', 'accountant', 'branch_manager', 'org_admin'].includes(x))) {
      items.push({ key: 'inventory', label: 'Inventario', icon: '\u{1F4E6}', to: '/inventario' })
    }

    if (all || r.some((x) => ['groomer', 'grooming_manager'].includes(x))) {
      items.push({ key: 'grooming', label: 'Grooming', icon: '\u2702\uFE0F', to: '/grooming' })
    }

    if (all || r.some((x) => ['tele_vet', 'veterinarian'].includes(x))) {
      items.push({ key: 'telemedicine', label: 'Telemedicina', icon: '\u{1F4BB}', to: '/telemedicina' })
    }

    if (all || r.some((x) => ['accountant', 'branch_manager', 'org_admin'].includes(x))) {
      items.push({ key: 'billing', label: 'Facturacion', icon: '\u{1F4B0}', to: '/facturacion' })
    }

    if (all || r.some((x) => ['branch_manager', 'org_admin', 'accountant'].includes(x))) {
      items.push({ key: 'reports', label: 'Reportes', icon: '\u{1F4CA}', to: '/reportes' })
    }

    if (all) {
      items.push({ key: 'admin', label: 'Administrar', icon: '\u2699\uFE0F', to: '/admin' })
    }

    if (all) {
      items.push({ key: 'portal', label: 'Portal', icon: 'P', to: orgId.value ? `/portal?orgId=${orgId.value}` : '/portal' })
    }

    if (all || r.length) {
      items.push({ key: 'notifications', label: 'Notificaciones', icon: '\u{1F514}', to: '/notificaciones' })
    }

    if (all || r.some((x) => ['branch_manager', 'veterinarian', 'vet_technician', 'surgeon', 'lab_technician', 'read_only', 'imaging_tech'].includes(x))) {
      items.push({ key: 'documents', label: 'Documentos', icon: '\u{1F4E8}', to: '/documentos' })
    }

    if (can('ai:use')) {
      items.push({ key: 'ai', label: 'IA', icon: '\u{1F9E0}', to: '/ai' })
    }

    return items
  })

  return {
    accessToken,
    user,
    hydrated,
    hydrating,
    isAuthenticated,
    roles,
    orgId,
    hasRole,
    can,
    login,
    twoFaChallenge,
    refresh,
    fetchMe,
    bootstrap,
    clearSession,
    logout,
    getUserFacingError,
    allowedMenu,
  }
})
