import axios from 'axios'
import { http, ensureCsrfToken } from './client'
import { logError } from '../utils/errors'

const STORAGE_KEY_ACCESS = 'portal.owner.accessToken'
const STORAGE_KEY_REFRESH = 'portal.owner.refreshToken'
const STORAGE_KEY_PERSIST = 'portal.owner.session'
const SAFE_METHODS = new Set(['get', 'head', 'options'])

function getBaseURL() {
  return http.defaults.baseURL || '/api/v1'
}

function readStoredSession() {
  if (typeof window === 'undefined') return { accessToken: null, refreshToken: null, owner: null }
  try {
    const accessToken = window.sessionStorage.getItem(STORAGE_KEY_ACCESS) || null
    // refreshToken en sessionStorage (no en localStorage) para evitar extracción por XSS cross-sesión
    const refreshToken = window.sessionStorage.getItem(STORAGE_KEY_REFRESH) || null
    const raw = window.localStorage.getItem(STORAGE_KEY_PERSIST)
    const owner = raw ? (JSON.parse(raw).owner || null) : null
    return { accessToken, refreshToken, owner }
  } catch (error) {
    logError('portal.readSession', error)
    return { accessToken: null, refreshToken: null, owner: null }
  }
}

function writeStoredSession(session) {
  if (typeof window === 'undefined') return
  if (session?.accessToken) {
    window.sessionStorage.setItem(STORAGE_KEY_ACCESS, session.accessToken)
  } else {
    window.sessionStorage.removeItem(STORAGE_KEY_ACCESS)
  }
  if (session?.refreshToken) {
    window.sessionStorage.setItem(STORAGE_KEY_REFRESH, session.refreshToken)
  } else {
    window.sessionStorage.removeItem(STORAGE_KEY_REFRESH)
  }
  // Solo persistir metadata no sensible en localStorage (owner info para UI)
  window.localStorage.setItem(STORAGE_KEY_PERSIST, JSON.stringify({ owner: session?.owner || null }))
}

function clearStoredSession() {
  if (typeof window === 'undefined') return
  window.sessionStorage.removeItem(STORAGE_KEY_ACCESS)
  window.sessionStorage.removeItem(STORAGE_KEY_REFRESH)
  window.localStorage.removeItem(STORAGE_KEY_PERSIST)
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
  if (!currentSession.accessToken && !currentSession.refreshToken) {
    currentSession = readStoredSession()
  }
  return { ...currentSession }
}

function setSession(session) {
  currentSession = {
    accessToken: session?.accessToken || null,
    refreshToken: session?.refreshToken || null,
    owner: session?.owner || null,
  }
  writeStoredSession(currentSession)
  notifySessionChanged()
  return { ...currentSession }
}

function clearSession() {
  currentSession = { accessToken: null, refreshToken: null, owner: null }
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

portalHttp.interceptors.request.use(async (cfg) => {
  cfg.headers = cfg.headers || {}
  const session = getSession()
  if (session.accessToken) {
    cfg.headers.Authorization = `Bearer ${session.accessToken}`
  }
  return attachCsrf(cfg)
})

async function refreshSession() {
  if (refreshingPromise) return refreshingPromise
  const session = getSession()
  if (!session.refreshToken) {
    throw new Error('No portal refresh token available')
  }

  refreshingPromise = refreshClient
    .post('/portal/auth/refresh', { refreshToken: session.refreshToken })
    .then((response) => {
      const payload = unwrap(response)
      const next = setSession({
        accessToken: payload.accessToken,
        refreshToken: payload.refreshToken || session.refreshToken,
        owner: session.owner,
      })
      return next
    })
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

    if (error.response?.status === 401 && !original._portalRetry && !isAuthRoute) {
      original._portalRetry = true
      try {
        const nextSession = await refreshSession()
        original.headers = original.headers || {}
        original.headers.Authorization = `Bearer ${nextSession.accessToken}`
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
  hasSession: () => Boolean(getSession().accessToken),
  unwrap,
}

export default portalApi
