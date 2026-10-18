import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const IS_DEV_MODE = import.meta.env.DEV || import.meta.env.MODE === 'development'

const routes = [
  {
    path: '/login',
    name: 'login',
    component: () => import('../views/LoginView.vue'),
    meta: { public: true },
  },
  {
    path: '/portal',
    name: 'portal',
    component: () => import('../views/PortalView.vue'),
    meta: { public: true },
  },
  {
    path: '/registro',
    name: 'registro',
    component: () => import('../views/SignupView.vue'),
    meta: { public: true, guestOnly: true },
  },
  {
    path: '/reset-password',
    name: 'reset-password',
    component: () => import('../views/ResetPasswordView.vue'),
    meta: { public: true },
  },
  {
    path: '/',
    component: () => import('../layouts/RootGate.vue'),
    children: [
      // Sin sesión, "/" muestra la página de presentación (RootGate); el resto exige sesión.
      { path: '',          name: 'dashboard',    component: () => import('../views/DashboardView.vue') },
      { path: 'turnos',    name: 'turnos',       component: () => import('../views/TurnosView.vue'), meta: { requiresAuth: true } },
      { path: 'pacientes', name: 'pacientes',    component: () => import('../views/PacientesView.vue'), meta: { requiresAuth: true } },
      { path: 'evoluciones', name: 'evoluciones', component: () => import('../views/EvolucionesView.vue'), meta: { requiresAuth: true } },
      { path: 'vacunas',   name: 'vacunas',      component: () => import('../views/VacunasView.vue'), meta: { requiresAuth: true } },
      { path: 'inventario', name: 'inventario',  component: () => import('../views/InventarioView.vue'), meta: { requiresAuth: true } },
      { path: 'grooming',  name: 'grooming',     component: () => import('../views/GroomingView.vue'), meta: { requiresAuth: true } },
      { path: 'telemedicina', name: 'telemedicina', component: () => import('../views/TelemedicinaView.vue'), meta: { requiresAuth: true } },
      { path: 'facturacion', name: 'facturacion', component: () => import('../views/FacturacionView.vue'), meta: { requiresAuth: true } },
      { path: 'reportes',  name: 'reportes',     component: () => import('../views/ReportesView.vue'), meta: { requiresAuth: true } },
      { path: 'notificaciones', name: 'notificaciones', component: () => import('../views/NotificationsView.vue'), meta: { requiresAuth: true } },
      { path: 'documentos', name: 'documentos', component: () => import('../views/DocumentosView.vue'), meta: { requiresAuth: true } },
      { path: 'ai', name: 'ai', component: () => import('../views/AiView.vue'), meta: { requiresAuth: true, requiresPerm: 'ai:use' } },
      { path: 'laboratorio',      name: 'laboratorio',      component: () => import('../views/LaboratorioView.vue'), meta: { requiresAuth: true } },
      { path: 'imagenes',         name: 'imagenes',         component: () => import('../views/ImagenesView.vue'), meta: { requiresAuth: true } },
      { path: 'cirugias',         name: 'cirugias',         component: () => import('../views/CirugiasView.vue'), meta: { requiresAuth: true } },
      { path: 'hospitalizaciones', name: 'hospitalizaciones', component: () => import('../views/HospitalizacionesView.vue'), meta: { requiresAuth: true } },
      { path: 'patologia',        name: 'patologia',        component: () => import('../views/PatologiaView.vue'), meta: { requiresAuth: true } },
      { path: 'admin',     name: 'admin',        component: () => import('../views/AdminView.vue'), meta: { requiresAuth: true, requiresRole: ['org_admin', 'superadmin'] } },
      { path: 'suscripcion', name: 'suscripcion', component: () => import('../views/SubscriptionView.vue'), meta: { requiresAuth: true, requiresRole: ['org_admin', 'superadmin'] } },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(to, _from, saved) {
    if (saved) return saved
    if (to.hash) return { el: to.hash, behavior: 'smooth', top: 72 }
    return { top: 0 }
  },
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  await auth.bootstrap()

  if (to.meta.guestOnly && auth.isAuthenticated) return '/'

  if (IS_DEV_MODE) {
    if (to.path === '/login' && auth.isAuthenticated) return '/'
    // En DEV no verificamos roles/permisos pero sí autenticación básica
    if (to.meta?.requiresAuth && !auth.isAuthenticated) return '/login'
    return true
  }

  if (to.meta.requiresAuth && !auth.isAuthenticated) return '/login'
  if (to.path === '/login' && auth.isAuthenticated) return '/'

  // Role guard
  if (to.meta.requiresRole) {
    const allowed = Array.isArray(to.meta.requiresRole) ? to.meta.requiresRole : [to.meta.requiresRole]
    if (!auth.hasRole(...allowed)) return '/'
  }

  // Permission guard
  if (to.meta.requiresPerm) {
    if (!auth.can(to.meta.requiresPerm)) return '/'
  }

  return true
})

export default router
