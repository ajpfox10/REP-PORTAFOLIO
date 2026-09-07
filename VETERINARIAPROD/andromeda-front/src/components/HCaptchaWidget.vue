<template>
  <div v-if="enabled" class="captcha">
    <div ref="container" class="captcha__box" data-testid="hcaptcha-widget" />
    <p v-if="loadError" class="captcha__message" role="alert">{{ loadError }}</p>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { logError } from '../utils/errors'

const HCAPTCHA_SRC = 'https://js.hcaptcha.com/1/api.js?render=explicit'

let hcaptchaScriptPromise = null

const props = defineProps({
  siteKey: { type: String, default: '' },
  theme: { type: String, default: 'light' },
})

const emit = defineEmits(['verified', 'expired', 'error', 'ready'])

const container = ref(null)
const loadError = ref('')
const widgetId = ref(null)
const enabled = computed(() => Boolean(props.siteKey))

let mounted = false

function loadHCaptchaScript() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('hCaptcha requires a browser environment'))
  }

  if (window.hcaptcha?.render) return Promise.resolve(window.hcaptcha)
  if (hcaptchaScriptPromise) return hcaptchaScriptPromise

  hcaptchaScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-hcaptcha-script="true"]')
    const script = existing || document.createElement('script')
    const timeout = window.setTimeout(() => {
      cleanup()
      hcaptchaScriptPromise = null
      reject(new Error('hCaptcha script load timeout'))
    }, 10000)

    function cleanup() {
      window.clearTimeout(timeout)
      script.removeEventListener('load', handleLoad)
      script.removeEventListener('error', handleError)
    }

    function handleLoad() {
      cleanup()
      if (window.hcaptcha?.render) resolve(window.hcaptcha)
      else reject(new Error('hCaptcha API unavailable after script load'))
    }

    function handleError() {
      cleanup()
      hcaptchaScriptPromise = null
      reject(new Error('hCaptcha script failed to load'))
    }

    script.addEventListener('load', handleLoad)
    script.addEventListener('error', handleError)

    if (!existing) {
      script.src = HCAPTCHA_SRC
      script.async = true
      script.defer = true
      script.dataset.hcaptchaScript = 'true'
      document.head.appendChild(script)
    }
  })

  return hcaptchaScriptPromise
}

async function renderCaptcha() {
  if (!enabled.value || widgetId.value !== null) return

  await nextTick()
  if (!mounted || !container.value) return

  try {
    const hcaptcha = await loadHCaptchaScript()
    if (!mounted || !container.value || widgetId.value !== null) return

    widgetId.value = hcaptcha.render(container.value, {
      sitekey: props.siteKey,
      theme: props.theme,
      callback(token) {
        loadError.value = ''
        emit('verified', token)
      },
      'expired-callback'() {
        emit('expired')
      },
      'error-callback'() {
        loadError.value = 'No se pudo validar el CAPTCHA.'
        emit('error')
      },
    })
    loadError.value = ''
    emit('ready')
  } catch (error) {
    loadError.value = 'No se pudo cargar el CAPTCHA.'
    logError('captcha.load', error)
    emit('error', error)
  }
}

function reset() {
  emit('expired')
  if (widgetId.value === null || !window.hcaptcha?.reset) return
  try {
    window.hcaptcha.reset(widgetId.value)
  } catch (error) {
    logError('captcha.reset', error)
  }
}

function removeWidget() {
  if (widgetId.value === null || !window.hcaptcha) return
  try {
    if (window.hcaptcha.remove) window.hcaptcha.remove(widgetId.value)
    else if (window.hcaptcha.reset) window.hcaptcha.reset(widgetId.value)
  } catch (error) {
    logError('captcha.remove', error)
  } finally {
    widgetId.value = null
  }
}

watch(() => props.siteKey, () => {
  removeWidget()
  renderCaptcha()
})

onMounted(() => {
  mounted = true
  renderCaptcha()
})

onBeforeUnmount(() => {
  mounted = false
  removeWidget()
})

defineExpose({ reset })
</script>

<style scoped>
.captcha {
  min-height: 78px;
  margin: 0 0 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.captcha__box {
  width: 303px;
  min-height: 78px;
  max-width: 100%;
}

.captcha__message {
  width: 100%;
  margin: 8px 0 0;
  color: var(--danger);
  font-size: 0.8rem;
  text-align: center;
}

@media (max-width: 380px) {
  .captcha {
    align-items: flex-start;
    overflow: hidden;
  }

  .captcha__box {
    max-width: none;
    transform: scale(0.86);
    transform-origin: top left;
    margin-bottom: -11px;
  }
}
</style>
