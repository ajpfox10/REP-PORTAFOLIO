<template>
  <div class="auth-page">
    <section class="auth-page__form">
      <RouterLink to="/" class="auth-page__brand" aria-label="Volver al inicio"><AppLogo size="sm" /></RouterLink>

      <div class="auth-card">
        <h1>Creá la cuenta de tu clínica</h1>
        <p class="auth-card__lead">{{ trialDays }} días gratis con todas las funciones. Sin tarjeta.</p>

        <form novalidate @submit.prevent="submit">
          <div class="field">
            <label for="su-clinic">Nombre de la clínica</label>
            <input id="su-clinic" v-model.trim="form.clinicName" type="text" autocomplete="organization" maxlength="120"
              placeholder="Veterinaria San Roque" :aria-invalid="Boolean(errors.clinicName)" required />
            <span v-if="errors.clinicName" class="field-error">{{ errors.clinicName }}</span>
          </div>

          <div class="field-row">
            <div class="field">
              <label for="su-first">Nombre</label>
              <input id="su-first" v-model.trim="form.firstName" type="text" autocomplete="given-name" maxlength="80"
                :aria-invalid="Boolean(errors.firstName)" required />
              <span v-if="errors.firstName" class="field-error">{{ errors.firstName }}</span>
            </div>
            <div class="field">
              <label for="su-last">Apellido</label>
              <input id="su-last" v-model.trim="form.lastName" type="text" autocomplete="family-name" maxlength="80"
                :aria-invalid="Boolean(errors.lastName)" required />
              <span v-if="errors.lastName" class="field-error">{{ errors.lastName }}</span>
            </div>
          </div>

          <div class="field">
            <label for="su-email">Email de trabajo</label>
            <input id="su-email" v-model.trim="form.email" type="email" autocomplete="email" maxlength="191"
              placeholder="nombre@tuclinica.com" :aria-invalid="Boolean(errors.email)" required />
            <span v-if="errors.email" class="field-error">{{ errors.email }}</span>
          </div>

          <div class="field">
            <label for="su-phone">Teléfono <span class="optional">(opcional)</span></label>
            <input id="su-phone" v-model.trim="form.phone" type="tel" autocomplete="tel" maxlength="40" placeholder="+54 11 5555-5555" />
          </div>

          <div class="field">
            <label for="su-password">Contraseña</label>
            <div class="password">
              <input id="su-password" v-model="form.password" :type="showPassword ? 'text' : 'password'"
                autocomplete="new-password" maxlength="128" :aria-invalid="Boolean(errors.password)"
                aria-describedby="su-password-rules" required />
              <button type="button" class="password__toggle" :aria-label="showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'"
                @click="showPassword = !showPassword">
                <AppIcon :name="showPassword ? 'close' : 'view'" :size="16" />
              </button>
            </div>
            <div class="strength" :class="`strength--${strength.level}`" aria-hidden="true">
              <span v-for="n in 4" :key="n" :class="{ on: n <= strength.score }" />
            </div>
            <ul id="su-password-rules" class="rules">
              <li v-for="rule in passwordRules" :key="rule.label" :class="{ ok: rule.ok }">
                <AppIcon :name="rule.ok ? 'check' : 'close'" :size="13" /> {{ rule.label }}
              </li>
            </ul>
            <span v-if="errors.password" class="field-error">{{ errors.password }}</span>
          </div>

          <label class="check">
            <input v-model="form.isVeterinarian" type="checkbox" />
            <span>Soy veterinario/a y también voy a atender pacientes</span>
          </label>

          <label class="check">
            <input v-model="form.acceptTerms" type="checkbox" :aria-invalid="Boolean(errors.acceptTerms)" />
            <span>Acepto los términos del servicio y la política de privacidad</span>
          </label>
          <span v-if="errors.acceptTerms" class="field-error">{{ errors.acceptTerms }}</span>

          <HCaptchaWidget
            v-if="captchaEnabled"
            ref="captchaRef"
            :site-key="captchaSiteKey"
            @verified="captchaToken = $event"
            @expired="captchaToken = ''"
            @error="captchaToken = ''"
          />

          <div v-if="serverError" class="alert alert--error" role="alert">{{ serverError }}</div>

          <button type="submit" class="submit" :disabled="loading">
            <span v-if="loading" class="spin" aria-hidden="true" />
            {{ loading ? 'Creando tu clínica…' : 'Crear cuenta gratis' }}
          </button>
        </form>

        <p class="auth-card__switch">¿Ya tenés cuenta? <RouterLink to="/login">Iniciá sesión</RouterLink></p>
      </div>
    </section>

    <aside class="auth-page__aside" aria-label="Qué incluye la prueba">
      <div class="aside">
        <h2>Durante la prueba vas a poder</h2>
        <ul>
          <li v-for="item in BENEFITS" :key="item.text">
            <span class="aside__icon"><AppIcon :name="item.icon" :size="18" /></span>
            {{ item.text }}
          </li>
        </ul>
        <p class="aside__note"><AppIcon name="lock" :size="15" /> Tus datos se guardan cifrados y solo los ve tu equipo.</p>
      </div>
    </aside>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppLogo from '../components/AppLogo.vue'
import AppIcon from '../components/AppIcon.vue'
import HCaptchaWidget from '../components/HCaptchaWidget.vue'
import { useAuthStore } from '../stores/auth'
import { useUiFeedbackStore } from '../stores/uiFeedback'
import { authApi } from '../api/auth'
import { getErrorInfo, logError } from '../utils/errors'

const BENEFITS = [
  { icon: 'appointments', text: 'Organizar la agenda de turnos de todo el equipo' },
  { icon: 'evolutions', text: 'Llevar la historia clínica completa de cada paciente' },
  { icon: 'vaccines', text: 'Recibir alertas de vacunas por vencer' },
  { icon: 'billing', text: 'Facturar y cobrar con MercadoPago' },
  { icon: 'reports', text: 'Ver reportes de ingresos y atención' },
]

const router = useRouter()
const auth = useAuthStore()
const feedback = useUiFeedbackStore()

const form = reactive({
  clinicName: '', firstName: '', lastName: '', email: '', phone: '', password: '',
  isVeterinarian: true, acceptTerms: false,
})
const errors = reactive({})
const serverError = ref('')
const loading = ref(false)
const showPassword = ref(false)
const trialDays = ref(14)
const captchaEnabled = ref(false)
const captchaSiteKey = ref('')
const captchaToken = ref('')
const captchaRef = ref(null)

// Mismas reglas que valida el backend (passwordPolicy + regla de contraseña fuerte).
const passwordRules = computed(() => [
  { label: 'Al menos 10 caracteres', ok: form.password.length >= 10 },
  { label: 'Mayúscula y minúscula', ok: /[a-z]/.test(form.password) && /[A-Z]/.test(form.password) },
  { label: 'Un número', ok: /\d/.test(form.password) },
  { label: 'Un símbolo (!@#$…)', ok: /[^A-Za-z0-9]/.test(form.password) },
])

const strength = computed(() => {
  const score = passwordRules.value.filter((rule) => rule.ok).length
  return { score, level: score <= 1 ? 'weak' : score <= 3 ? 'medium' : 'strong' }
})

function validate() {
  for (const key of Object.keys(errors)) delete errors[key]
  if (form.clinicName.length < 2) errors.clinicName = 'Ingresá el nombre de la clínica'
  if (!form.firstName) errors.firstName = 'Ingresá tu nombre'
  if (!form.lastName) errors.lastName = 'Ingresá tu apellido'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errors.email = 'Ingresá un email válido'
  if (!passwordRules.value.every((rule) => rule.ok)) errors.password = 'La contraseña no cumple todos los requisitos'
  if (!form.acceptTerms) errors.acceptTerms = 'Necesitamos que aceptes los términos para crear la cuenta'
  return Object.keys(errors).length === 0
}

async function submit() {
  serverError.value = ''
  if (!validate()) return
  if (captchaEnabled.value && !captchaToken.value) {
    serverError.value = 'Completá la verificación de seguridad.'
    return
  }
  loading.value = true
  try {
    await auth.signup({
      ...form,
      phone: form.phone || undefined,
      captchaToken: captchaToken.value || undefined,
    })
    feedback.success('Ya podés empezar a cargar pacientes y turnos.', { title: '¡Tu clínica está lista!' })
    await router.replace('/')
  } catch (err) {
    const info = getErrorInfo(err, 'No pudimos crear la cuenta. Intentá de nuevo.')
    serverError.value = info.status === 429
      ? 'Se hicieron demasiados registros desde esta red. Esperá un rato e intentá de nuevo.'
      : info.message
    logError('signup.submit', err)
    captchaToken.value = ''
    captchaRef.value?.reset()
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  try {
    const [plansRes, captchaRes] = await Promise.allSettled([authApi.plans(), authApi.captchaConfig()])
    if (plansRes.status === 'fulfilled') {
      const data = plansRes.value.data?.data || plansRes.value.data
      if (data?.trialDays) trialDays.value = data.trialDays
    }
    if (captchaRes.status === 'fulfilled') {
      const config = captchaRes.value.data?.data || captchaRes.value.data || {}
      captchaSiteKey.value = String(config.siteKey || '').trim()
      captchaEnabled.value = Boolean(config.enabled && captchaSiteKey.value)
    }
  } catch (err) {
    logError('signup.init', err)
  }
})
</script>

<style scoped>
.auth-page {
  min-height: 100vh;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 0.85fr);
  background: var(--bg);
}

.auth-page__form {
  display: flex;
  flex-direction: column;
  padding: 28px 40px 48px;
}

.auth-page__brand {
  color: inherit;
  align-self: flex-start;
}

.auth-card {
  width: min(460px, 100%);
  margin: 40px auto 0;
}

.auth-card h1 {
  font-size: 1.7rem;
  letter-spacing: -0.03em;
  line-height: 1.2;
}

.auth-card__lead {
  margin: 8px 0 28px;
  color: var(--text-2);
}

form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.field {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field label {
  font-size: 0.86rem;
  font-weight: 600;
  color: var(--text);
}

.field input {
  width: 100%;
  padding: 10px 12px;
  min-height: 42px;
}

.field input[aria-invalid="true"] {
  border-color: var(--danger);
}

.field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.optional {
  font-weight: 400;
  color: var(--text-3);
}

.field-error {
  font-size: 0.8rem;
  color: var(--danger);
}

.password {
  position: relative;
}

.password input {
  width: 100%;
  padding-right: 44px;
}

.password__toggle {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  color: var(--text-3);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border-radius: var(--radius-sm);
}

.strength {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
}

.strength span {
  height: 4px;
  border-radius: 999px;
  background: var(--surface-3);
}

.strength--weak span.on { background: var(--danger); }
.strength--medium span.on { background: var(--warning); }
.strength--strong span.on { background: var(--success); }

.rules {
  list-style: none;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 12px;
  font-size: 0.78rem;
  color: var(--text-3);
}

.rules li {
  display: flex;
  align-items: center;
  gap: 4px;
}

.rules li.ok {
  color: var(--success);
}

.check {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  font-size: 0.88rem;
  color: var(--text-2);
  cursor: pointer;
}

.check input {
  min-height: auto;
  width: 16px;
  height: 16px;
  margin-top: 2px;
  accent-color: var(--primary);
}

.submit {
  margin-top: 4px;
  min-height: 46px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: none;
  border-radius: var(--radius);
  background: var(--primary);
  color: var(--primary-contrast);
  font-weight: 700;
  font-size: 0.98rem;
  cursor: pointer;
}

.submit:hover:not(:disabled) {
  background: var(--primary-hover);
}

.submit:disabled {
  opacity: 0.7;
  cursor: progress;
}

.spin {
  width: 16px;
  height: 16px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.auth-card__switch {
  margin-top: 22px;
  text-align: center;
  color: var(--text-2);
  font-size: 0.9rem;
}

.auth-card__switch a {
  font-weight: 600;
}

.auth-page__aside {
  background: linear-gradient(160deg, var(--primary), var(--primary-hover));
  color: var(--primary-contrast);
  display: flex;
  align-items: center;
  padding: 48px;
}

.aside {
  max-width: 420px;
}

.aside h2 {
  font-size: 1.4rem;
  letter-spacing: -0.02em;
  margin-bottom: 24px;
}

.aside ul {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.aside li {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 0.98rem;
  color: rgba(255, 255, 255, 0.92);
}

.aside__icon {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius);
  background: rgba(255, 255, 255, 0.14);
}

.aside__note {
  margin-top: 32px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.86rem;
  color: rgba(255, 255, 255, 0.75);
}

@media (max-width: 900px) {
  .auth-page {
    grid-template-columns: 1fr;
  }

  .auth-page__aside {
    display: none;
  }

  .auth-page__form {
    padding: 20px 16px 40px;
  }

  .auth-card {
    margin-top: 24px;
  }

  .field-row,
  .rules {
    grid-template-columns: 1fr;
  }
}
</style>
