import axios from 'axios'
import { useAuthStore } from '../stores/auth'
import { logError } from '../utils/errors'

// Sin VITE_API_URL (Railway single-service) usa URL relativa — el browser la resuelve al mismo origen.
// En dev local con Vite, el proxy de vite.config.js reescribe /api/v1 → gateway:4050.
const API_URL = import.meta.env.VITE_API_URL || '/api/v1'
const DEFAULT_ORIGIN = 'http://localhost:4050'
const API_TIMEOUT_MS = 180000

function getGatewayOrigin() {
  const runtimeOrigin = typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : DEFAULT_ORIGIN

  try {
    return new URL(API_URL, runtimeOrigin).origin
  } catch (error) {
    logError('api.gatewayOrigin', error, { apiUrl: API_URL, runtimeOrigin })
    return runtimeOrigin
  }
}

const SAFE_METHODS = new Set(['get', 'head', 'options'])

let csrfTokenPromise = null
let csrfTokenCache = null
let csrfTokenExpiresAt = 0
const CSRF_TTL_MS = 55 * 60 * 1000 // 55 min (gateway TTL es 1h)

async function fetchCsrfToken() {
  const res = await axios.get(`${getGatewayOrigin()}/csrf-token`, {
    withCredentials: true,
    timeout: API_TIMEOUT_MS,
  })
  const token = res.data?.data?.csrfToken
  if (token) {
    csrfTokenCache = token
    csrfTokenExpiresAt = Date.now() + CSRF_TTL_MS
    return token
  }
  throw new Error('CSRF token missing from gateway response')
}

async function ensureCsrfToken() {
  if (csrfTokenCache && Date.now() < csrfTokenExpiresAt) return csrfTokenCache

  if (!csrfTokenPromise) {
    csrfTokenPromise = fetchCsrfToken().then(
      (token) => { csrfTokenPromise = null; return token },
      (err)   => { csrfTokenPromise = null; throw err }
    )
  }

  return csrfTokenPromise
}

export const http = axios.create({
  baseURL: API_URL,
  withCredentials: true,   // envía cookies (refresh token httpOnly)
  timeout: API_TIMEOUT_MS,
})

// Inyecta el access token en cada request
http.interceptors.request.use(cfg => {
  cfg.headers = cfg.headers || {}
  const auth = useAuthStore()
  const token = auth.accessToken
  if (token) {
    cfg.headers.Authorization = `Bearer ${token}`
  }
  const method = (cfg.method || 'get').toLowerCase()
  if (!SAFE_METHODS.has(method) && !cfg.headers['X-Api-Key'] && !cfg.headers['x-api-key']) {
    return ensureCsrfToken().then(csrfToken => {
      cfg.headers['X-CSRF-Token'] = csrfToken
      return cfg
    })
  }
  return cfg
})

// Si el server devuelve 401, intenta refrescar el token una vez
let refreshing = false
let queue = []

http.interceptors.response.use(
  res => res,
  async err => {
    const original = err.config
    const csrfCode = err.response?.data?.error?.code
    if (original && ['CSRF_MISSING', 'CSRF_INVALID'].includes(csrfCode) && !original._retryCsrf) {
      original._retryCsrf = true
      try {
        const csrfToken = await fetchCsrfToken()
        original.headers = original.headers || {}
        original.headers['X-CSRF-Token'] = csrfToken
        return http(original)
      } catch (csrfError) {
        logError('api.retryCsrf', csrfError, { url: original?.url, method: original?.method })
        return Promise.reject(err)
      }
    }
    const requestUrl = String(original?.url || '').toLowerCase();
    const isAuthEndpoint = requestUrl.includes('/auth/refresh') || requestUrl.includes('/auth/login') || requestUrl.includes('/auth/2fa/challenge');
    if (original && err.response?.status === 401 && !original._retry && !isAuthEndpoint && !original._noAutoRefresh) {
      if (refreshing) {
        return new Promise((resolve, reject) => {
          queue.push({ resolve, reject, config: original })
        })
      }
      original._retry = true
      refreshing = true
      try {
        const auth = useAuthStore()
        await auth.refresh()
        const freshToken = auth.accessToken
        queue.forEach(({ resolve, config }) => {
          config.headers = config.headers || {}
          config.headers.Authorization = `Bearer ${freshToken}`
          config._retry = true   // evita que un 401 posterior dispare otro ciclo de refresh
          resolve(http(config))
        })
        queue = []
        original.headers = original.headers || {}
        original.headers.Authorization = `Bearer ${freshToken}`
        return http(original)
      } catch (refreshError) {
        logError('api.refresh', refreshError, { url: original?.url, method: original?.method })
        queue.forEach(({ reject }) => reject(refreshError))
        queue = []
        const auth = useAuthStore()
        auth.clearSession()
        return Promise.reject(refreshError)
      } finally {
        refreshing = false
      }
    }
    return Promise.reject(err)
  }
)

export function clearCsrfToken() {
  csrfTokenCache = null
  csrfTokenExpiresAt = 0
}

export { ensureCsrfToken }

export default http
