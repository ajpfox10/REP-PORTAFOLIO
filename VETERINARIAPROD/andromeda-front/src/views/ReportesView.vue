<template>
  <div class="page">
    <div class="page-header">
      <div class="page-header__left">
        <span class="page-emoji" aria-hidden="true">{{ t('reports.emoji') }}</span>
        <div>
          <h2 class="page-title">{{ t('reports.title') }}</h2>
          <p class="page-sub">{{ t('reports.subtitle') }}</p>
        </div>
      </div>

      <BaseButton type="button" @click="exportReport">
        {{ t('reports.export') }}
      </BaseButton>
    </div>

    <div class="period-bar" aria-label="report-period-controls">
      <span class="period-label">{{ t('reports.periodLabel') }}</span>
      <BaseButton
        v-for="p in PERIODS"
        :key="p.value"
        type="button"
        variant="ghost"
        size="sm"
        class="period-btn"
        :class="{ 'period-btn--active': period === p.value }"
        :aria-pressed="period === p.value"
        @click="setPeriod(p.value)"
      >
        {{ p.label }}
      </BaseButton>
      <div class="period-custom">
        <label for="rep-date-from" class="sr-only">{{ t('reports.dateFrom') }}</label>
        <input id="rep-date-from" name="rep-date-from" v-model="dateFrom" type="date" class="filter-input" @change="load()" />
        <span aria-hidden="true">{{ t('common.rangeSeparator') }}</span>
        <label for="rep-date-to" class="sr-only">{{ t('reports.dateTo') }}</label>
        <input id="rep-date-to" name="rep-date-to" v-model="dateTo" type="date" class="filter-input" @change="load()" />
      </div>
    </div>

    <div v-if="loading" class="loading-state" role="status">
      <span class="spin spin--dark" />
      {{ t('reports.loading') }}
    </div>
    <div v-else-if="error" class="alert alert--error" role="alert">{{ error }}</div>

    <template v-else>
      <div class="kpi-grid">
        <div class="kpi-card" style="--bc:#D6F3EC;--tc:#1A9E7F;">
          <div class="kpi-card__icon" aria-hidden="true">{{ t('reports.kpiPatientsIcon') }}</div>
          <div>
            <strong>{{ data.totalPatients ?? '—' }}</strong>
            <span>{{ t('reports.totalPatients') }}</span>
          </div>
        </div>
        <div class="kpi-card" style="--bc:#D6EEFF;--tc:#1A5FAA;">
          <div class="kpi-card__icon" aria-hidden="true">{{ t('reports.kpiAppointmentsIcon') }}</div>
          <div>
            <strong>{{ data.totalAppointments ?? '—' }}</strong>
            <span>{{ t('reports.totalAppointments') }}</span>
          </div>
        </div>
        <div class="kpi-card" style="--bc:#FFF3CC;--tc:#8A6200;">
          <div class="kpi-card__icon" aria-hidden="true">{{ t('reports.kpiVaccinesIcon') }}</div>
          <div>
            <strong>{{ data.totalVaccinations ?? '—' }}</strong>
            <span>{{ t('reports.totalVaccinations') }}</span>
          </div>
        </div>
        <div class="kpi-card" style="--bc:#FFE4D6;--tc:#c0392b;">
          <div class="kpi-card__icon" aria-hidden="true">{{ t('reports.kpiGroomingIcon') }}</div>
          <div>
            <strong>{{ data.totalGrooming ?? '—' }}</strong>
            <span>{{ t('reports.totalGrooming') }}</span>
          </div>
        </div>
        <div class="kpi-card" style="--bc:#EEE0FF;--tc:#7A3DAA;">
          <div class="kpi-card__icon" aria-hidden="true">{{ t('reports.kpiTelemedicineIcon') }}</div>
          <div>
            <strong>{{ data.totalTelemedicine ?? '—' }}</strong>
            <span>{{ t('reports.totalTelemedicine') }}</span>
          </div>
        </div>
        <div class="kpi-card" style="--bc:#E0FFE8;--tc:#2E8B57;">
          <div class="kpi-card__icon" aria-hidden="true">{{ t('reports.kpiRevenueIcon') }}</div>
          <div>
            <strong>${{ formatMoney(data.totalRevenue) }}</strong>
            <span>{{ t('reports.totalRevenue') }}</span>
          </div>
        </div>
      </div>

      <div class="section-grid">
        <section class="report-section" aria-labelledby="report-status-title">
          <h3 id="report-status-title" class="section-title">{{ t('reports.appointmentsByStatus') }}</h3>
          <div class="bar-chart">
            <div v-for="(count, status) in data.appointmentsByStatus" :key="status" class="bar-row">
              <span class="bar-label">{{ STATUS_LABELS[status] || status }}</span>
              <div class="bar-track">
                <div class="bar-fill" :style="{ width: barWidth(count, maxApptStatus) + '%', background: statusColor(status) }" />
              </div>
              <span class="bar-count">{{ count }}</span>
            </div>
          </div>
        </section>

        <section class="report-section" aria-labelledby="report-species-title">
          <h3 id="report-species-title" class="section-title">{{ t('reports.patientsBySpecies') }}</h3>
          <div class="species-list">
            <div v-for="(count, species) in data.patientsBySpecies" :key="species" class="species-row">
              <span class="species-emoji" aria-hidden="true">{{ petEmoji(species) }}</span>
              <span class="species-name">{{ speciesLabel(species) }}</span>
              <div class="species-bar-track">
                <div class="species-bar" :style="{ width: barWidth(count, maxSpecies) + '%' }" />
              </div>
              <span class="species-count">{{ count }}</span>
            </div>
          </div>
        </section>
      </div>

      <section v-if="data.topDiagnoses?.length" class="report-section" aria-labelledby="report-diagnoses-title">
        <h3 id="report-diagnoses-title" class="section-title">{{ t('reports.topDiagnoses') }}</h3>
        <div class="top-list">
          <div v-for="(d, idx) in data.topDiagnoses" :key="idx" class="top-item">
            <span class="top-rank">{{ idx + 1 }}</span>
            <span class="top-name">{{ d.diagnosis }}</span>
            <div class="top-bar-track">
              <div class="top-bar" :style="{ width: barWidth(d.count, data.topDiagnoses[0]?.count) + '%' }" />
            </div>
            <span class="top-count">{{ t('reports.casesCount', { count: d.count }) }}</span>
          </div>
        </div>
      </section>

      <section v-if="data.topVaccines?.length" class="report-section" aria-labelledby="report-vaccines-title">
        <h3 id="report-vaccines-title" class="section-title">{{ t('reports.topVaccines') }}</h3>
        <div class="vaccine-chips">
          <div v-for="(v, idx) in data.topVaccines" :key="idx" class="vaccine-chip">
            <span class="vaccine-rank">{{ idx + 1 }}°</span>
            <span class="vaccine-name">{{ v.vaccine_name }}</span>
            <span class="vaccine-count">{{ v.count }}</span>
          </div>
        </div>
      </section>

      <section v-if="data.revenueByMonth?.length" class="report-section" aria-labelledby="report-revenue-title">
        <h3 id="report-revenue-title" class="section-title">{{ t('reports.revenueByMonth') }}</h3>
        <div class="revenue-chart">
          <div v-for="m in data.revenueByMonth" :key="m.month" class="rev-col">
            <div class="rev-bar-wrap">
              <div class="rev-bar" :style="{ height: barWidth(m.total, maxRevenue) + '%' }" />
            </div>
            <span class="rev-label">${{ formatMoneyShort(m.total) }}</span>
            <span class="rev-month">{{ formatMonth(m.month) }}</span>
          </div>
        </div>
      </section>

      <div v-if="!hasData" class="empty-state">
        <span class="empty-state__emoji" aria-hidden="true">{{ t('reports.emoji') }}</span>
        <p>{{ t('reports.emptyState') }}</p>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { appointmentsApi, patientsApi, reportsApi } from '../api'
import BaseButton from '../components/base/BaseButton.vue'
import { t } from '../i18n'
import { extractDetailedErrorMessage, logError } from '../utils/errors'
import { useUiFeedback } from '../composables/useUiFeedback'

const { notifyError, success } = useUiFeedback()

const loading = ref(false)
const error = ref('')
const period = ref('month')
const dateFrom = ref('')
const dateTo = ref('')

const data = ref({
  totalPatients: null,
  totalAppointments: null,
  totalVaccinations: null,
  totalGrooming: null,
  totalTelemedicine: null,
  totalRevenue: 0,
  appointmentsByStatus: {},
  patientsBySpecies: {},
  topDiagnoses: [],
  topVaccines: [],
  revenueByMonth: [],
})

const PERIODS = [
  { value: 'today', label: t('reports.periodToday') },
  { value: 'week', label: t('reports.periodWeek') },
  { value: 'month', label: t('reports.periodMonth') },
  { value: 'year', label: t('reports.periodYear') },
]

const STATUS_LABELS = {
  scheduled: t('reports.statusScheduled'),
  confirmed: t('reports.statusConfirmed'),
  in_progress: t('reports.statusInProgress'),
  completed: t('reports.statusCompleted'),
  cancelled: t('reports.statusCancelled'),
  no_show: t('reports.statusNoShow'),
}

const maxApptStatus = computed(() => Math.max(1, ...Object.values(data.value.appointmentsByStatus || {})))
const maxSpecies = computed(() => Math.max(1, ...Object.values(data.value.patientsBySpecies || {})))
const maxRevenue = computed(() => Math.max(1, ...(data.value.revenueByMonth || []).map((m) => m.total)))
const hasData = computed(() => data.value.totalPatients !== null || Object.keys(data.value.appointmentsByStatus || {}).length > 0)

function barWidth(val, max) {
  return max ? Math.round((val / max) * 100) : 0
}

function petEmoji(species) {
  const map = {
    dog: '\u{1F43E}',
    cat: '\u{1F43E}',
    rabbit: '\u{1F43E}',
    bird: '\u{1F43E}',
    fish: '\u{1F43E}',
    reptile: '\u{1F43E}',
    hamster: '\u{1F43E}',
  }
  return map[species] || '\u{1F43E}'
}

function speciesLabel(species) {
  const map = {
    dog: t('reports.speciesDog'),
    cat: t('reports.speciesCat'),
    rabbit: t('reports.speciesRabbit'),
    bird: t('reports.speciesBird'),
    fish: t('reports.speciesFish'),
    reptile: t('reports.speciesReptile'),
    hamster: t('reports.speciesHamster'),
  }
  return map[species] || species
}

function statusColor(status) {
  const map = {
    scheduled: '#90D5F0',
    confirmed: '#06D6A0',
    in_progress: '#FFB703',
    completed: '#1A9E7F',
    cancelled: '#EF5350',
    no_show: '#C8E8DC',
  }
  return map[status] || 'var(--primary)'
}

function formatMoney(value) {
  return parseFloat(value || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })
}

function formatMoneyShort(value) {
  const numeric = parseFloat(value || 0)
  if (numeric >= 1000000) return `${(numeric / 1000000).toFixed(1)}M`
  if (numeric >= 1000) return `${(numeric / 1000).toFixed(1)}K`
  return numeric.toFixed(0)
}

function formatMonth(month) {
  if (!month) return ''
  const date = new Date(`${month}-01`)
  return date.toLocaleDateString('es-AR', { month: 'short' })
}

function setPeriod(value) {
  period.value = value
  const now = new Date()
  const today = now.toISOString().split('T')[0]

  if (value === 'today') {
    dateFrom.value = today
    dateTo.value = today
  } else if (value === 'week') {
    const monday = new Date(now)
    monday.setDate(now.getDate() - now.getDay() + 1)
    dateFrom.value = monday.toISOString().split('T')[0]
    dateTo.value = today
  } else if (value === 'month') {
    dateFrom.value = `${today.slice(0, 7)}-01`
    dateTo.value = today
  } else if (value === 'year') {
    dateFrom.value = `${today.slice(0, 4)}-01-01`
    dateTo.value = today
  }

  load()
}

function validateDateRange() {
  if (!dateFrom.value || !dateTo.value) return true // usa defaults
  const from = new Date(dateFrom.value)
  const to = new Date(dateTo.value)
  if (to < from) {
    error.value = 'La fecha de inicio debe ser anterior a la fecha de fin'
    return false
  }
  const diffDays = (to - from) / (1000 * 60 * 60 * 24)
  if (diffDays > 730) {
    error.value = 'El rango máximo de consulta es de 2 años'
    return false
  }
  return true
}

async function load() {
  if (!validateDateRange()) return
  loading.value = true
  error.value = ''
  const from = dateFrom.value
  const to = dateTo.value

  try {
    const [appts, patients, revenue, apptReport] = await Promise.allSettled([
      appointmentsApi.list({ limit: 1 }),
      patientsApi.list({ limit: 1 }),
      reportsApi.revenue({ from, to }),
      reportsApi.appointments({ from, to }),
    ])

    const apptMeta = appts.status === 'fulfilled' ? appts.value.data?.meta : null
    const patientMeta = patients.status === 'fulfilled' ? patients.value.data?.meta : null
    const revenueRows = revenue.status === 'fulfilled' ? (revenue.value.data?.data || revenue.value.data || []) : []
    const apptData = apptReport.status === 'fulfilled' ? (apptReport.value.data?.data || apptReport.value.data || {}) : {}

    const totalRevenue = Array.isArray(revenueRows)
      ? revenueRows.reduce((sum, row) => sum + parseFloat(row.gross_revenue || row.total_amount || 0), 0)
      : 0

    data.value = {
      totalPatients: patientMeta?.total ?? null,
      totalAppointments: apptMeta?.total ?? null,
      totalVaccinations: null,
      totalGrooming: null,
      totalTelemedicine: null,
      totalRevenue,
      appointmentsByStatus: {},
      patientsBySpecies: {},
      topDiagnoses: [],
      topVaccines: [],
      revenueByMonth: Array.isArray(revenueRows)
        ? revenueRows.slice(0, 12).map((row) => ({ month: row.period, total: row.gross_revenue || 0 }))
        : [],
    }

    if (apptData.summary) {
      data.value.appointmentsByStatus = {
        scheduled: Number(apptData.summary.total_scheduled || 0),
        confirmed: Number(apptData.summary.confirmed || 0),
        in_progress: Number(apptData.summary.in_progress || 0),
        completed: Number(apptData.summary.completed || 0),
        cancelled: Number(apptData.summary.cancelled || 0),
        no_show: Number(apptData.summary.no_show || 0),
      }
    }
  } catch (e) {
    logError('reportes.load', e)
    error.value = extractDetailedErrorMessage(e, t('reports.loadError'), { context: 'Carga de reportes' })
  } finally {
    loading.value = false
  }
}

async function exportReport() {
  try {
    const payload = { format: 'csv' }
    if (dateFrom.value) payload.from = dateFrom.value
    if (dateTo.value) payload.to = dateTo.value

    const { data: blob } = await reportsApi.exportRevenue(payload)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `reporte_${dateFrom.value || 'periodo'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  } catch (error) {
    notifyError('reportes.exportCsv', error, t('reports.exportError'), {
      context: 'Exportación de reporte',
      meta: { dateFrom: dateFrom.value, dateTo: dateTo.value },
    })
    return
  }
  success('Reporte exportado correctamente.')
}

onMounted(() => setPeriod('month'))
</script>

<style scoped>
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }

.page {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}

.page-header__left {
  display: flex;
  align-items: center;
  gap: 14px;
}

.page-emoji {
  font-size: 2rem;
}

.page-title {
  font-size: 1.35rem;
  font-weight: 700;
  color: var(--text);
}

.page-sub {
  font-size: 0.82rem;
  color: var(--text-2);
  margin-top: 2px;
}

.period-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.period-label {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text-2);
}

.period-btn {
  min-width: auto;
}

.period-btn--active {
  background: var(--primary);
  color: white;
  border-color: var(--primary);
}

.period-custom {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: 8px;
}

.filter-input {
  padding: 7px 11px;
  border: 1.5px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 0.85rem;
  background: var(--white);
  color: var(--text);
  outline: none;
}

.filter-input:focus {
  border-color: var(--primary);
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
}

.kpi-card {
  background: var(--bc);
  border-radius: var(--radius-lg);
  padding: 16px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.kpi-card__icon {
  font-size: 1.8rem;
}

.kpi-card strong {
  display: block;
  font-size: 1.4rem;
  font-weight: 700;
  color: var(--tc);
  line-height: 1;
}

.kpi-card span {
  font-size: 0.72rem;
  color: var(--tc);
  opacity: 0.75;
  margin-top: 4px;
  display: block;
}

.section-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.report-section {
  background: var(--white);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-sm);
  padding: 20px 22px;
}

.section-title {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--text);
  margin-bottom: 16px;
}

.bar-chart {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.bar-row {
  display: grid;
  grid-template-columns: 100px 1fr 36px;
  align-items: center;
  gap: 10px;
}

.bar-label {
  font-size: 0.78rem;
  color: var(--text-2);
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bar-track {
  background: var(--surface-2);
  border-radius: 4px;
  height: 10px;
}

.bar-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.6s ease;
}

.bar-count {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text);
}

.species-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.species-row {
  display: grid;
  grid-template-columns: 24px 80px 1fr 36px;
  align-items: center;
  gap: 8px;
}

.species-emoji {
  font-size: 1.2rem;
}

.species-name {
  font-size: 0.82rem;
  color: var(--text-2);
}

.species-bar-track {
  background: var(--surface-2);
  border-radius: 4px;
  height: 10px;
}

.species-bar {
  background: var(--primary);
  height: 100%;
  border-radius: 4px;
  transition: width 0.6s ease;
}

.species-count {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text);
}

.top-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.top-item {
  display: grid;
  grid-template-columns: 24px 1fr 2fr 70px;
  align-items: center;
  gap: 10px;
}

.top-rank {
  width: 22px;
  height: 22px;
  background: var(--primary-xlight);
  color: var(--primary);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.72rem;
  font-weight: 700;
}

.top-name {
  font-size: 0.85rem;
  color: var(--text);
}

.top-bar-track {
  background: var(--surface-2);
  border-radius: 4px;
  height: 8px;
}

.top-bar {
  background: var(--accent-mint);
  height: 100%;
  border-radius: 4px;
  transition: width 0.6s ease;
}

.top-count {
  font-size: 0.78rem;
  color: var(--text-3);
  text-align: right;
}

.vaccine-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.vaccine-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  background: #fdeaea;
  border-radius: var(--radius);
  padding: 8px 14px;
}

.vaccine-rank {
  width: 20px;
  height: 20px;
  background: #ef5350;
  color: white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  font-weight: 700;
}

.vaccine-name {
  font-size: 0.85rem;
  color: var(--text);
  font-weight: 500;
}

.vaccine-count {
  font-size: 0.75rem;
  color: #c0392b;
  font-weight: 600;
}

.revenue-chart {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  height: 140px;
}

.rev-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  flex: 1;
  height: 100%;
  justify-content: flex-end;
}

.rev-bar-wrap {
  flex: 1;
  display: flex;
  align-items: flex-end;
  width: 100%;
}

.rev-bar {
  width: 100%;
  background: linear-gradient(to top, var(--primary), var(--accent-mint));
  border-radius: 6px 6px 0 0;
  transition: height 0.6s ease;
}

.rev-label {
  font-size: 0.65rem;
  color: var(--text-2);
  font-weight: 600;
}

.rev-month {
  font-size: 0.7rem;
  color: var(--text-3);
}

.alert {
  padding: 10px 14px;
  border-radius: var(--radius-sm);
  font-size: 0.875rem;
}

.alert--error {
  background: #fdeaea;
  color: #c0392b;
  border-left: 3px solid var(--danger);
}

.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 60px 20px;
  color: var(--text-3);
  font-size: 0.9rem;
  background: var(--white);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-sm);
}

.empty-state__emoji {
  font-size: 3rem;
}

.spin {
  width: 20px;
  height: 20px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  display: inline-block;
}

.spin--dark {
  border-color: rgba(0, 0, 0, 0.1);
  border-top-color: var(--primary);
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 700px) {
  .section-grid {
    grid-template-columns: 1fr;
  }

  .bar-row {
    grid-template-columns: 70px 1fr 30px;
  }

  .top-item {
    grid-template-columns: 22px 1fr 50px;
  }

  .top-bar-track {
    display: none;
  }
}
</style>
