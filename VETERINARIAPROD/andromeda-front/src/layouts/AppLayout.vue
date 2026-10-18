<template>
  <div v-if="auth.isAuthenticated" class="app-layout">
    <aside class="sidebar" :class="{ 'sidebar--open': sidebarOpen }" aria-label="Menú principal">
      <div class="sidebar__header">
        <RouterLink to="/" class="sidebar__brand" @click="sidebarOpen = false">
          <AppLogo size="sm" />
        </RouterLink>
        <button class="icon-button sidebar__close" type="button" aria-label="Cerrar menú" @click="sidebarOpen = false">
          <AppIcon name="close" />
        </button>
      </div>

      <button type="button" class="sidebar__search" @click="palette?.show()">
        <AppIcon name="search" :size="16" />
        <span>Buscar</span>
        <kbd>{{ shortcutLabel }}</kbd>
      </button>

      <nav class="sidebar__nav" aria-label="Navegación principal">
        <section v-for="group in groupedMenuItems" :key="group.name" class="sidebar__group">
          <p class="sidebar__group-title">{{ group.name }}</p>
          <RouterLink
            v-for="item in group.items"
            :key="item.key"
            :to="item.to"
            class="sidebar__link"
            :class="{ 'sidebar__link--active': isActive(item) }"
            :aria-current="isActive(item) ? 'page' : undefined"
            @click="sidebarOpen = false"
          >
            <AppIcon :name="item.icon" :size="18" />
            <span class="sidebar__label">{{ item.label }}</span>
          </RouterLink>
        </section>
      </nav>

      <RouterLink
        v-if="isAdmin && subscription.summary"
        to="/suscripcion"
        class="plan-card"
        :class="{ 'plan-card--alert': subscription.needsAttention }"
        @click="sidebarOpen = false"
      >
        <div class="plan-card__row">
          <AppIcon name="sparkles" :size="16" />
          <strong>{{ planCardTitle }}</strong>
        </div>
        <p class="plan-card__text">{{ planCardText }}</p>
        <div v-if="subscription.isTrial" class="plan-card__bar" aria-hidden="true">
          <span :style="{ width: trialProgress + '%' }" />
        </div>
      </RouterLink>
    </aside>

    <div v-if="sidebarOpen" class="sidebar-overlay" @click="sidebarOpen = false" />

    <div class="main">
      <header class="topbar">
        <button class="icon-button topbar__menu" type="button" aria-label="Abrir menú" @click="sidebarOpen = true">
          <AppIcon name="menu" />
        </button>
        <div class="topbar__heading">
          <span class="topbar__kicker">{{ currentSection }}</span>
          <h1 class="topbar__title">{{ currentTitle }}</h1>
        </div>

        <div class="topbar__right">
          <button type="button" class="icon-button" :aria-label="themeLabel" :title="themeLabel" @click="toggleTheme">
            <AppIcon :name="isDark() ? 'sun' : 'moon'" />
          </button>
          <RouterLink to="/notificaciones" class="icon-button" aria-label="Notificaciones" title="Notificaciones">
            <AppIcon name="notifications" />
          </RouterLink>

          <div ref="userMenuRef" class="user-menu">
            <button
              type="button"
              class="user-menu__trigger"
              :aria-expanded="userMenuOpen"
              aria-haspopup="menu"
              @click="userMenuOpen = !userMenuOpen"
            >
              <span class="avatar">{{ initials }}</span>
              <span class="user-menu__name">{{ firstName }}</span>
              <AppIcon name="chevronDown" :size="16" />
            </button>
            <div v-if="userMenuOpen" class="user-menu__panel" role="menu">
              <div class="user-menu__header">
                <strong>{{ displayName }}</strong>
                <span>{{ auth.user?.email }}</span>
                <span v-if="displayRole" class="user-menu__role">{{ displayRole }}</span>
              </div>
              <div class="user-menu__section">
                <span class="user-menu__label">Tema</span>
                <div class="segmented" role="group" aria-label="Tema">
                  <button v-for="opt in THEME_OPTIONS" :key="opt.value" type="button" :aria-pressed="theme === opt.value" @click="setTheme(opt.value)">
                    {{ opt.label }}
                  </button>
                </div>
              </div>
              <div class="user-menu__section">
                <span class="user-menu__label">Idioma</span>
                <div class="segmented" role="group" aria-label="Idioma">
                  <button type="button" :aria-pressed="locale === 'es-AR'" @click="changeLocale('es-AR')">Español</button>
                  <button type="button" :aria-pressed="locale === 'en-US'" @click="changeLocale('en-US')">English</button>
                </div>
              </div>
              <RouterLink v-if="isAdmin" to="/suscripcion" class="user-menu__item" role="menuitem" @click="userMenuOpen = false">
                <AppIcon name="subscription" :size="17" /> Suscripción y plan
              </RouterLink>
              <button type="button" class="user-menu__item user-menu__item--danger" role="menuitem" @click="handleLogout">
                <AppIcon name="logout" :size="17" /> Cerrar sesión
              </button>
            </div>
          </div>
        </div>
      </header>

      <div v-if="showTrialBanner" class="trial-banner" :class="`trial-banner--${bannerTone}`" role="status">
        <AppIcon :name="bannerTone === 'danger' ? 'warning' : 'clock'" :size="17" />
        <span>{{ bannerText }}</span>
        <RouterLink to="/suscripcion" class="trial-banner__action">Elegir un plan</RouterLink>
        <button type="button" class="trial-banner__close" aria-label="Ocultar aviso" @click="bannerDismissed = true">
          <AppIcon name="close" :size="15" />
        </button>
      </div>

      <main class="page-content">
        <RouterView />
      </main>
    </div>

    <CommandPalette ref="palette" :items="paletteItems" />
  </div>
</template>

<script setup>
import AppIcon from '../components/AppIcon.vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useSubscriptionStore, PLAN_LABELS } from '../stores/subscription'
import { usePreferences } from '../composables/usePreferences'
import AppLogo from '../components/AppLogo.vue'
import CommandPalette from '../components/CommandPalette.vue'

const auth = useAuthStore()
const subscription = useSubscriptionStore()
const router = useRouter()
const route = useRoute()
const { theme, isDark, setTheme, toggleTheme, locale, changeLocale } = usePreferences()

const sidebarOpen = ref(false)
const userMenuOpen = ref(false)
const userMenuRef = ref(null)
const palette = ref(null)
const bannerDismissed = ref(false)

const THEME_OPTIONS = [
  { value: 'system', label: 'Sistema' },
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Oscuro' },
]

const shortcutLabel = /Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘K' : 'Ctrl K'

const SECTION_BY_KEY = {
  dashboard: 'Operación', appointments: 'Operación',
  patients: 'Clínica', medical: 'Clínica', vaccinations: 'Clínica', cirugias: 'Clínica', hospitalizaciones: 'Clínica',
  laboratorio: 'Diagnóstico', imagenes: 'Diagnóstico', patologia: 'Diagnóstico',
  grooming: 'Servicios', telemedicine: 'Servicios', ai: 'Servicios', portal: 'Servicios',
  inventory: 'Gestión', billing: 'Gestión', reports: 'Gestión', notifications: 'Gestión', documents: 'Gestión',
  admin: 'Configuración', subscription: 'Configuración',
}
const SECTION_ORDER = ['Operación', 'Clínica', 'Diagnóstico', 'Servicios', 'Gestión', 'Configuración']

const menuItems = computed(() => (auth.allowedMenu || []).map((item) => ({
  ...item,
  section: item.section || SECTION_BY_KEY[item.key] || 'Gestión',
})))

const groupedMenuItems = computed(() => {
  const groups = new Map()
  for (const item of menuItems.value) {
    if (!groups.has(item.section)) groups.set(item.section, [])
    groups.get(item.section).push(item)
  }
  return [...groups.entries()]
    .sort(([a], [b]) => SECTION_ORDER.indexOf(a) - SECTION_ORDER.indexOf(b))
    .map(([name, items]) => ({ name, items }))
})

const paletteItems = computed(() => menuItems.value.filter((item) => !String(item.to).includes('?')))

function isActive(item) {
  const target = String(item.to).split('?')[0]
  if (target === '/') return route.path === '/'
  return route.path === target || route.path.startsWith(`${target}/`)
}

const isAdmin = computed(() => auth.hasRole('org_admin', 'superadmin'))

const displayName = computed(() => {
  const u = auth.user
  if (!u) return ''
  const full = [u.first_name, u.last_name].filter(Boolean).join(' ')
  return u.name || full || u.email?.split('@')[0] || 'Usuario'
})
const firstName = computed(() => displayName.value.split(' ')[0])
const initials = computed(() => displayName.value.split(' ').slice(0, 2).map((w) => w[0]?.toUpperCase()).join(''))

const ROLE_LABELS = {
  superadmin: 'Super admin', org_admin: 'Administrador/a', branch_manager: 'Gerente', veterinarian: 'Veterinario/a',
  vet_technician: 'Técnico/a veterinario', receptionist: 'Recepción', groomer: 'Peluquería', grooming_manager: 'Gerente de grooming',
  tele_vet: 'Telemedicina', pharmacist: 'Farmacia', accountant: 'Contaduría', lab_technician: 'Laboratorio',
  imaging_tech: 'Imágenes', surgeon: 'Cirugía', read_only: 'Solo lectura',
}
const displayRole = computed(() => (auth.roles || []).map((r) => ROLE_LABELS[r] || r).join(' · '))

const PAGE_TITLES = {
  dashboard: 'Inicio', turnos: 'Turnos', pacientes: 'Pacientes', evoluciones: 'Evoluciones médicas',
  vacunas: 'Vacunación', inventario: 'Inventario', grooming: 'Grooming', telemedicina: 'Telemedicina',
  facturacion: 'Facturación', reportes: 'Reportes', notificaciones: 'Notificaciones', documentos: 'Documentos por mail',
  ai: 'Asistente de IA', laboratorio: 'Laboratorio', imagenes: 'Diagnóstico por imágenes', cirugias: 'Cirugías',
  hospitalizaciones: 'Internación', patologia: 'Patología', admin: 'Administración', suscripcion: 'Suscripción y plan',
}
const ROUTE_KEY = {
  dashboard: 'dashboard', turnos: 'appointments', pacientes: 'patients', evoluciones: 'medical', vacunas: 'vaccinations',
  inventario: 'inventory', grooming: 'grooming', telemedicina: 'telemedicine', facturacion: 'billing', reportes: 'reports',
  notificaciones: 'notifications', documentos: 'documents', ai: 'ai', laboratorio: 'laboratorio', imagenes: 'imagenes',
  cirugias: 'cirugias', hospitalizaciones: 'hospitalizaciones', patologia: 'patologia', admin: 'admin', suscripcion: 'subscription',
}
const currentTitle = computed(() => PAGE_TITLES[route.name] || 'Andromeda')
const currentSection = computed(() => SECTION_BY_KEY[ROUTE_KEY[route.name]] || 'Andromeda')

const themeLabel = computed(() => (isDark() ? 'Usar tema claro' : 'Usar tema oscuro'))

// ── Suscripción: tarjeta del menú y aviso de prueba ─────────────────────────
const planCardTitle = computed(() => {
  const s = subscription.summary
  if (!s) return ''
  if (s.status === 'trialing') return 'Prueba gratuita'
  if (s.status === 'expired') return 'Prueba finalizada'
  if (s.status === 'past_due') return 'Pago pendiente'
  return `Plan ${PLAN_LABELS[s.plan] || s.plan || ''}`.trim()
})
const planCardText = computed(() => {
  const s = subscription.summary
  if (!s) return ''
  if (s.status === 'trialing') return s.trialDaysLeft === 1 ? 'Te queda 1 día' : `Te quedan ${s.trialDaysLeft} días`
  if (s.status === 'expired') return 'Elegí un plan para seguir usando todo'
  if (s.status === 'past_due') return 'Revisá tu medio de pago'
  if (s.status === 'cancelled') return 'No se renovará'
  return 'Ver consumo y facturación'
})
const trialProgress = computed(() => {
  const days = subscription.data?.trialDays || 14
  const left = subscription.summary?.trialDaysLeft || 0
  return Math.max(4, Math.min(100, ((days - left) / days) * 100))
})

const showTrialBanner = computed(() => isAdmin.value && !bannerDismissed.value && subscription.needsAttention
  && route.name !== 'suscripcion')
const bannerTone = computed(() => (['expired', 'past_due'].includes(subscription.summary?.status) ? 'danger' : 'info'))
const bannerText = computed(() => {
  const s = subscription.summary
  if (!s) return ''
  if (s.status === 'expired') return 'Tu prueba gratuita terminó. Algunas funciones quedaron limitadas.'
  if (s.status === 'past_due') return 'No pudimos cobrar tu suscripción. Actualizá el medio de pago para evitar limitaciones.'
  if (s.status === 'cancelled') return 'Cancelaste tu suscripción: mantenés el plan hasta el fin del período pago.'
  return s.trialDaysLeft === 1 ? 'Te queda 1 día de prueba gratuita.' : `Te quedan ${s.trialDaysLeft} días de prueba gratuita.`
})

// ── Menú de usuario ─────────────────────────────────────────────────────────
function onDocumentClick(event) {
  if (userMenuOpen.value && userMenuRef.value && !userMenuRef.value.contains(event.target)) {
    userMenuOpen.value = false
  }
}

async function handleLogout() {
  userMenuOpen.value = false
  subscription.reset()
  await auth.logout()
  await router.replace('/login')
}

watch(() => route.fullPath, () => { userMenuOpen.value = false })

watch(
  () => auth.isAuthenticated,
  (isAuthenticated) => {
    if (!isAuthenticated && route.path !== '/login') router.replace('/login')
  }
)

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  if (isAdmin.value) subscription.load()
})
onBeforeUnmount(() => document.removeEventListener('click', onDocumentClick))
</script>

<style scoped>
.app-layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
  background: var(--bg);
}

/* ── Sidebar ─────────────────────────────────────────────────────────────── */
.sidebar {
  width: 256px;
  min-width: 256px;
  height: 100vh;
  background: var(--sidebar-bg);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  transition: transform var(--transition);
  z-index: 100;
}

.sidebar__header {
  height: 64px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.sidebar__brand {
  color: inherit;
}

.sidebar .sidebar__close {
  display: none;
}

.sidebar__search {
  margin: 4px 12px 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-2);
  color: var(--text-3);
  cursor: pointer;
  font-size: 0.86rem;
}

.sidebar__search span {
  flex: 1;
  text-align: left;
}

.sidebar__search:hover {
  border-color: var(--border-strong);
}

kbd {
  font: inherit;
  font-size: 0.7rem;
  padding: 1px 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
}

.sidebar__nav {
  flex: 1;
  overflow-y: auto;
  padding: 6px 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.sidebar__group {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.sidebar__group-title {
  padding: 0 10px 4px;
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-3);
}

.sidebar__link {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border-radius: var(--radius);
  color: var(--text-2);
  font-size: 0.9rem;
  font-weight: 500;
  transition: background var(--transition), color var(--transition);
}

.sidebar__link:hover {
  background: var(--surface-3);
  color: var(--text);
}

.sidebar__link--active,
.sidebar__link--active:hover {
  background: var(--sidebar-active);
  color: var(--primary);
  font-weight: 600;
}

.sidebar__label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.plan-card {
  margin: 8px 12px 14px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface-2);
  color: var(--text);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.plan-card:hover {
  border-color: var(--primary);
  color: var(--text);
}

.plan-card--alert {
  border-color: color-mix(in srgb, var(--warning) 45%, transparent);
  background: var(--warning-light);
}

.plan-card__row {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--primary);
  font-size: 0.86rem;
}

.plan-card__row strong {
  color: var(--text);
}

.plan-card__text {
  font-size: 0.8rem;
  color: var(--text-2);
}

.plan-card__bar {
  height: 4px;
  border-radius: 999px;
  background: var(--surface-3);
  overflow: hidden;
}

.plan-card__bar span {
  display: block;
  height: 100%;
  background: var(--primary);
  border-radius: inherit;
}

/* ── Main ────────────────────────────────────────────────────────────────── */
.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.topbar {
  height: 64px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 24px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}

.topbar .topbar__menu {
  display: none;
}

.topbar__heading {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.topbar__kicker {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--text-3);
}

.topbar__title {
  font-size: 1.08rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.topbar__right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.icon-button {
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
}

.icon-button:hover {
  background: var(--surface-3);
  color: var(--text);
}

.user-menu {
  position: relative;
  margin-left: 4px;
}

.user-menu__trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px 4px 4px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
}

.user-menu__trigger:hover {
  border-color: var(--border-strong);
}

.avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--primary);
  color: var(--primary-contrast);
  font-size: 0.74rem;
  font-weight: 700;
}

.user-menu__name {
  font-size: 0.88rem;
  font-weight: 600;
}

.user-menu__panel {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  width: 280px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  padding: 8px;
  z-index: 300;
}

.user-menu__header {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px 12px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 6px;
  font-size: 0.82rem;
  color: var(--text-3);
}

.user-menu__header strong {
  font-size: 0.92rem;
  color: var(--text);
}

.user-menu__role {
  color: var(--primary);
  font-weight: 600;
}

.user-menu__section {
  padding: 6px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.user-menu__label {
  font-size: 0.74rem;
  font-weight: 600;
  color: var(--text-3);
}

.segmented {
  display: flex;
  padding: 2px;
  border-radius: var(--radius);
  background: var(--surface-3);
}

.segmented button {
  flex: 1;
  border: none;
  background: transparent;
  padding: 5px 6px;
  border-radius: var(--radius-sm);
  font-size: 0.8rem;
  color: var(--text-2);
  cursor: pointer;
}

.segmented button[aria-pressed="true"] {
  background: var(--surface);
  color: var(--text);
  font-weight: 600;
  box-shadow: var(--shadow-sm);
}

.user-menu__item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border: none;
  border-radius: var(--radius);
  background: transparent;
  color: var(--text);
  font-size: 0.88rem;
  cursor: pointer;
  text-align: left;
}

.user-menu__item:hover {
  background: var(--surface-3);
  color: var(--text);
}

.user-menu__item--danger {
  color: var(--danger);
}

.trial-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 24px;
  font-size: 0.88rem;
  border-bottom: 1px solid var(--border);
}

.trial-banner--info {
  background: var(--primary-xlight);
  color: var(--text);
}

.trial-banner--danger {
  background: var(--danger-light);
  color: var(--text);
}

.trial-banner span {
  flex: 1;
}

.trial-banner__action {
  font-weight: 600;
  white-space: nowrap;
}

.trial-banner__close {
  border: none;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  display: inline-flex;
}

.page-content {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

.sidebar-overlay {
  display: none;
}

@media (max-width: 960px) {
  .sidebar {
    position: fixed;
    left: 0;
    top: 0;
    transform: translateX(-100%);
    box-shadow: var(--shadow-lg);
  }

  .sidebar--open {
    transform: translateX(0);
  }

  .sidebar .sidebar__close,
  .topbar .topbar__menu {
    display: inline-flex;
  }

  .sidebar-overlay {
    display: block;
    position: fixed;
    inset: 0;
    background: var(--overlay);
    z-index: 90;
  }

  .topbar {
    padding: 0 12px;
  }

  .user-menu__name {
    display: none;
  }

  .trial-banner {
    padding: 9px 16px;
  }

  .page-content {
    padding: 16px;
  }
}
</style>
