import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import App from './App.vue'
import { useAuthStore } from './stores/auth'
import { useUiFeedbackStore } from './stores/uiFeedback'
import { initPreferences } from './composables/usePreferences'
import { buildUserErrorMessage, getErrorInfo, logError } from './utils/errors'
import '@fontsource-variable/inter'
import './assets/main.css'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
initPreferences()

const auth = useAuthStore(pinia)
const feedback = useUiFeedbackStore(pinia)

function showUnhandledError(scope, error, fallback) {
  const info = getErrorInfo(error, fallback)
  feedback.error(buildUserErrorMessage(info, fallback, { context: 'Error inesperado del sistema' }), {
    title: 'Error no controlado',
  })
  logError(scope, error, { severity: 'fatal' })
}

app.config.errorHandler = (error) => {
  showUnhandledError('app', error, 'La pantalla encontró un error inesperado.')
}

window.addEventListener('unhandledrejection', (event) => {
  showUnhandledError('unhandledrejection', event.reason, 'Una operación falló sin manejarse.')
})

app.use(router)
app.mount('#app')

auth.bootstrap().catch((error) => {
  showUnhandledError('bootstrap', error, 'No se pudo iniciar la sesión.')
})
