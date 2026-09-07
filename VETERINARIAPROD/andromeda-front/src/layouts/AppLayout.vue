<template>
  <div v-if="auth.isAuthenticated" class="app-layout">
    <aside class="sidebar" :class="{ 'sidebar--open': sidebarOpen }">
      <div class="sidebar__header">
        <AppLogo size="sm" />
        <button class="icon-button sidebar__close" @click="sidebarOpen = false" aria-label="Cerrar menú">
          <span aria-hidden="true">&times;</span>
        </button>
      </div>

      <nav class="sidebar__nav" aria-label="Navegación principal">
        <section v-for="group in groupedMenuItems" :key="group.name" class="sidebar__group">
          <p class="sidebar__group-title">{{ group.name }}</p>
          <RouterLink
            v-for="item in group.items"
            :key="item.key"
            :to="item.to"
            class="sidebar__link"
            active-class="sidebar__link--active"
            @click="sidebarOpen = false"
          >
            <span class="sidebar__icon">{{ item.icon }}</span>
            <span class="sidebar__label">{{ item.label }}</span>
          </RouterLink>
        </section>
      </nav>

      <div class="sidebar__footer">
        <div class="sidebar__user">
          <div class="sidebar__avatar">{{ initials }}</div>
          <div class="sidebar__user-info">
            <span class="sidebar__user-name">{{ displayName }}</span>
            <span class="sidebar__user-role">{{ displayRole }}</span>
          </div>
        </div>
        <button class="icon-button sidebar__logout" @click="handleLogout" title="Cerrar sesión" aria-label="Cerrar sesión">
          <span aria-hidden="true">⏻</span>
        </button>
      </div>
    </aside>

    <div v-if="sidebarOpen" class="sidebar-overlay" @click="sidebarOpen = false" />

    <div class="main">
      <header class="topbar">
        <button class="icon-button topbar__menu" @click="sidebarOpen = true" aria-label="Abrir menú">
          <span aria-hidden="true"></span>
        </button>
        <div class="topbar__heading">
          <span class="topbar__kicker">Andromeda</span>
          <h1 class="topbar__title">{{ currentTitle }}</h1>
        </div>
        <div class="topbar__right">
          <span class="topbar__greeting">Hola, {{ firstName }}</span>
        </div>
      </header>

      <main class="page-content">
        <RouterView />
      </main>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import AppLogo from '../components/AppLogo.vue'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const sidebarOpen = ref(false)

const PREVIEW_MENU = [
  { key: 'dashboard', section: 'Operación', label: 'Inicio', icon: '\u{1F3E0}', to: '/' },
  { key: 'appointments', section: 'Operación', label: 'Turnos', icon: '\u{1F4C5}', to: '/turnos' },
  { key: 'patients', section: 'Clínica', label: 'Pacientes', icon: '\u{1F43E}', to: '/pacientes' },
  { key: 'medical', section: 'Clínica', label: 'Evoluciones', icon: '\u{1F4CB}', to: '/evoluciones' },
  { key: 'vaccinations', section: 'Clínica', label: 'Vacunas', icon: '\u{1F489}', to: '/vacunas' },
  { key: 'laboratorio', section: 'Diagnóstico', label: 'Laboratorio', icon: '\u{1F9EA}', to: '/laboratorio' },
  { key: 'imagenes', section: 'Diagnóstico', label: 'Imágenes', icon: '\u{1FA7B}', to: '/imagenes' },
  { key: 'patologia', section: 'Diagnóstico', label: 'Patología', icon: '\u{1F52C}', to: '/patologia' },
  { key: 'cirugias', section: 'Clínica', label: 'Cirugías', icon: '\u{1F52A}', to: '/cirugias' },
  { key: 'hospitalizaciones', section: 'Clínica', label: 'Internados', icon: '\u{1F3E5}', to: '/hospitalizaciones' },
  { key: 'inventory', section: 'Gestión', label: 'Inventario', icon: '\u{1F4E6}', to: '/inventario' },
  { key: 'grooming', section: 'Servicios', label: 'Grooming', icon: '\u2702\uFE0F', to: '/grooming' },
  { key: 'telemedicine', section: 'Servicios', label: 'Telemedicina', icon: '\u{1F4BB}', to: '/telemedicina' },
  { key: 'billing', section: 'Gestión', label: 'Facturación', icon: '\u{1F4B0}', to: '/facturacion' },
  { key: 'reports', section: 'Gestión', label: 'Reportes', icon: '\u{1F4CA}', to: '/reportes' },
  { key: 'admin', section: 'Gestión', label: 'Administrar', icon: '\u2699\uFE0F', to: '/admin' },
  { key: 'notifications', section: 'Gestión', label: 'Notificaciones', icon: '\u{1F514}', to: '/notificaciones' },
  { key: 'documents', section: 'Gestión', label: 'Documentos', icon: '\u{1F4E8}', to: '/documentos' },
  { key: 'ai', section: 'Servicios', label: 'IA', icon: '\u{1F9E0}', to: '/ai' },
]

const menuItems = computed(() => auth.allowedMenu?.length ? auth.allowedMenu : PREVIEW_MENU)

const SECTION_ORDER = ['Operación', 'Clínica', 'Diagnóstico', 'Servicios', 'Gestión']

const MENU_SECTION_BY_KEY = PREVIEW_MENU.reduce((sections, item) => {
  sections[item.key] = item.section
  return sections
}, {})

const groupedMenuItems = computed(() => {
  const groups = new Map()
  menuItems.value.forEach((item) => {
    const section = item.section || MENU_SECTION_BY_KEY[item.key] || 'Gestión'
    if (!groups.has(section)) groups.set(section, [])
    groups.get(section).push(item)
  })

  return Array.from(groups.entries())
    .sort(([a], [b]) => {
      const ia = SECTION_ORDER.indexOf(a)
      const ib = SECTION_ORDER.indexOf(b)
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
    })
    .map(([name, items]) => ({ name, items }))
})

const displayName = computed(() => {
  const u = auth.user
  if (!u) return ''
  return u.name || u.email?.split('@')[0] || 'Usuario'
})

const firstName = computed(() => displayName.value.split(' ')[0])

const initials = computed(() =>
  displayName.value.split(' ').slice(0, 2).map((w) => w[0]?.toUpperCase()).join('')
)

function normalizeRoleList(input) {
  if (!input) return []
  if (Array.isArray(input)) {
    return input
      .map((role) => {
        if (!role) return null
        if (typeof role === 'string') return role.trim()
        if (typeof role === 'object') return String(role.name || role.role || role.value || '').trim()
        return null
      })
      .filter(Boolean)
  }
  if (typeof input === 'string') {
    return input.split(',').map((role) => role.trim()).filter(Boolean)
  }
  return []
}

const ROLE_LABELS = {
  superadmin: 'Super Admin',
  org_admin: 'Admin',
  branch_manager: 'Gerente',
  veterinarian: 'Veterinario/a',
  vet_technician: 'Técnico/a Vet.',
  receptionist: 'Recepcionista',
  groomer: 'Peluquero/a',
  grooming_manager: 'Gerente Grooming',
  tele_vet: 'Vet. Telemedicina',
  pharmacist: 'Farmacéutico/a',
  accountant: 'Contador/a',
  lab_technician: 'Técnico/a Lab.',
  imaging_tech: 'Técnico/a Imágenes',
  surgeon: 'Cirujano/a',
  read_only: 'Solo Lectura',
}

const displayRole = computed(() =>
  normalizeRoleList(auth.roles).map((r) => ROLE_LABELS[r] || r).join(', ') || ''
)

const PAGE_TITLES = {
  dashboard: 'Inicio',
  turnos: 'Gestión de Turnos',
  pacientes: 'Pacientes',
  evoluciones: 'Evoluciones Médicas',
  vacunas: 'Vacunaciones',
  inventario: 'Inventario',
  grooming: 'Grooming',
  telemedicina: 'Telemedicina',
  facturacion: 'Facturación',
  reportes: 'Reportes',
  notificaciones: 'Notificaciones',
  documentos: 'Documentos por Mail',
  portal: 'Portal de Dueños',
  ai: 'Inteligencia Artificial',
  laboratorio: 'Laboratorio',
  imagenes: 'Diagnóstico por Imágenes',
  cirugias: 'Cirugías',
  hospitalizaciones: 'Hospitalizaciones',
  patologia: 'Patología',
  admin: 'Administración',
}

const currentTitle = computed(() => PAGE_TITLES[route.name] || 'Sistema Andromeda')

async function handleLogout() {
  await auth.logout()
  await router.replace('/login')
}

watch(
  () => auth.isAuthenticated,
  (isAuthenticated) => {
    if (!isAuthenticated && route.path !== '/login') {
      router.replace('/login')
    }
  }
)
</script>

<style scoped>
.app-layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
  background: var(--bg);
}

.sidebar {
  width: 268px;
  min-width: 268px;
  height: 100vh;
  background: var(--surface);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  transition: transform var(--transition), box-shadow var(--transition);
  z-index: 100;
}

.sidebar__header {
  min-height: 72px;
  padding: 18px 18px 16px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.sidebar__close {
  display: none;
}

.sidebar__nav {
  flex: 1;
  padding: 14px 10px 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.sidebar__group {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.sidebar__group-title {
  margin: 0 12px 5px;
  color: var(--text-3);
  font-size: 0.66rem;
  font-weight: 900;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.sidebar__link {
  position: relative;
  display: flex;
  align-items: center;
  gap: 11px;
  min-height: 42px;
  padding: 10px 12px;
  border-radius: var(--radius);
  color: var(--text-2);
  font-size: 0.9rem;
  font-weight: 600;
  text-decoration: none;
  transition: background var(--transition), color var(--transition), border-color var(--transition);
}

.sidebar__link::before {
  content: "";
  width: 3px;
  height: 18px;
  border-radius: 99px;
  background: transparent;
}

.sidebar__link:hover {
  background: var(--surface-2);
  color: var(--text);
}

.sidebar__link--active {
  background: var(--primary-xlight);
  color: var(--primary-hover);
}

.sidebar__link--active::before {
  background: var(--primary);
}

.sidebar__icon {
  width: 24px;
  min-width: 24px;
  text-align: center;
  font-size: 1.05rem;
  line-height: 1;
}

.sidebar__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar__footer {
  padding: 14px;
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--surface);
}

.sidebar__user {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}

.sidebar__avatar {
  width: 36px;
  height: 36px;
  min-width: 36px;
  border-radius: 10px;
  background: linear-gradient(135deg, var(--primary) 0%, var(--accent-blue) 100%);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: 800;
}

.sidebar__user-info {
  min-width: 0;
}

.sidebar__user-name {
  display: block;
  font-size: 0.84rem;
  font-weight: 700;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar__user-role {
  display: block;
  margin-top: 2px;
  font-size: 0.72rem;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.icon-button {
  min-width: 36px;
  height: 36px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text-2);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background var(--transition), color var(--transition), border-color var(--transition);
}

.icon-button:hover {
  background: var(--surface-2);
  color: var(--text);
}

.sidebar__logout {
  font-size: 1rem;
  font-weight: 800;
}

.sidebar__logout:hover {
  border-color: var(--danger);
  background: var(--danger-light);
  color: var(--danger);
}

.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.topbar {
  min-height: 72px;
  padding: 0 28px;
  display: flex;
  align-items: center;
  gap: 16px;
  background: rgba(255, 255, 255, 0.94);
  border-bottom: 1px solid var(--border);
  box-shadow: none;
  flex-shrink: 0;
}

.topbar__menu {
  display: none;
}

.topbar__menu span,
.topbar__menu span::before,
.topbar__menu span::after {
  display: block;
  width: 16px;
  height: 2px;
  border-radius: 99px;
  background: currentColor;
  content: "";
}

.topbar__menu span {
  position: relative;
}

.topbar__menu span::before,
.topbar__menu span::after {
  position: absolute;
  left: 0;
}

.topbar__menu span::before {
  top: -5px;
}

.topbar__menu span::after {
  top: 5px;
}

.topbar__heading {
  flex: 1;
  min-width: 0;
}

.topbar__kicker {
  display: block;
  margin-bottom: 2px;
  font-size: 0.72rem;
  font-weight: 800;
  color: var(--primary);
  text-transform: uppercase;
}

.topbar__title {
  font-size: 1.12rem;
  font-weight: 800;
  color: var(--text);
  line-height: 1.2;
}

.topbar__greeting {
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-2);
  font-size: 0.84rem;
  font-weight: 600;
  color: var(--text-2);
}

.page-content {
  flex: 1;
  overflow-y: auto;
  padding: 28px;
}

.page-content > :deep(*) {
  max-width: 1480px;
}

.sidebar-overlay {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.42);
  z-index: 99;
}

@media (max-width: 900px) {
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

  .sidebar__close,
  .sidebar-overlay,
  .topbar__menu {
    display: inline-flex;
  }

  .topbar {
    min-height: 64px;
    padding: 0 16px;
  }

  .topbar__greeting {
    display: none;
  }

  .page-content {
    padding: 18px 14px;
  }
}
</style>
