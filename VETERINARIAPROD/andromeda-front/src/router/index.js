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
    path: '/reset-password',
    name: 'reset-password',
    component: () => import('../views/ResetPasswordView.vue'),
    meta: { public: true },
  },
  {
    path: '/',
    component: () => import('../layouts/AppLayout.vue'),
    meta: { requiresAuth: true },
    children: [
      { path: '',          name: 'dashboard',    component: () => import('../views/DashboardView.vue') },
      { path: 'turnos',    name: 'turnos',       component: () => import('../views/TurnosView.vue') },
      { path: 'pacientes', name: 'pacientes',    component: () => import('../views/PacientesView.vue') },
      { path: 'evoluciones', name: 'evoluciones', component: () => import('../views/EvolucionesView.vue') },
      { path: 'vacunas',   name: 'vacunas',      component: () => import('../views/VacunasView.vue') },
      { path: 'inventario', name: 'inventario',  component: () => import('../views/InventarioView.vue') },
      { path: 'grooming',  name: 'grooming',     component: () => import('../views/GroomingView.vue') },
      { path: 'telemedicina', name: 'telemedicina', component: () => import('../views/TelemedicinaView.vue') },
      { path: 'facturacion', name: 'facturacion', component: () => import('../views/FacturacionView.vue') },
      { path: 'reportes',  name: 'reportes',     component: () => import('../views/ReportesView.vue') },
      { path: 'notificaciones', name: 'notificaciones', component: () => import('../views/NotificationsView.vue') },
      { path: 'documentos', name: 'documentos', component: () => import('../views/DocumentosView.vue') },
      { path: 'ai', name: 'ai', component: () => import('../views/AiView.vue'), meta: { requiresPerm: 'ai:use' } },
      { path: 'laboratorio',      name: 'laboratorio',      component: () => import('../views/LaboratorioView.vue') },
      { path: 'imagenes',         name: 'imagenes',         component: () => import('../views/ImagenesView.vue') },
      { path: 'cirugias',         name: 'cirugias',         component: () => import('../views/CirugiasView.vue') },
      { path: 'hospitalizaciones', name: 'hospitalizaciones', component: () => import('../views/HospitalizacionesView.vue') },
      { path: 'patologia',        name: 'patologia',        component: () => import('../views/PatologiaView.vue') },
      { path: 'admin',     name: 'admin',        component: () => import('../views/AdminView.vue'), meta: { requiresRole: ['org_admin', 'superadmin'] } },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  await auth.bootstrap()

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
