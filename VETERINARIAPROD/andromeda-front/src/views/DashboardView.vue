<template>
  <div class="dashboard" aria-live="polite">
    <div class="welcome">
      <div>
        <h2 class="welcome__title">{{ t('dashboard.greeting') }}, {{ firstName }} <span aria-hidden="true">&#x1F44B;</span></h2>
        <p class="welcome__sub">{{ today }}</p>
      </div>
      <div class="welcome__summary" aria-label="Resumen operativo">
        <span>Agenda {{ kpis[0].value }}</span>
        <span>Pendientes {{ kpis[2].value }}</span>
        <span>Pacientes {{ kpis[1].value }}</span>
      </div>
    </div>

    <div class="kpi-grid">
      <div v-for="kpi in kpis" :key="kpi.label" class="kpi-card" :style="{ '--accent': kpi.color }">
        <div class="kpi-card__icon" aria-hidden="true">{{ kpi.icon }}</div>
        <div class="kpi-card__body">
          <span class="kpi-card__value">{{ kpi.value }}</span>
          <span class="kpi-card__label">{{ kpi.label }}</span>
        </div>
      </div>
    </div>

    <div class="section appointments-section">
      <div class="section__head">
        <h3>{{ t('dashboard.todayAppointments') }}</h3>
        <RouterLink to="/turnos" class="section__link" :aria-label="t('dashboard.todayAppointments')">
          {{ t('common.viewAll') }} &rarr;
        </RouterLink>
      </div>
      <div v-if="loadingAppts" class="loading-placeholder" role="status" :aria-label="t('dashboard.loadingAppointments')">
        {{ t('common.loading') }}
      </div>
      <div v-else-if="appointmentsError" class="alert alert--error" role="alert">
        {{ appointmentsError }}
      </div>
      <div v-else-if="todayAppointments.length === 0" class="empty-state">
        <span aria-hidden="true">&#x1F4C5;</span> {{ t('dashboard.noAppointments') }}
      </div>
      <div v-else class="appt-list">
        <div
          v-for="appt in todayAppointments"
          :key="appt.id"
          class="appt-row"
          tabindex="0"
        >
          <div class="appt-row__time">{{ formatTime(appt.scheduled_date) }}</div>
          <div class="appt-row__info">
            <span class="appt-row__patient">{{ appt.patient_name }}</span>
            <span class="appt-row__reason">{{ appt.reason || appt.appointment_type }}</span>
          </div>
          <span class="appt-row__badge" :class="`status--${appt.status}`">
            {{ STATUS_LABELS[appt.status] || appt.status }}
          </span>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section__head">
        <h3>{{ t('dashboard.quickAccess') }}</h3>
      </div>
      <div class="quick-grid">
        <RouterLink
          v-for="item in quickItems"
          :key="item.key"
          :to="item.to"
          class="quick-card"
          :aria-label="item.label"
        >
          <span class="quick-card__icon" aria-hidden="true">{{ item.icon }}</span>
          <span class="quick-card__label">{{ item.label }}</span>
        </RouterLink>
      </div>
    </div>

    <div class="section clinical-section">
      <div class="section__head">
        <h3>Flujo clínico</h3>
      </div>
      <div class="flow-grid">
        <RouterLink v-for="step in clinicalFlow" :key="step.key" :to="step.to" class="flow-step">
          <span class="flow-step__index">{{ step.index }}</span>
          <span class="flow-step__body">
            <strong>{{ step.label }}</strong>
            <small>{{ step.description }}</small>
          </span>
        </RouterLink>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { appointmentsApi, patientsApi } from '../api'
import { t } from '../i18n'
import { useAuthStore } from '../stores/auth'
import { extractDetailedErrorMessage, logError } from '../utils/errors'

type AppointmentStatus = 'scheduled' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled' | 'no_show'

type AppointmentRow = {
  id: number | string
  scheduled_date?: string
  patient_name?: string
  reason?: string
  appointment_type?: string
  status: AppointmentStatus | string
}

type KpiCard = {
  label: string
  icon: string
  value: string | number
  color: string
}

const auth = useAuthStore()

const DEFAULT_QUICK_ITEMS = [
  { key: 'appointments', label: 'Turnos', icon: '\u{1F4C5}', to: '/turnos' },
  { key: 'patients', label: 'Pacientes', icon: '\u{1F43E}', to: '/pacientes' },
  { key: 'medical', label: 'Evoluciones', icon: '\u{1F4CB}', to: '/evoluciones' },
  { key: 'laboratorio', label: 'Laboratorio', icon: '\u{1F9EA}', to: '/laboratorio' },
  { key: 'imagenes', label: 'Imágenes', icon: '\u{1FA7B}', to: '/imagenes' },
  { key: 'billing', label: 'Facturación', icon: '\u{1F4B0}', to: '/facturacion' },
]

const clinicalFlow = [
  { key: 'medical', index: '01', label: 'Evolución', description: 'Origen clínico y criterio médico', to: '/evoluciones' },
  { key: 'laboratorio', index: '02', label: 'Laboratorio', description: 'Órdenes vinculadas a una ficha', to: '/laboratorio' },
  { key: 'imagenes', index: '03', label: 'Imágenes', description: 'Estudios con trazabilidad clínica', to: '/imagenes' },
  { key: 'billing', index: '04', label: 'Cierre', description: 'Facturación y seguimiento', to: '/facturacion' },
]

const firstName = computed(() => {
  const user = auth.user
  const name = user?.name || user?.email?.split('@')[0] || 'Usuario'
  return String(name).split(' ')[0]
})

const today = computed(() => new Date().toLocaleDateString('es-AR', {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
}))

const quickItems = computed(() => {
  const allowed = auth.allowedMenu?.length ? auth.allowedMenu : DEFAULT_QUICK_ITEMS
  return allowed.filter((item) => item.key !== 'dashboard').slice(0, 6)
})

const STATUS_LABELS: Record<string, string> = {
  scheduled: t('dashboard.statusScheduled'),
  confirmed: t('dashboard.statusConfirmed'),
  in_progress: t('dashboard.statusInProgress'),
  completed: t('dashboard.statusCompleted'),
  cancelled: t('dashboard.statusCancelled'),
  no_show: t('dashboard.statusNoShow'),
}

const kpis = ref<KpiCard[]>([
  { label: t('dashboard.kpiAppointments'), icon: '\u{1F4C5}', value: '-', color: 'var(--primary)' },
  { label: t('dashboard.kpiPatients'), icon: '\u{1F43E}', value: '-', color: 'var(--accent-blue)' },
  { label: t('dashboard.kpiPending'), icon: '\u23F3', value: '-', color: 'var(--accent-gold)' },
  { label: t('dashboard.kpiCompleted'), icon: '\u2705', value: '-', color: 'var(--accent-mint)' },
])

const todayAppointments = ref<AppointmentRow[]>([])
const loadingAppts = ref(true)
const appointmentsError = ref('')

function formatTime(dt?: string) {
  if (!dt) return '-'
  return new Date(dt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

onMounted(async () => {
  try {
    const currentDay = new Date().toISOString().split('T')[0]
    const { data } = await appointmentsApi.list({ date: currentDay, limit: 20 })
    const list = (data.data || data.appointments || data || []) as AppointmentRow[]
    todayAppointments.value = list
    kpis.value[0].value = list.length
    kpis.value[2].value = list.filter((item) => item.status === 'scheduled' || item.status === 'confirmed').length
    kpis.value[3].value = list.filter((item) => item.status === 'completed').length
  } catch (error) {
    logError('dashboard.loadAppointments', error)
    todayAppointments.value = []
    appointmentsError.value = extractDetailedErrorMessage(error, 'No se pudieron cargar los turnos de hoy.', { context: 'Dashboard' })
  } finally {
    loadingAppts.value = false
  }

  try {
    const { data } = await patientsApi.list({ limit: 1 })
    kpis.value[1].value = data.total ?? data.pagination?.total ?? '-'
  } catch (error) {
    logError('dashboard.loadPatientsKpi', error)
    kpis.value[1].value = '-'
  }
})
</script>

<style scoped>
.dashboard { display: flex; flex-direction: column; gap: 18px; }
.welcome {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--white);
}
.welcome__title { font-size: 1.32rem; font-weight: 800; color: var(--text); }
.welcome__sub { font-size: 0.85rem; color: var(--text-3); margin-top: 3px; text-transform: capitalize; }
.welcome__summary {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.welcome__summary span {
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-2);
  color: var(--text-2);
  font-size: 0.78rem;
  font-weight: 800;
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
}

.kpi-card {
  background: var(--white);
  border-radius: var(--radius-lg);
  padding: 16px;
  display: flex;
  align-items: center;
  gap: 14px;
  border: 1px solid var(--border);
  border-left: 4px solid var(--accent);
  transition: border-color var(--transition), background var(--transition);
}

.kpi-card:hover { border-color: var(--border-strong); background: var(--surface-2); }
.kpi-card__icon { font-size: 1.55rem; }
.kpi-card__value { display: block; font-size: 1.48rem; font-weight: 850; color: var(--text); line-height: 1; }
.kpi-card__label { display: block; font-size: 0.78rem; color: var(--text-3); margin-top: 5px; font-weight: 700; }

.section { background: var(--white); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 18px; }
.section__head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.section__head h3 { font-size: 1rem; font-weight: 800; color: var(--text); }
.section__link { font-size: 0.82rem; color: var(--primary); font-weight: 800; }

.appt-list { display: flex; flex-direction: column; gap: 8px; }
.appt-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--surface);
  transition: background var(--transition);
  outline: none;
}

.appt-row:hover,
.appt-row:focus-visible { background: var(--primary-xlight); border-color: rgba(15, 118, 110, 0.24); }
.appt-row__time { font-size: 0.85rem; font-weight: 600; color: var(--primary); min-width: 50px; }
.appt-row__info { flex: 1; min-width: 0; }
.appt-row__patient { display: block; font-size: 0.9rem; font-weight: 600; color: var(--text); }
.appt-row__reason { display: block; font-size: 0.78rem; color: var(--text-3); }

.appt-row__badge {
  font-size: 0.72rem;
  font-weight: 600;
  padding: 3px 9px;
  border-radius: 20px;
  white-space: nowrap;
}

.status--scheduled { background: #EBF5FF; color: #2980b9; }
.status--confirmed { background: #EAF5EA; color: #27ae60; }
.status--in_progress { background: #FFF8E7; color: #d68910; }
.status--completed { background: #EAFAF1; color: #1e8449; }
.status--cancelled { background: var(--danger-light); color: #c0392b; }
.status--no_show { background: var(--surface-2); color: var(--text-3); }

.quick-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  gap: 12px;
}

.quick-card {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  min-height: 64px;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  text-decoration: none;
  color: var(--text-2);
  font-size: 0.82rem;
  font-weight: 800;
  text-align: left;
  transition: background var(--transition), color var(--transition), border-color var(--transition);
}

.quick-card:hover,
.quick-card:focus-visible {
  background: var(--primary-xlight);
  border-color: rgba(15, 118, 110, 0.26);
  color: var(--primary-hover);
}

.quick-card__icon { font-size: 1.35rem; }

.flow-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}

.flow-step {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 76px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  text-decoration: none;
  color: var(--text-2);
  transition: border-color var(--transition), background var(--transition);
}

.flow-step:hover,
.flow-step:focus-visible {
  background: var(--primary-xlight);
  border-color: rgba(15, 118, 110, 0.28);
}

.flow-step__index {
  color: var(--primary);
  font-size: 0.72rem;
  font-weight: 900;
}

.flow-step__body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.flow-step__body strong {
  color: var(--text);
  font-size: 0.9rem;
}

.flow-step__body small {
  color: var(--text-3);
  font-size: 0.76rem;
  line-height: 1.35;
}

.loading-placeholder { color: var(--text-3); font-size: 0.9rem; text-align: center; padding: 20px; }
.alert--error {
  background: #FDEAEA;
  color: #c0392b;
  border-left: 3px solid var(--danger);
  border-radius: var(--radius);
  padding: 12px 14px;
}
.empty-state {
  text-align: center;
  padding: 28px;
  color: var(--text-3);
  font-size: 0.9rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

@media (max-width: 920px) {
  .flow-grid { grid-template-columns: repeat(2, 1fr); }
}

@media (max-width: 680px) {
  .welcome {
    align-items: flex-start;
    flex-direction: column;
  }

  .welcome__summary {
    justify-content: flex-start;
    width: 100%;
  }

  .kpi-grid,
  .quick-grid,
  .flow-grid {
    grid-template-columns: 1fr;
  }

  .appt-row {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .appt-row__time {
    min-width: auto;
  }

  .appt-row__badge {
    margin-left: auto;
  }
}
</style>
