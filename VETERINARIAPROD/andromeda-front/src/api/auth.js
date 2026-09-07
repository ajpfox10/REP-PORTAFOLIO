import http from './client'

const AUTH_BOOTSTRAP_TIMEOUT_MS = 30000

export const authApi = {
  captchaConfig: ()           => http.get('/auth/captcha/config', { timeout: 10000, _noAutoRefresh: true }),
  login:        (data)          => http.post('/auth/login', data),
  twoFaChallenge: (data)        => http.post('/auth/2fa/challenge', data),
  ssoRedirect:  (provider, query = {}) => {
    const params = new URLSearchParams(query).toString()
    const suffix = params ? `?${params}` : ''
    window.location.href = `${http.defaults.baseURL}/auth/sso/${provider}/connect${suffix}`
  },
  refresh:      ()              => http.post('/auth/refresh', {}, { timeout: AUTH_BOOTSTRAP_TIMEOUT_MS, _noAutoRefresh: true }),
  logout:       ()              => http.post('/auth/logout', {}, { _noAutoRefresh: true }),
  me:           (cfg = {})      => http.get('/auth/me', { timeout: AUTH_BOOTSTRAP_TIMEOUT_MS, ...cfg }),
  changePassword: (data)        => http.post('/auth/change-password', data),
  resetRequest: (email, captchaToken) => http.post('/auth/password-reset/request', {
    email,
    captchaToken: captchaToken || undefined,
  }),
  resetConfirm: (data)          => http.post('/auth/password-reset/confirm', data),
}
