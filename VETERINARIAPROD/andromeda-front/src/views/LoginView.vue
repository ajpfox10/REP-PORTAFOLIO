<template>
  <div class="login-page" data-testid="login-page">
    <section class="login-shell" aria-label="Acceso al sistema">
      <div class="login-brand">
        <AppLogo size="xl" />
        <div class="login-brand__copy">
          <p class="login-brand__eyebrow">Gestión veterinaria modular</p>
          <h1>Operación clínica conectada</h1>
          <p>
            Agenda, pacientes, historia clínica, laboratorio, facturación y administración
            trabajando sobre el mismo contrato de servicios.
          </p>
        </div>

        <div class="login-metrics" aria-hidden="true">
          <div>
            <strong>24/7</strong>
            <span>acceso operativo</span>
          </div>
          <div>
            <strong>API</strong>
            <span>gateway central</span>
          </div>
          <div>
            <strong>RDS</strong>
            <span>datos productivos</span>
          </div>
        </div>
      </div>

      <div class="login-card">
        <div class="login-card__header">
          <p class="login-card__eyebrow">Sistema Andromeda</p>
          <h2>Ingresar</h2>
          <p>{{ t('login.subtitle') }}</p>
        </div>

        <form v-if="step === 'credentials'" @submit.prevent="handleLogin" novalidate>
          <div class="field">
            <label for="email">Correo electrónico</label>
            <input
              id="email"
              data-testid="login-email"
              v-model.trim="form.email"
              type="email"
              placeholder="usuario@veterinaria.com"
              autocomplete="email"
              :disabled="loading"
              required
            />
          </div>

          <div class="field">
            <label for="password">Contraseña</label>
            <div class="field__pwd">
              <input
                id="password"
                data-testid="login-password"
                v-model="form.password"
                :type="showPwd ? 'text' : 'password'"
                placeholder="Contraseña"
                autocomplete="current-password"
                :disabled="loading"
                required
              />
              <button type="button" class="field__eye" @click="showPwd = !showPwd" :aria-label="showPwd ? t('login.hidePassword') : t('login.showPassword')">
                {{ showPwd ? 'Ocultar' : 'Mostrar' }}
              </button>
            </div>
          </div>

          <HCaptchaWidget
            v-if="captchaEnabled"
            ref="loginCaptchaRef"
            :site-key="captchaSiteKey"
            @verified="loginCaptchaToken = $event"
            @expired="loginCaptchaToken = ''"
            @error="loginCaptchaToken = ''"
          />

          <div v-if="error" class="alert alert--error">{{ error }}</div>

          <button type="submit" class="btn-primary" data-testid="login-submit" :disabled="loading || captchaConfigLoading">
            <span v-if="loading" class="spinner" />
            <span v-else>{{ t('login.signIn') }}</span>
          </button>

          <div class="sso-block">
            <p class="sso-block__label">{{ t('login.corpLoginHint') }}</p>
            <div class="sso-block__actions">
              <button type="button" class="btn-ghost" @click="handleSso('google')" :disabled="loading">{{ t('login.ssoGoogle') }}</button>
              <button type="button" class="btn-ghost" @click="handleSso('microsoft')" :disabled="loading">{{ t('login.ssoMicrosoft') }}</button>
            </div>
          </div>

          <div class="login-card__links">
            <button type="button" class="login-card__link" @click="step = 'forgot'">{{ t('login.forgotPassword') }}</button>
          </div>
        </form>

        <form v-else-if="step === 'twofa'" @submit.prevent="handleTwoFa" novalidate>
          <div class="step-header">
            <span class="step-header__icon" aria-hidden="true">2FA</span>
            <h3>{{ t('login.twoFaTitle') }}</h3>
            <p>{{ t('login.twoFaHelp') }}</p>
          </div>

          <div class="field">
            <label for="code">{{ t('login.twoFaCodeLabel') }}</label>
            <input
              id="code"
              v-model.trim="form.code"
              type="text"
              inputmode="numeric"
              pattern="[0-9]*"
              maxlength="6"
              placeholder="000000"
              autocomplete="one-time-code"
              :disabled="loading"
              class="code-input"
              required
            />
          </div>

          <div v-if="error" class="alert alert--error">{{ error }}</div>

          <button type="submit" class="btn-primary" :disabled="loading || form.code.length < 6">
            <span v-if="loading" class="spinner" />
            <span v-else>{{ t('login.verify') }}</span>
          </button>

          <button type="button" class="btn-ghost" @click="step = 'credentials'; error = ''">
            {{ t('login.back') }}
          </button>
        </form>

        <form v-else-if="step === 'forgot'" @submit.prevent="handleForgot" novalidate>
          <div class="step-header">
            <span class="step-header__icon" aria-hidden="true">MAIL</span>
            <h3>{{ t('login.recoverTitle') }}</h3>
            <p>{{ t('login.recoverHelp') }}</p>
          </div>

          <div class="field">
            <label for="reset-email">Correo electrónico</label>
            <input
              id="reset-email"
              v-model.trim="form.email"
              type="email"
              placeholder="usuario@veterinaria.com"
              :disabled="loading"
              required
            />
          </div>

          <HCaptchaWidget
            v-if="captchaEnabled"
            ref="forgotCaptchaRef"
            :site-key="captchaSiteKey"
            @verified="forgotCaptchaToken = $event"
            @expired="forgotCaptchaToken = ''"
            @error="forgotCaptchaToken = ''"
          />

          <div v-if="error" class="alert alert--error">{{ error }}</div>
          <div v-if="success" class="alert alert--success">{{ success }}</div>

          <button type="submit" class="btn-primary" :disabled="loading || captchaConfigLoading">
            <span v-if="loading" class="spinner" />
            <span v-else>{{ t('login.sendLink') }}</span>
          </button>

          <button type="button" class="btn-ghost" @click="step = 'credentials'; error = ''; success = ''">
            {{ t('login.backToLogin') }}
          </button>
        </form>
      </div>
    </section>

    <p class="login-page__copy">© {{ year }} Sistema Andromeda</p>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import AppLogo from '../components/AppLogo.vue'
import HCaptchaWidget from '../components/HCaptchaWidget.vue'
import { t } from '../i18n'
import {
  getCaptchaConfig,
  getLoginError,
  login as loginRequest,
  loginErrorScope,
  requestPasswordReset,
  startSso,
  verifyTwoFactor as verifyTwoFactorRequest,
} from '../composables/auth/useLoginDomain'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

const step = ref('credentials')
const loading = ref(false)
const error = ref('')
const success = ref('')
const showPwd = ref(false)
const pendingToken = ref(null)
const year = new Date().getFullYear()

const form = reactive({ email: '', password: '', code: '' })
const DEFAULT_HCAPTCHA_SITE_KEY = import.meta.env.PROD ? 'ddf45312-6ab8-41cc-b2ee-3a8c1ef668f6' : ''
const captchaSiteKey = ref(import.meta.env.VITE_HCAPTCHA_SITE_KEY || DEFAULT_HCAPTCHA_SITE_KEY)
const captchaEnabled = ref(Boolean(captchaSiteKey.value) && import.meta.env.VITE_CAPTCHA_ENABLED !== 'false')
const captchaConfigLoading = ref(true)
const loginCaptchaToken = ref('')
const forgotCaptchaToken = ref('')
const loginCaptchaRef = ref(null)
const forgotCaptchaRef = ref(null)

function resetLoginCaptcha() {
  loginCaptchaToken.value = ''
  loginCaptchaRef.value?.reset()
}

function resetForgotCaptcha() {
  forgotCaptchaToken.value = ''
  forgotCaptchaRef.value?.reset()
}

function isCaptchaError(error) {
  const message = String(error?.response?.data?.error?.message || error?.message || '')
  const code = String(error?.response?.data?.error?.code || '')
  return code === 'VAL_001' || /captcha/i.test(message)
}

function applyCaptchaConfig(config = {}) {
  const siteKey = String(config.siteKey || '').trim()
  captchaEnabled.value = Boolean(config.enabled && siteKey)
  captchaSiteKey.value = captchaEnabled.value ? siteKey : ''
  resetLoginCaptcha()
  resetForgotCaptcha()
}

async function loadCaptchaConfig() {
  if (captchaSiteKey.value) {
    captchaConfigLoading.value = false
    return
  }

  try {
    const res = await getCaptchaConfig()
    applyCaptchaConfig(res.data?.data || res.data || {})
  } catch (err) {
    loginErrorScope('login.captchaConfig', err)
  } finally {
    captchaConfigLoading.value = false
  }
}

async function handleLogin() {
  error.value = ''
  if (!form.email || !form.password) { error.value = 'Completá el correo y la contraseña.'; return }
  if (captchaEnabled.value && !loginCaptchaToken.value) { error.value = 'Completa el CAPTCHA.'; return }
  loading.value = true
  try {
    const result = await loginRequest(auth, {
      email: form.email,
      password: form.password,
      captchaToken: loginCaptchaToken.value || undefined,
    })
    if (result.requiresTwoFactor) {
      resetLoginCaptcha()
      pendingToken.value = result.pendingToken
      step.value = 'twofa'
    } else {
      router.push('/')
    }
  } catch (e) {
    resetLoginCaptcha()
    const msg = getLoginError(e, 'Error al iniciar sesión')
    if (isCaptchaError(e)) error.value = 'Completa el CAPTCHA para iniciar sesion.'
    else if (e.response?.status === 401) error.value = 'Credenciales incorrectas.'
    else if (e.response?.status === 429) error.value = 'Demasiados intentos. Espera unos minutos.'
    else error.value = msg || 'Error al iniciar sesión'
  } finally {
    loading.value = false
  }
}

async function handleTwoFa() {
  error.value = ''
  loading.value = true
  try {
    await verifyTwoFactorRequest(auth, pendingToken.value, form.code)
    router.push('/')
  } catch (e) {
    error.value = getLoginError(e, 'Código incorrecto')
  } finally {
    loading.value = false
  }
}

async function handleForgot() {
  error.value = ''
  success.value = ''
  if (form.email && captchaEnabled.value && !forgotCaptchaToken.value) { error.value = 'Completa el CAPTCHA.'; return }
  if (!form.email) { error.value = 'Ingresá tu correo electrónico.'; return }
  loading.value = true
  try {
    await requestPasswordReset(form.email, forgotCaptchaToken.value || undefined)
    resetForgotCaptcha()
    success.value = 'Si el correo existe, recibirás el enlace en minutos.'
  } catch (err) {
    resetForgotCaptcha()
    loginErrorScope('login.resetRequest', err, { email: form.email })
    if (isCaptchaError(err)) { error.value = 'Completa el CAPTCHA para recuperar la contrasena.'; return }
    error.value = getLoginError(err, 'No se pudo enviar el correo. Intentá más tarde.')
  } finally {
    loading.value = false
  }
}

function handleSso(provider) {
  error.value = ''
  startSso(provider, form.email)
}

onMounted(() => {
  loadCaptchaConfig()
  if (route.query.sso_error) {
    const ssoErr = String(route.query.sso_error).replace(/[<>"'&]/g, '').slice(0, 200)
    error.value = `SSO: ${ssoErr}`
  }
  if (route.query.sso === 'success') {
    success.value = 'Inicio de sesión corporativo completado.'
  }
})
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 20px;
  background:
    linear-gradient(135deg, rgba(15, 118, 110, 0.08), rgba(37, 99, 235, 0.05)),
    var(--bg);
}

.login-shell {
  width: min(100%, 1080px);
  min-height: 620px;
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(380px, 440px);
  border: 1px solid var(--border);
  border-radius: 18px;
  background: var(--surface);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.login-brand {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 40px;
  padding: 54px;
  color: white;
  background:
    linear-gradient(135deg, rgba(15, 118, 110, 0.96), rgba(30, 64, 175, 0.9)),
    radial-gradient(circle at 20% 20%, rgba(255, 255, 255, 0.24), transparent 28%);
}

.login-brand::after {
  content: "";
  position: absolute;
  inset: auto -90px -110px auto;
  width: 360px;
  height: 360px;
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 50%;
}

.login-brand :deep(.logo__name),
.login-brand :deep(.logo__brand) {
  color: white;
}

.login-brand__copy {
  position: relative;
  z-index: 1;
  max-width: 560px;
}

.login-brand__eyebrow,
.login-card__eyebrow {
  margin: 0 0 12px;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.login-brand h1 {
  margin: 0;
  max-width: 520px;
  font-size: clamp(2.4rem, 5vw, 4.6rem);
  line-height: 0.96;
  letter-spacing: 0;
}

.login-brand p {
  margin-top: 18px;
  max-width: 540px;
  color: rgba(255, 255, 255, 0.82);
  font-size: 1rem;
  line-height: 1.65;
}

.login-metrics {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.login-metrics div {
  padding: 14px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.1);
}

.login-metrics strong,
.login-metrics span {
  display: block;
}

.login-metrics strong {
  font-size: 1.1rem;
  font-weight: 800;
}

.login-metrics span {
  margin-top: 4px;
  font-size: 0.72rem;
  color: rgba(255, 255, 255, 0.72);
}

.login-card {
  padding: 54px 44px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.login-card__header {
  margin-bottom: 28px;
}

.login-card__eyebrow {
  color: var(--primary);
}

.login-card h2 {
  margin: 0;
  font-size: 1.7rem;
  color: var(--text);
}

.login-card__header p {
  margin-top: 8px;
  color: var(--text-3);
  font-size: 0.92rem;
}

.field {
  margin-bottom: 18px;
}

.field label {
  display: block;
  margin-bottom: 7px;
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--text-2);
}

.field input {
  width: 100%;
  min-height: 46px;
  padding: 11px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 0.95rem;
  background: var(--surface);
  transition: border-color var(--transition), box-shadow var(--transition);
}

.field input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 4px rgba(20, 184, 166, 0.18);
  outline: none;
}

.field input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.field__pwd {
  position: relative;
}

.field__pwd input {
  padding-right: 86px;
}

.field__eye {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  min-height: 32px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-2);
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;
}

.field__eye:hover {
  background: var(--surface-2);
}

.code-input {
  text-align: center;
  font-size: 1.7rem !important;
  font-weight: 800;
  letter-spacing: 0.42em;
}

.btn-primary,
.btn-ghost {
  width: 100%;
  min-height: 44px;
  border-radius: var(--radius);
  font-size: 0.92rem;
  font-weight: 800;
  cursor: pointer;
  transition: background var(--transition), border-color var(--transition), color var(--transition), box-shadow var(--transition);
}

.btn-primary {
  margin-top: 8px;
  border: 1px solid var(--primary);
  background: var(--primary);
  color: var(--white);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.btn-primary:hover:not(:disabled) {
  background: var(--primary-hover);
  border-color: var(--primary-hover);
  box-shadow: var(--shadow-sm);
}

.btn-primary:disabled,
.btn-ghost:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-ghost {
  margin-top: 10px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-2);
}

.btn-ghost:hover:not(:disabled) {
  background: var(--surface-2);
  border-color: var(--border-strong);
}

.alert {
  padding: 11px 13px;
  border-radius: var(--radius);
  font-size: 0.88rem;
  margin-bottom: 12px;
}

.alert--error {
  background: var(--danger-light);
  color: var(--danger);
  border-left: 3px solid var(--danger);
}

.alert--success {
  background: var(--success-light);
  color: var(--success);
  border-left: 3px solid var(--success);
}

.login-card__links {
  text-align: center;
  margin-top: 16px;
  font-size: 0.84rem;
}

.login-card__link {
  background: none;
  border: 0;
  padding: 0;
  color: var(--primary);
  cursor: pointer;
  font: inherit;
  font-weight: 700;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.sso-block {
  margin-top: 18px;
  padding-top: 18px;
  border-top: 1px solid var(--border);
}

.sso-block__label {
  margin: 0 0 10px;
  text-align: center;
  font-size: 0.8rem;
  color: var(--text-3);
}

.sso-block__actions {
  display: grid;
  gap: 10px;
}

.step-header {
  text-align: center;
  margin-bottom: 24px;
}

.step-header__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 48px;
  height: 32px;
  margin-bottom: 12px;
  border-radius: 999px;
  background: var(--primary-xlight);
  color: var(--primary);
  font-size: 0.72rem;
  font-weight: 900;
}

.step-header h3 {
  font-size: 1.15rem;
  color: var(--text);
  margin-bottom: 4px;
}

.step-header p {
  font-size: 0.85rem;
  color: var(--text-2);
}

.spinner {
  width: 18px;
  height: 18px;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  display: inline-block;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.login-page__copy {
  margin-top: 18px;
  font-size: 0.76rem;
  color: var(--text-3);
}

@media (max-width: 900px) {
  .login-shell {
    grid-template-columns: 1fr;
    min-height: 0;
  }

  .login-brand {
    padding: 34px;
  }

  .login-brand h1 {
    font-size: 2.35rem;
  }

  .login-metrics {
    display: none;
  }

  .login-card {
    padding: 34px;
  }
}

@media (max-width: 520px) {
  .login-page {
    padding: 14px;
  }

  .login-shell {
    border-radius: var(--radius-lg);
  }

  .login-brand {
    padding: 28px 22px;
  }

  .login-card {
    padding: 28px 22px;
  }
}
</style>
