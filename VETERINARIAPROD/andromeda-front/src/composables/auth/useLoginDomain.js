import { authApi } from '../../api/auth'
import { extractErrorMessage, logError } from '../../utils/errors'

export function getLoginError(error, fallback) {
  return extractErrorMessage(error, fallback, { includeRequestId: true })
}

export async function getCaptchaConfig() {
  return authApi.captchaConfig()
}

export async function login(authStore, credentials) {
  return authStore.login(credentials)
}

export async function verifyTwoFactor(authStore, pendingToken, code) {
  return authStore.twoFaChallenge(pendingToken, code)
}

export async function requestPasswordReset(email, captchaToken) {
  return authApi.resetRequest(email, captchaToken)
}

export async function confirmPasswordReset(token, newPassword) {
  return authApi.resetConfirm({ token, newPassword })
}

export function startSso(provider, email) {
  authApi.ssoRedirect(provider, {
    email: email || '',
    redirectTo: `${window.location.origin}/login?sso=success`,
  })
}

export function loginErrorScope(scope, error, meta) {
  logError(scope, error, meta)
}

export default function useLoginDomain() {
  return {
    login,
    getCaptchaConfig,
    verifyTwoFactor,
    requestPasswordReset,
    confirmPasswordReset,
    startSso,
    getLoginError,
    loginErrorScope,
  }
}
