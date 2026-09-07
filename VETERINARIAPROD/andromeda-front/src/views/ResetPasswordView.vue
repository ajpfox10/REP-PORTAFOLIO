<template>
  <main class="reset-page">
    <section class="reset-card" aria-labelledby="reset-title">
      <p class="reset-card__eyebrow">Sistema Andromeda</p>
      <h1 id="reset-title">Restablecer contrasena</h1>
      <p class="reset-card__copy">
        Crea una nueva contrasena para volver a ingresar a tu cuenta.
      </p>

      <div v-if="!token" class="alert alert--error" role="alert">
        El enlace no contiene un token de recuperacion valido.
      </div>

      <div v-else-if="completed" class="reset-result" role="status">
        <div class="alert alert--success">
          Tu contrasena fue actualizada correctamente.
        </div>
        <RouterLink class="primary-button" to="/login">Ir al inicio de sesion</RouterLink>
      </div>

      <form v-else class="reset-form" @submit.prevent="handleSubmit">
        <label for="reset-new-password">
          <span>Nueva contrasena</span>
          <input
            id="reset-new-password"
            v-model="newPassword"
            type="password"
            autocomplete="new-password"
            minlength="10"
            maxlength="128"
            required
          />
        </label>

        <label for="reset-confirm-password">
          <span>Confirmar contrasena</span>
          <input
            id="reset-confirm-password"
            v-model="confirmPassword"
            type="password"
            autocomplete="new-password"
            minlength="10"
            maxlength="128"
            required
          />
        </label>

        <p class="reset-card__hint">
          Usa al menos 10 caracteres, con mayuscula, minuscula, numero y simbolo.
        </p>

        <div v-if="errorMessage" class="alert alert--error" role="alert">
          {{ errorMessage }}
        </div>

        <button class="primary-button" type="submit" :disabled="loading">
          {{ loading ? 'Actualizando...' : 'Actualizar contrasena' }}
        </button>
      </form>

      <RouterLink v-if="!completed" class="reset-card__link" to="/login">
        Volver al inicio de sesion
      </RouterLink>
    </section>
  </main>
</template>

<script setup>
import { computed, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { portalApi } from '../api/portal'
import { confirmPasswordReset, getLoginError, loginErrorScope } from '../composables/auth/useLoginDomain'

const route = useRoute()
const token = computed(() => String(route.query.token || '').trim())
const isPortalReset = computed(() => String(route.query.portal || '') === '1')
const newPassword = ref('')
const confirmPassword = ref('')
const loading = ref(false)
const completed = ref(false)
const errorMessage = ref('')

async function handleSubmit() {
  errorMessage.value = ''

  if (!token.value) {
    errorMessage.value = 'El enlace de recuperacion no es valido.'
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    errorMessage.value = 'Las contrasenas no coinciden.'
    return
  }

  loading.value = true
  try {
    if (isPortalReset.value) {
      await portalApi.confirmPasswordReset({ token: token.value, newPassword: newPassword.value })
    } else {
      await confirmPasswordReset(token.value, newPassword.value)
    }
    completed.value = true
    newPassword.value = ''
    confirmPassword.value = ''
  } catch (error) {
    loginErrorScope('resetPassword.confirm', error)
    errorMessage.value = getLoginError(error, 'No se pudo actualizar la contrasena. El enlace puede haber vencido.')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.reset-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 32px 20px;
  background:
    linear-gradient(135deg, rgba(15, 118, 110, 0.08), rgba(37, 99, 235, 0.05)),
    var(--bg);
}

.reset-card {
  width: min(100%, 460px);
  display: grid;
  gap: 18px;
  padding: 32px;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--white);
  box-shadow: var(--shadow-sm);
}

.reset-card h1,
.reset-card p {
  margin: 0;
}

.reset-card__eyebrow {
  color: var(--primary);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.reset-card__copy,
.reset-card__hint {
  color: var(--text-3);
  line-height: 1.5;
}

.reset-card__hint {
  font-size: 0.82rem;
}

.reset-form,
.reset-result,
.reset-form label {
  display: grid;
  gap: 12px;
}

.reset-form label {
  gap: 7px;
  color: var(--text);
  font-size: 0.88rem;
  font-weight: 600;
}

.reset-form input {
  min-height: 44px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--white);
  color: var(--text);
}

.primary-button {
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 18px;
  border: 0;
  border-radius: var(--radius);
  background: var(--primary);
  color: var(--white);
  font-weight: 700;
  text-decoration: none;
  cursor: pointer;
}

.primary-button:disabled {
  opacity: 0.65;
  cursor: wait;
}

.reset-card__link {
  color: var(--primary);
  font-size: 0.88rem;
  font-weight: 600;
  text-align: center;
}

.alert {
  padding: 12px 14px;
  border-radius: var(--radius);
  line-height: 1.45;
}

.alert--error {
  background: #fdf3f3;
  color: #a93226;
}

.alert--success {
  background: #eafaf3;
  color: #1e8449;
}

@media (max-width: 520px) {
  .reset-card {
    padding: 24px 20px;
  }
}
</style>
