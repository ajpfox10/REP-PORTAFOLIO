import { ref } from 'vue'
import { getLocale, setLocale } from '../i18n'

const THEME_KEY = 'andromeda.theme'
const LOCALE_KEY = 'andromeda.locale'
const THEMES = ['system', 'light', 'dark']
const LOCALES = ['es-AR', 'en-US']

function read(key) {
  try { return localStorage.getItem(key) } catch { return null }
}

function write(key, value) {
  try { localStorage.setItem(key, value) } catch { /* modo privado: solo para esta sesión */ }
}

const theme = ref(THEMES.includes(read(THEME_KEY)) ? read(THEME_KEY) : 'system')

function applyTheme(value) {
  const root = document.documentElement
  if (value === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', value)
}

function isDark() {
  if (theme.value !== 'system') return theme.value === 'dark'
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

/** Aplica tema e idioma guardados. Se llama una vez al arrancar la app. */
export function initPreferences() {
  applyTheme(theme.value)
  const savedLocale = read(LOCALE_KEY)
  // El producto está pensado para clínicas de habla hispana: español salvo elección explícita.
  setLocale(LOCALES.includes(savedLocale) ? savedLocale : 'es-AR')
  document.documentElement.lang = getLocale() === 'en-US' ? 'en' : 'es'
}

export function usePreferences() {
  function setTheme(value) {
    if (!THEMES.includes(value)) return
    theme.value = value
    write(THEME_KEY, value)
    applyTheme(value)
  }

  function toggleTheme() {
    setTheme(isDark() ? 'light' : 'dark')
  }

  function changeLocale(value) {
    if (!LOCALES.includes(value) || value === getLocale()) return
    write(LOCALE_KEY, value)
    // Las traducciones no son reactivas: recargar asegura que toda la UI cambie de idioma.
    window.location.reload()
  }

  return { theme, isDark, setTheme, toggleTheme, locale: getLocale(), changeLocale }
}
