<template>
  <div class="dashboard">
    <section class="welcome">
      <div>
        <h2 class="welcome__title">{{ greeting }}, {{ firstName }}</h2>
        <p class="welcome__sub">{{ today }}</p>
      </div>
      <div class="welcome__actions">
        <RouterLink v-if="canSee('patients')" to="/pacientes" class="btn-ghost">
          <AppIcon name="plus" :size="16" /> {{ t('dashboard.newPatient') }}
        </RouterLink>
        <RouterLink v-if="canSee('appointments')" to="/turnos" class="btn-primary">
          <AppIcon name="appointments" :size="16" /> {{ t('dashboard.newAppointment') }}
        </RouterLink>
      </div>
    </section>

    <!-- Primeros pasos: solo mientras la clínica está vacía -->
    <section v-if="showOnboarding" class="onboarding" aria-labelledby="onboarding-title">
      <div class="onboarding__head">
        <div>
          <h3 id="onboarding-title">{{ t('dashboard.onboardingTitle') }}</h3>
          <p>{{ t('dashboard.onboardingSubtitle') }}</p>
        </div>
        <span class="onboarding__count">{{ completedSteps }}/{{ onboardingSteps.length }}</span>
        <button type="button" class="onboarding__hide" @click="hideOnboarding">{{ t('dashboard.onboardingHide') }}</button>
      </div>
      <ol class="onboarding__steps">
        <li v-for="step in onboardingSteps" :key="step.key" :class="{ done: step.done }">
          <RouterLink :to="step.to">
            <span class="onboarding__check" aria-hidden="true">
              <AppIcon :name="step.done ? 'check' : step.icon" :size="16" />
            </span>
            <span>{{ step.label }}</span>
            <AppIcon v-if="!step.done" name="chevronRight" :size="16" class="onboarding__arrow" />
          </RouterLink>
        </li>
      </ol>
    </section>

    <div class="kpi-grid">
      <RouterLink v-for="kpi in kpis" :key="kpi.key" :to="kpi.to" class="kpi-card">
        <span class="kpi-card__icon" :style="{ '--tone': kpi.tone }"><AppIcon :name="kpi.icon" :size="20" /></span>
        <span>
          <strong class="kpi-card__value">{{ kpi.value }}</strong>
          <span class="kpi-card__label">{{ kpi.label }}</span>
        </span>
      </RouterLink>
    </div>

    <div class="columns">
      <section class="panel" aria-labelledby="today-title">
        <div class="panel__head">
          <h3 id="today-title">{{ t('dashboard.todayAppointments') }}</h3>
          <RouterLink to="/turnos" class="panel__link">{{ t('common.viewAll') }} <AppIcon name="arrowRight" :size="14" /></RouterLink>
        </div>

        <div v-if="loadingAppts" class="skeleton-list" aria-busy="true" :aria-label="t('dashboard.loadingAppointments')">
          <span v-for="n in 3" :key="n" />
        </div>
        <div v-else-if="appointmentsError" class="alert alert--error" role="alert">{{ appointmentsError }}</div>
        <div v-else-if="!todayAppointments.length" class="empty">
          <span class="empty-state__icon" aria-hidden="true"><AppIcon name="appointments" :size="26" /></span>
          <p>{{ t('dashboard.noAppointments') }}</p>
        </div>
        <ul v-else class="appt-list">
          <li v-for="appt in todayAppointments" :key="appt.id">
            <RouterLink to="/turnos" class="appt-row">
              <span class="appt-row__time">{{ formatTime(appt.scheduled_date) }}</span>
              <SpeciesIcon :species="appt.species" :size="18" />
              <span class="appt-row__info">
                <strong>{{ appt.patient_name || '—' }}</strong>
                <span>{{ appt.reason || appt.appointment_type || '' }}</span>
              </span>
              <span class="badge" :class="`badge--${appt.status}`">{{ STATUS_LABELS[appt.status] || appt.status }}</span>
            </RouterLink>
          </li>
        </ul>
      </section>

      <section class="panel" aria-labelledby="alerts-title">
        <div class="panel__head">
          <h3 id="alerts-title">{{ t('dashboard.alertsTitle') }}</h3>
          <RouterLink v-if="canSee('vaccinations')" to="/vacunas" class="panel__link">{{ t('common.viewAll') }} <AppIcon name="arrowRight" :size="14" /></RouterLink>
        </div>
        <p v-if="!vaccineAlerts.length" class="panel__empty">{{ t('dashboard.noAlerts') }}</p>
        <ul v-else class="alert-list">
          <li v-for="alert in vaccineAlerts" :key="alert.vaccination_id">
            <span class="alert-list__icon" :class="{ overdue: alert.days_until_due < 0 }"><AppIcon name="vaccines" :size="16" /></span>
            <span class="alert-list__info">
              <strong>{{ alert.patient_name }}</strong>
              <span>{{ alert.vaccine_name }} · {{ t('dashboard.vaccineAlert', { date: formatDate(alert.next_due_date) }) }}</span>
            </span>
          </li>
        </ul>
      </section>
    </div>

    <section class="panel" aria-labelledby="quick-title">
      <div class="panel__head">
        <h3 id="quick-title">{{ t('dashboard.quickAccess') }}</h3>
      </div>
      <div class="quick-grid">
        <RouterLink v-for="item in quickItems" :key="item.key" :to="item.to" class="quick-card">
          <AppIcon :name="item.icon" :size="20" />
          <span>{{ item.label }}</span>
        </RouterLink>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import SpeciesIcon from '../components/SpeciesIcon.vue'
import { appointmentsApi, patientsApi, vaccinationsApi } from '../api'
import { t } from '../i18n'
import { useAuthStore } from '../stores/auth'
import { useSubscriptionStore } from '../stores/subscription'
import { extractDetailedErrorMessage, logError } from '../utils/errors'

const ONBOARDING_KEY = 'andromeda.onboarding.hidden'

const auth = useAuthStore()
const subscription = useSubscriptionStore()

const STATUS_LABELS = {
  scheduled: t('dashboard.statusScheduled'),
  confirmed: t('dashboard.statusConfirmed'),
  in_progress: t('dashboard.statusInProgress'),
  completed: t('dashboard.statusCompleted'),
  cancelled: t('dashboard.statusCancelled'),
  no_show: t('dashboard.statusNoShow'),
}

const todayAppointments = ref([])
const loadingAppts = ref(true)
const appointmentsError = ref('')
const patientsTotal = ref(null)
const vaccineAlerts = ref([])
const anyAppointment = ref(false)
const onboardingHidden = ref(readOnboardingHidden())

function readOnboardingHidden() {
  try { return localStorage.getItem(ONBOARDING_KEY) === '1' } catch { return false }
}

function hideOnboarding() {
  onboardingHidden.value = true
  try { localStorage.setItem(ONBOARDING_KEY, '1') } catch { /* sin almacenamiento: se oculta solo en esta visita */ }
}

const firstName = computed(() => {
  const u = auth.user
  return String(u?.first_name || u?.name || u?.email?.split('@')[0] || '').split(' ')[0]
})

const greeting = computed(() => {
  const hour = new Date().getHours()
  if (hour < 12) return t('dashboard.greetingMorning')
  if (hour < 20) return t('dashboard.greetingAfternoon')
  return t('dashboard.greetingEvening')
})

const today = (() => {
  const text = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
  return text.charAt(0).toUpperCase() + text.slice(1)
})()

const allowedKeys = computed(() => new Set((auth.allowedMenu || []).map((item) => item.key)))
function canSee(key) {
  return allowedKeys.value.has(key)
}

const quickItems = computed(() => (auth.allowedMenu || [])
  .filter((item) => !['dashboard', 'subscription', 'portal'].includes(item.key))
  .slice(0, 8))

const kpis = computed(() => {
  const list = todayAppointments.value
  return [
    { key: 'today', label: t('dashboard.kpiAppointments'), icon: 'appointments', tone: 'var(--primary)', to: '/turnos',
      value: loadingAppts.value ? '…' : list.length },
    { key: 'pending', label: t('dashboard.kpiPending'), icon: 'clock', tone: 'var(--warning)', to: '/turnos',
      value: loadingAppts.value ? '…' : list.filter((a) => ['scheduled', 'confirmed'].includes(a.status)).length },
    { key: 'patients', label: t('dashboard.kpiPatients'), icon: 'patients', tone: 'var(--info)', to: '/pacientes',
      value: patientsTotal.value ?? '…' },
    { key: 'vaccines', label: t('dashboard.kpiVaccines'), icon: 'vaccines', tone: 'var(--accent-violet)', to: '/vacunas',
      value: vaccineAlerts.value.length },
  ]
})

const isAdmin = computed(() => auth.hasRole('org_admin', 'superadmin'))
const onboardingSteps = computed(() => {
  const steps = [
    { key: 'patient', label: t('dashboard.onboardingPatient'), icon: 'patients', to: '/pacientes', done: (patientsTotal.value || 0) > 0 },
    { key: 'appointment', label: t('dashboard.onboardingAppointment'), icon: 'appointments', to: '/turnos', done: anyAppointment.value },
  ]
  if (isAdmin.value) {
    steps.push({ key: 'team', label: t('dashboard.onboardingTeam'), icon: 'clients', to: '/admin', done: (subscription.data?.seats?.users || 0) > 1 })
    steps.push({ key: 'plan', label: t('dashboard.onboardingPlan'), icon: 'subscription', to: '/suscripcion',
      done: ['active', 'legacy'].includes(subscription.summary?.status) })
  }
  return steps
})
const completedSteps = computed(() => onboardingSteps.value.filter((step) => step.done).length)
const showOnboarding = computed(() => !onboardingHidden.value && patientsTotal.value !== null
  && completedSteps.value < onboardingSteps.value.length)

// Fecha local (no UTC): a la noche en Argentina la fecha UTC ya es la del día siguiente.
function localDateKey(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function formatTime(value) {
  if (!value) return '—'
  return new Date(value).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

function formatDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })
}

function unwrapList(data) {
  const payload = data?.data ?? data
  return Array.isArray(payload) ? payload : (payload?.items || payload?.appointments || [])
}

async function loadAppointments() {
  try {
    const { data } = await appointmentsApi.list({ date: localDateKey(), limit: 50 })
    todayAppointments.value = unwrapList(data)
      .slice()
      .sort((a, b) => String(a.scheduled_date).localeCompare(String(b.scheduled_date)))
  } catch (error) {
    logError('dashboard.loadAppointments', error)
    appointmentsError.value = extractDetailedErrorMessage(error, 'No se pudieron cargar los turnos de hoy.', { context: 'Inicio' })
  } finally {
    loadingAppts.value = false
  }
}

async function loadPatientsTotal() {
  try {
    const { data } = await patientsApi.list({ limit: 1 })
    patientsTotal.value = data.total ?? data.pagination?.total ?? data.meta?.total ?? unwrapList(data).length
  } catch (error) {
    logError('dashboard.loadPatients', error)
    patientsTotal.value = 0
  }
}

async function loadVaccineAlerts() {
  if (!canSee('vaccinations')) return
  try {
    const { data } = await vaccinationsApi.alerts()
    vaccineAlerts.value = unwrapList(data).slice(0, 6)
  } catch (error) {
    logError('dashboard.loadVaccineAlerts', error)
  }
}

async function loadAnyAppointment() {
  if (onboardingHidden.value) return
  try {
    const { data } = await appointmentsApi.list({ limit: 1 })
    anyAppointment.value = unwrapList(data).length > 0
  } catch (error) {
    logError('dashboard.loadAnyAppointment', error)
  }
}

onMounted(() => {
  loadAppointments()
  loadPatientsTotal()
  loadVaccineAlerts()
  loadAnyAppointment()
  if (isAdmin.value) subscription.load()
})
</script>

<style scoped>
.dashboard {
  display: flex;
  flex-direction: column;
  gap: 18px;
  max-width: 1280px;
}

.welcome {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.welcome__title {
  font-size: 1.45rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.welcome__sub {
  margin-top: 2px;
  color: var(--text-3);
}

.welcome__actions {
  display: flex;
  gap: 8px;
}

/* Primeros pasos */
.onboarding {
  padding: 18px 20px;
  border: 1px solid color-mix(in srgb, var(--primary) 30%, var(--border));
  border-radius: var(--radius-lg);
  background: var(--primary-xlight);
}

.onboarding__head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.onboarding__head > div {
  flex: 1;
}

.onboarding__head h3 {
  font-size: 1rem;
}

.onboarding__head p {
  color: var(--text-2);
  font-size: 0.88rem;
  margin-top: 2px;
}

.onboarding__count {
  font-weight: 700;
  color: var(--primary);
  font-variant-numeric: tabular-nums;
}

.onboarding__hide {
  border: none;
  background: transparent;
  color: var(--text-3);
  font-size: 0.82rem;
  cursor: pointer;
}

.onboarding__steps {
  list-style: none;
  margin-top: 14px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
}

.onboarding__steps a {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border-radius: var(--radius);
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text);
  font-weight: 600;
  font-size: 0.88rem;
}

.onboarding__steps a:hover {
  border-color: var(--primary);
}

.onboarding__steps li.done a {
  color: var(--text-3);
  text-decoration: line-through;
}

.onboarding__check {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--surface-3);
  color: var(--text-2);
}

.onboarding__steps li.done .onboarding__check {
  background: var(--success);
  color: #FFFFFF;
}

.onboarding__arrow {
  margin-left: auto;
  color: var(--text-3);
}

/* KPIs */
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.kpi-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  color: var(--text);
  transition: border-color var(--transition);
}

.kpi-card:hover {
  border-color: var(--border-strong);
  color: var(--text);
}

.kpi-card__icon {
  width: 42px;
  height: 42px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius);
  color: var(--tone);
  background: color-mix(in srgb, var(--tone) 12%, transparent);
}

.kpi-card__value {
  display: block;
  font-size: 1.5rem;
  font-weight: 700;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

.kpi-card__label {
  display: block;
  margin-top: 2px;
  font-size: 0.8rem;
  color: var(--text-3);
}

/* Paneles */
.columns {
  display: grid;
  grid-template-columns: 1.6fr 1fr;
  gap: 18px;
}

.panel {
  padding: 18px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
}

.panel__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
}

.panel__head h3 {
  font-size: 1rem;
}

.panel__link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.84rem;
  font-weight: 600;
}

.panel__empty {
  color: var(--text-3);
  font-size: 0.88rem;
}

.empty {
  padding: 24px 0;
  text-align: center;
  color: var(--text-3);
}

.skeleton-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.skeleton-list span {
  height: 52px;
  border-radius: var(--radius);
  background: linear-gradient(90deg, var(--surface-2), var(--surface-3), var(--surface-2));
  background-size: 200% 100%;
  animation: shimmer 1.2s ease-in-out infinite;
}

@keyframes shimmer {
  from { background-position: 100% 0; }
  to { background-position: -100% 0; }
}

.appt-list,
.alert-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.appt-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-2);
}

.appt-row:hover {
  background: var(--surface-2);
  color: var(--text-2);
}

.appt-row__time {
  min-width: 46px;
  font-weight: 700;
  color: var(--primary);
  font-variant-numeric: tabular-nums;
}

.appt-row__info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.appt-row__info strong {
  color: var(--text);
}

.appt-row__info span {
  font-size: 0.8rem;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.badge {
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 0.74rem;
  font-weight: 600;
  white-space: nowrap;
  background: var(--surface-3);
  color: var(--text-2);
}

.badge--scheduled { background: var(--info-light); color: var(--info); }
.badge--confirmed { background: var(--primary-xlight); color: var(--primary); }
.badge--in_progress { background: var(--warning-light); color: var(--warning); }
.badge--completed { background: var(--success-light); color: var(--success); }
.badge--cancelled { background: var(--danger-light); color: var(--danger); }

.alert-list li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
}

.alert-list li + li {
  border-top: 1px solid var(--border);
}

.alert-list__icon {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: color-mix(in srgb, var(--accent-violet) 12%, transparent);
  color: var(--accent-violet);
}

.alert-list__icon.overdue {
  background: var(--danger-light);
  color: var(--danger);
}

.alert-list__info {
  display: flex;
  flex-direction: column;
  font-size: 0.86rem;
}

.alert-list__info span {
  color: var(--text-3);
  font-size: 0.8rem;
}

.quick-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
}

.quick-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-2);
  font-weight: 600;
  font-size: 0.88rem;
}

.quick-card :deep(svg) {
  color: var(--primary);
}

.quick-card:hover {
  border-color: var(--primary);
  background: var(--primary-xlight);
  color: var(--text);
}

@media (max-width: 1100px) {
  .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .columns { grid-template-columns: 1fr; }
}

@media (max-width: 560px) {
  .kpi-grid { grid-template-columns: 1fr; }
  .welcome__actions { width: 100%; }
  .welcome__actions > * { flex: 1; }
}
</style>
