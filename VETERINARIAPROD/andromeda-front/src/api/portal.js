import axios from 'axios'
import { http, ensureCsrfToken } from './client'
import { logError } from '../utils/errors'

// Los tokens del portal viven en cookies httpOnly que pone el backend: el
// frontend nunca los ve. Acá solo se recuerda si hay sesión y quién es el
// dueño, para pintar la interfaz sin esperar a la red.
const STORAGE_KEY_SESSION = 'portal.owner.session'
const LEGACY_TOKEN_KEYS = ['portal.owner.accessToken', 'portal.owner.refreshToken']
const SAFE_METHODS = new Set(['get', 'head', 'options'])
const EMPTY_SESSION = { authenticated: false, owner: null }

function getBaseURL() {
  return http.defaults.baseURL || '/api/v1'
}

function readStoredSession() {
  if (typeof window === 'undefined') return { ...EMPTY_SESSION }
  try {
    // Limpia tokens que versiones anteriores guardaban en sessionStorage
    LEGACY_TOKEN_KEYS.forEach((key) => window.sessionStorage.removeItem(key))
    const raw = window.localStorage.getItem(STORAGE_KEY_SESSION)
    const parsed = raw ? JSON.parse(raw) : null
    return { authenticated: Boolean(parsed?.authenticated), owner: parsed?.owner || null }
  } catch (error) {
    logError('portal.readSession', error)
    return { ...EMPTY_SESSION }
  }
}

function writeStoredSession(session) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify({ authenticated: Boolean(session?.authenticated), owner: session?.owner || null }))
  } catch (error) {
    logError('portal.writeSession', error)
  }
}

function clearStoredSession() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(STORAGE_KEY_SESSION)
  } catch (error) {
    logError('portal.clearSession', error)
  }
}

let currentSession = readStoredSession()
let refreshingPromise = null
const sessionListeners = new Set()

function notifySessionChanged() {
  const snapshot = { ...currentSession }
  sessionListeners.forEach((listener) => {
    try {
      listener(snapshot)
    } catch (error) {
      logError('portal.sessionListener', error)
    }
  })
}

function subscribeSession(listener) {
  sessionListeners.add(listener)
  return () => sessionListeners.delete(listener)
}

function getSession() {
  return { ...currentSession }
}

function setSession(session) {
  currentSession = {
    authenticated: session?.authenticated !== false,
    owner: session?.owner || currentSession.owner || null,
  }
  writeStoredSession(currentSession)
  notifySessionChanged()
  return { ...currentSession }
}

function clearSession() {
  currentSession = { ...EMPTY_SESSION }
  clearStoredSession()
  notifySessionChanged()
}

function unwrap(response) {
  return response?.data?.data ?? response?.data ?? response
}

const refreshClient = axios.create({
  baseURL: getBaseURL(),
  withCredentials: true,
  timeout: 15000,
})

const portalHttp = axios.create({
  baseURL: getBaseURL(),
  withCredentials: true,
  timeout: 15000,
})

async function attachCsrf(cfg) {
  cfg.headers = cfg.headers || {}
  const method = (cfg.method || 'get').toLowerCase()
  if (!SAFE_METHODS.has(method)) {
    const csrfToken = await ensureCsrfToken()
    cfg.headers['X-CSRF-Token'] = csrfToken
  }
  return cfg
}

refreshClient.interceptors.request.use(attachCsrf)

portalHttp.interceptors.request.use(attachCsrf)

async function refreshSession() {
  if (refreshingPromise) return refreshingPromise
  // El refresh token va solo en su cookie httpOnly
  refreshingPromise = refreshClient
    .post('/portal/auth/refresh', {})
    .then(() => setSession({ authenticated: true }))
    .finally(() => {
      refreshingPromise = null
    })

  return refreshingPromise
}

portalHttp.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config || {}
    const url = String(original.url || '')
    const isAuthRoute = url.includes('/portal/auth/login')
      || url.includes('/portal/auth/register')
      || url.includes('/portal/auth/forgot-password')
      || url.includes('/portal/auth/refresh')
      || url.includes('/portal/auth/logout')

    if (error.response?.status === 401 && !original._portalRetry && !isAuthRoute) {
      original._portalRetry = true
      try {
        await refreshSession()
        return portalHttp(original)
      } catch (refreshError) {
        logError('portal.refresh', refreshError, { url, method: original.method })
        clearSession()
      }
    }

    return Promise.reject(error)
  }
)

export const portalApi = {
  login: (data) => portalHttp.post('/portal/auth/login', data).then(unwrap),
  logout: () => {
    clearSession()
    return refreshClient.post('/portal/auth/logout', {}).then(unwrap)
  },
  register: (data) => portalHttp.post('/portal/auth/register', data).then(unwrap),
  forgotPassword: (data) => portalHttp.post('/portal/auth/forgot-password', data).then(unwrap),
  confirmPasswordReset: (data) => portalHttp.post('/portal/auth/password-reset/confirm', data).then(unwrap),
  me: () => portalHttp.get('/portal/me').then(unwrap),
  updateMe: (data) => portalHttp.put('/portal/me', data).then(unwrap),
  changePassword: (data) => portalHttp.put('/portal/me/password', data).then(unwrap),
  pets: {
    list: () => portalHttp.get('/portal/pets').then(unwrap),
    get: (id) => portalHttp.get(`/portal/pets/${id}`).then(unwrap),
    medicalHistory: (id) => portalHttp.get(`/portal/pets/${id}/medical-history`).then(unwrap),
    vaccinations: (id) => portalHttp.get(`/portal/pets/${id}/vaccinations`).then(unwrap),
    prescriptions: (id) => portalHttp.get(`/portal/pets/${id}/prescriptions`).then(unwrap),
  },
  appointments: {
    list: (params) => portalHttp.get('/portal/appointments', { params }).then(unwrap),
    create: (data) => portalHttp.post('/portal/appointments', data).then(unwrap),
    cancel: (id, reason) => portalHttp.patch(`/portal/appointments/${id}/cancel`, { reason }).then(unwrap),
  },
  invoices: {
    list: (params) => portalHttp.get('/portal/invoices', { params }).then(unwrap),
    get: (id) => portalHttp.get(`/portal/invoices/${id}`).then(unwrap),
    pay: (id, amount) => portalHttp.post(`/portal/invoices/${id}/pay`, amount != null ? { amount } : {}).then(unwrap),
  },
  notifications: {
    list: (params) => portalHttp.get('/portal/notifications', { params }).then(unwrap),
    markRead: (id) => portalHttp.patch(`/portal/notifications/${id}/read`).then(unwrap),
  },
  telemedicine: {
    list: () => portalHttp.get('/portal/telemedicine').then(unwrap),
  },
  fcm: {
    register: (data) => portalHttp.post('/portal/fcm/register', data).then(unwrap),
  },
  refresh: () => refreshSession(),
  getSession,
  setSession,
  clearSession,
  subscribeSession,
  hasSession: () => getSession().authenticated,
  unwrap,
}

export default portalApi
