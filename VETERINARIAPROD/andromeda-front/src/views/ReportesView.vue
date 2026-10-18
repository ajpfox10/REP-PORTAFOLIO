<template>
  <div class="page reports">
    <div class="page-header">
      <div class="page-header__left">
        <span class="page-icon" aria-hidden="true"><AppIcon name="reports" :size="22" /></span>
        <div>
          <h2 class="page-title">Reportes</h2>
          <p class="page-sub">Ingresos, atención y pacientes de tu clínica.</p>
        </div>
      </div>

      <div ref="exportRef" class="export">
        <button type="button" class="btn-primary" :aria-expanded="exportOpen" aria-haspopup="menu" :disabled="exporting" @click="exportOpen = !exportOpen">
          <AppIcon name="download" :size="16" /> {{ exporting ? 'Exportando…' : 'Exportar' }}
        </button>
        <div v-if="exportOpen" class="export__menu" role="menu">
          <div v-for="report in EXPORTABLE" :key="report.type" class="export__group">
            <span class="export__title">{{ report.label }}</span>
            <div class="export__formats">
              <button v-for="format in report.formats" :key="format" type="button" role="menuitem" @click="exportReport(report.type, format)">
                {{ FORMAT_LABELS[format] }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Período: un solo control arriba de todos los gráficos -->
    <div class="toolbar" role="group" aria-label="Período del reporte">
      <div class="segmented">
        <button v-for="p in PERIODS" :key="p.value" type="button" :aria-pressed="period === p.value" @click="setPeriod(p.value)">
          {{ p.label }}
        </button>
      </div>
      <div class="toolbar__dates">
        <label class="sr-only" for="rep-from">Desde</label>
        <input id="rep-from" v-model="from" type="date" :max="to" @change="customRange" />
        <span aria-hidden="true">—</span>
        <label class="sr-only" for="rep-to">Hasta</label>
        <input id="rep-to" v-model="to" type="date" :min="from" @change="customRange" />
      </div>
    </div>

    <nav class="report-tabs" aria-label="Secciones de reportes">
      <button v-for="tab in TABS" :key="tab.key" type="button" class="tab" :class="{ 'tab--active': activeTab === tab.key }"
        :aria-current="activeTab === tab.key ? 'page' : undefined" @click="activeTab = tab.key">
        <AppIcon :name="tab.icon" :size="16" /> {{ tab.label }}
      </button>
    </nav>

    <div v-if="error" class="alert alert--error" role="alert">{{ error }}</div>

    <!-- ── Resumen ───────────────────────────────────────────────────────── -->
    <section v-if="activeTab === 'summary'" class="grid">
      <div class="tiles">
        <article v-for="tile in summaryTiles" :key="tile.label" class="tile">
          <span class="tile__label">{{ tile.label }}</span>
          <strong class="tile__value">{{ loading ? '…' : tile.value }}</strong>
          <span v-if="tile.hint" class="tile__hint">{{ tile.hint }}</span>
        </article>
      </div>

      <article class="card card--wide">
        <header class="card__head">
          <div>
            <h3>Facturación por período</h3>
            <p>Ingreso bruto facturado · {{ periodLabel }}</p>
          </div>
          <button type="button" class="link-button" @click="showTable.revenue = !showTable.revenue">
            {{ showTable.revenue ? 'Ver gráfico' : 'Ver tabla' }}
          </button>
        </header>
        <ColumnChart v-if="!showTable.revenue" :items="revenueSeries" :format="money" aria-label="Facturación por período" />
        <DataTable v-else :columns="REVENUE_COLUMNS" :rows="revenueRows" />
      </article>

      <article class="card">
        <header class="card__head"><div><h3>Pacientes por especie</h3><p>Pacientes activos</p></div></header>
        <BarList :items="speciesItems" />
      </article>

      <article class="card">
        <header class="card__head"><div><h3>Medios de pago</h3><p>Monto cobrado en el período</p></div></header>
        <BarList :items="paymentItems" :format="money" />
      </article>
    </section>

    <!-- ── Finanzas ──────────────────────────────────────────────────────── -->
    <section v-else-if="activeTab === 'finance'" class="grid">
      <div class="tiles">
        <article v-for="tile in financeTiles" :key="tile.label" class="tile">
          <span class="tile__label">{{ tile.label }}</span>
          <strong class="tile__value">{{ loading ? '…' : tile.value }}</strong>
        </article>
      </div>

      <article class="card card--wide">
        <header class="card__head">
          <div><h3>Detalle de facturación</h3><p>Agrupado por {{ GROUP_LABELS[groupBy] }}</p></div>
          <div class="segmented segmented--sm">
            <button v-for="g in ['day', 'week', 'month']" :key="g" type="button" :aria-pressed="groupBy === g" @click="setGroupBy(g)">
              {{ GROUP_LABELS[g] }}
            </button>
          </div>
        </header>
        <DataTable :columns="REVENUE_COLUMNS" :rows="revenueRows" />
      </article>

      <article class="card">
        <header class="card__head"><div><h3>Ingresos por rubro</h3><p>Según la categoría de cada ítem facturado</p></div></header>
        <BarList :items="serviceItems" :format="money" />
      </article>

      <article class="card">
        <header class="card__head"><div><h3>Mejores clientes</h3><p>Por monto facturado</p></div></header>
        <DataTable :columns="CLIENT_COLUMNS" :rows="topClients" />
      </article>
    </section>

    <!-- ── Atención clínica ─────────────────────────────────────────────── -->
    <section v-else-if="activeTab === 'clinical'" class="grid">
      <div class="tiles">
        <article v-for="tile in clinicalTiles" :key="tile.label" class="tile">
          <span class="tile__label">{{ tile.label }}</span>
          <strong class="tile__value">{{ loading ? '…' : tile.value }}</strong>
          <span v-if="tile.hint" class="tile__hint">{{ tile.hint }}</span>
        </article>
      </div>

      <article class="card">
        <header class="card__head"><div><h3>Turnos por tipo</h3><p>{{ periodLabel }}</p></div></header>
        <BarList :items="appointmentTypeItems" />
      </article>

      <article class="card">
        <header class="card__head"><div><h3>Diagnósticos más frecuentes</h3><p>Diagnóstico principal de cada consulta</p></div></header>
        <BarList :items="diagnosisItems" />
      </article>

      <article class="card card--wide">
        <header class="card__head"><div><h3>Pacientes nuevos</h3><p>Altas por período y especie</p></div></header>
        <DataTable :columns="NEW_PATIENT_COLUMNS" :rows="newPatientRows" />
      </article>
    </section>

    <!-- ── Programados ──────────────────────────────────────────────────── -->
    <section v-else class="grid">
      <article class="card card--wide">
        <header class="card__head">
          <div><h3>Envíos programados</h3><p>Reportes que llegan solos por email</p></div>
          <button type="button" class="btn-primary" @click="openScheduleForm()"><AppIcon name="plus" :size="16" /> Nuevo envío</button>
        </header>

        <p v-if="!scheduled.length" class="empty-text">Todavía no programaste envíos. Por ejemplo: ingresos del mes, todos los lunes a las 7 h, para el equipo de administración.</p>
        <ul v-else class="schedule-list">
          <li v-for="item in scheduled" :key="item.id" class="schedule">
            <div class="schedule__info">
              <strong>{{ item.name }}</strong>
              <span>{{ REPORT_LABELS[item.report_type] || item.report_type }} · {{ frequencyLabel(item) }} · {{ FORMAT_LABELS[item.format] || item.format }}</span>
              <span class="schedule__meta">Para {{ recipientsLabel(item.recipients) }} · Próximo envío {{ formatDateTime(item.next_run_at) }}</span>
            </div>
            <span class="badge" :class="item.is_active === 0 ? 'badge--muted' : 'badge--ok'">{{ item.is_active === 0 ? 'Pausado' : 'Activo' }}</span>
            <div class="schedule__actions">
              <button type="button" class="icon-btn" title="Enviar ahora" aria-label="Enviar ahora" @click="runNow(item)"><AppIcon name="send" :size="16" /></button>
              <button type="button" class="icon-btn" :title="item.is_active === 0 ? 'Reanudar' : 'Pausar'" :aria-label="item.is_active === 0 ? 'Reanudar' : 'Pausar'" @click="toggleActive(item)">
                <AppIcon :name="item.is_active === 0 ? 'refresh' : 'clock'" :size="16" />
              </button>
              <button type="button" class="icon-btn icon-btn--danger" title="Eliminar" aria-label="Eliminar" @click="removeSchedule(item)"><AppIcon name="trash" :size="16" /></button>
            </div>
          </li>
        </ul>
      </article>

      <article v-if="runs.length" class="card card--wide">
        <header class="card__head"><div><h3>Últimos envíos</h3></div></header>
        <DataTable :columns="RUN_COLUMNS" :rows="runs" />
      </article>
    </section>

    <!-- Formulario de envío programado -->
    <div v-if="scheduleForm.open" class="modal-backdrop" @click.self="scheduleForm.open = false">
      <form class="modal" role="dialog" aria-modal="true" aria-labelledby="schedule-title" @submit.prevent="saveSchedule">
        <div class="modal__header">
          <h3 id="schedule-title">Nuevo envío programado</h3>
          <button type="button" class="modal__close" aria-label="Cerrar" @click="scheduleForm.open = false"><AppIcon name="close" :size="18" /></button>
        </div>
        <div class="form-body">
          <div class="field">
            <label for="sf-name">Nombre</label>
            <input id="sf-name" v-model.trim="scheduleForm.name" required maxlength="120" placeholder="Ingresos semanales" />
          </div>
          <div class="form-grid">
            <div class="field">
              <label for="sf-type">Reporte</label>
              <select id="sf-type" v-model="scheduleForm.reportType">
                <option v-for="report in EXPORTABLE" :key="report.type" :value="report.type">{{ report.label }}</option>
              </select>
            </div>
            <div class="field">
              <label for="sf-format">Formato</label>
              <select id="sf-format" v-model="scheduleForm.format">
                <option v-for="format in formatsFor(scheduleForm.reportType)" :key="format" :value="format">{{ FORMAT_LABELS[format] }}</option>
              </select>
            </div>
            <div class="field">
              <label for="sf-frequency">Frecuencia</label>
              <select id="sf-frequency" v-model="scheduleForm.frequency">
                <option value="daily">Todos los días</option>
                <option value="weekly">Semanal</option>
                <option value="monthly">Mensual</option>
              </select>
            </div>
            <div v-if="scheduleForm.frequency === 'weekly'" class="field">
              <label for="sf-dow">Día</label>
              <select id="sf-dow" v-model.number="scheduleForm.dayOfWeek">
                <option v-for="(day, index) in WEEKDAYS" :key="day" :value="index">{{ day }}</option>
              </select>
            </div>
            <div v-if="scheduleForm.frequency === 'monthly'" class="field">
              <label for="sf-dom">Día del mes</label>
              <input id="sf-dom" v-model.number="scheduleForm.dayOfMonth" type="number" min="1" max="28" />
            </div>
          </div>
          <div class="field">
            <label for="sf-recipients">Destinatarios</label>
            <input id="sf-recipients" v-model="scheduleForm.recipients" required placeholder="admin@clinica.com, contador@clinica.com" />
            <span class="hint">Separá los emails con comas. Se envía a las 7 h.</span>
          </div>
          <p v-if="scheduleForm.error" class="field-error">{{ scheduleForm.error }}</p>
        </div>
        <div class="modal__actions">
          <button type="button" class="btn-ghost" @click="scheduleForm.open = false">Cancelar</button>
          <button type="submit" class="btn-primary" :disabled="scheduleForm.saving">{{ scheduleForm.saving ? 'Guardando…' : 'Programar envío' }}</button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import ColumnChart from '../components/charts/ColumnChart.vue'
import BarList from '../components/charts/BarList.vue'
import DataTable from '../components/charts/DataTable.vue'
import { reportsApi } from '../api'
import { useUiFeedback } from '../composables/useUiFeedback'
import { extractDetailedErrorMessage, logError } from '../utils/errors'

const TABS = [
  { key: 'summary', label: 'Resumen', icon: 'dashboard' },
  { key: 'finance', label: 'Finanzas', icon: 'billing' },
  { key: 'clinical', label: 'Atención clínica', icon: 'vet' },
  { key: 'scheduled', label: 'Envíos programados', icon: 'send' },
]
const PERIODS = [
  { value: 'week', label: '7 días' },
  { value: 'month', label: 'Este mes' },
  { value: 'lastMonth', label: 'Mes anterior' },
  { value: 'quarter', label: '90 días' },
  { value: 'year', label: 'Este año' },
]
const EXPORTABLE = [
  { type: 'revenue', label: 'Facturación', formats: ['excel', 'pdf', 'csv'] },
  { type: 'appointments', label: 'Turnos', formats: ['excel', 'pdf', 'csv'] },
  { type: 'diagnoses', label: 'Diagnósticos', formats: ['excel', 'pdf', 'csv'] },
]
const REPORT_LABELS = { revenue: 'Facturación', appointments: 'Turnos', diagnoses: 'Diagnósticos' }
const FORMAT_LABELS = { excel: 'Excel', pdf: 'PDF', csv: 'CSV' }
const GROUP_LABELS = { day: 'día', week: 'semana', month: 'mes' }
const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const PAYMENT_LABELS = { cash: 'Efectivo', card: 'Tarjeta', credit_card: 'Tarjeta de crédito', debit_card: 'Tarjeta de débito',
  transfer: 'Transferencia', bank_transfer: 'Transferencia', mercadopago: 'MercadoPago', check: 'Cheque', other: 'Otro' }
const APPOINTMENT_TYPE_FALLBACK = 'Sin tipo'

const REVENUE_COLUMNS = [
  { key: 'period', label: 'Período' },
  { key: 'invoices', label: 'Facturas', align: 'right' },
  { key: 'gross_revenue', label: 'Bruto', align: 'right', money: true },
  { key: 'discounts', label: 'Descuentos', align: 'right', money: true },
  { key: 'net_revenue', label: 'Neto', align: 'right', money: true },
  { key: 'collected', label: 'Cobrado', align: 'right', money: true },
  { key: 'outstanding', label: 'Pendiente', align: 'right', money: true },
]
const CLIENT_COLUMNS = [
  { key: 'client_name', label: 'Cliente' },
  { key: 'total_patients', label: 'Mascotas', align: 'right' },
  { key: 'total_invoices', label: 'Facturas', align: 'right' },
  { key: 'total_spent', label: 'Facturado', align: 'right', money: true },
]
const NEW_PATIENT_COLUMNS = [
  { key: 'period', label: 'Período' },
  { key: 'species', label: 'Especie' },
  { key: 'species_count', label: 'Pacientes nuevos', align: 'right' },
]
const RUN_COLUMNS = [
  { key: 'scheduled_name', label: 'Envío' },
  { key: 'status_label', label: 'Estado' },
  { key: 'created_label', label: 'Fecha' },
]

const { success, notifyError, confirm } = useUiFeedback()

const activeTab = ref('summary')
const period = ref('month')
const from = ref('')
const to = ref('')
const groupBy = ref('day')
const loading = ref(false)
const error = ref('')
const exportOpen = ref(false)
const exporting = ref(false)
const exportRef = ref(null)
const showTable = reactive({ revenue: false })

const kpis = ref({})
const revenue = ref([])
const species = ref({ labels: [], values: [], percents: [] })
const payments = ref({ labels: [], values: [], percents: [] })
const services = ref([])
const topClients = ref([])
const appointments = ref({ summary: {}, byType: [] })
const diagnoses = ref([])
const newPatients = ref([])
const compliance = ref({})
const scheduled = ref([])
const runs = ref([])

const scheduleForm = reactive({
  open: false, saving: false, error: '', name: '', reportType: 'revenue', format: 'excel',
  frequency: 'weekly', dayOfWeek: 1, dayOfMonth: 1, recipients: '',
})

// ── Período ─────────────────────────────────────────────────────────────────
function dateKey(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function rangeFor(value) {
  const now = new Date()
  const start = new Date(now)
  let end = new Date(now)
  if (value === 'week') start.setDate(now.getDate() - 6)
  if (value === 'month') start.setDate(1)
  if (value === 'lastMonth') {
    start.setMonth(now.getMonth() - 1, 1)
    end = new Date(now.getFullYear(), now.getMonth(), 0)
  }
  if (value === 'quarter') start.setDate(now.getDate() - 89)
  if (value === 'year') start.setMonth(0, 1)
  return { from: dateKey(start), to: dateKey(end) }
}

function setPeriod(value) {
  period.value = value
  const range = rangeFor(value)
  from.value = range.from
  to.value = range.to
  groupBy.value = value === 'year' || value === 'quarter' ? 'month' : 'day'
  load()
}

function customRange() {
  if (!from.value || !to.value || from.value > to.value) return
  period.value = 'custom'
  load()
}

function setGroupBy(value) {
  groupBy.value = value
  loadRevenue()
}

const periodLabel = computed(() => (period.value === 'custom'
  ? `${formatDate(from.value)} al ${formatDate(to.value)}`
  : PERIODS.find((p) => p.value === period.value)?.label || ''))

// ── Formato ─────────────────────────────────────────────────────────────────
function money(value) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(Number(value) || 0)
}

function number(value) {
  return new Intl.NumberFormat('es-AR').format(Number(value) || 0)
}

function percent(value) {
  return `${Math.round((Number(value) || 0) * 10) / 10}%`
}

function formatDate(value) {
  if (!value) return '—'
  const [y, m, d] = String(value).slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

function formatDateTime(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString('es-AR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function shortPeriod(value) {
  const text = String(value || '')
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text.slice(8, 10)}/${text.slice(5, 7)}`
  if (/^\d{4}-\d{2}$/.test(text)) {
    return new Date(`${text}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'short' })
  }
  return text
}

// ── Datos derivados ─────────────────────────────────────────────────────────
const summaryTiles = computed(() => {
  const k = kpis.value
  const total = Number(k.totalAppointments) || 0
  return [
    { label: 'Facturado', value: money(k.grossRevenue), hint: `${number(k.totalInvoices)} facturas` },
    { label: 'Cobrado', value: money(k.collectedRevenue), hint: `Pendiente ${money(k.outstandingRevenue)}` },
    { label: 'Turnos', value: number(total), hint: total ? `${percent((Number(k.completedAppointments) / total) * 100)} atendidos` : 'Sin turnos en el período' },
    { label: 'Pacientes nuevos', value: number(k.newPatients), hint: `${number(k.totalPatients)} activos en total` },
  ]
})

const financeTiles = computed(() => {
  const totals = revenue.value.reduce((acc, row) => ({
    gross: acc.gross + Number(row.gross_revenue || 0),
    discounts: acc.discounts + Number(row.discounts || 0),
    collected: acc.collected + Number(row.collected || 0),
    outstanding: acc.outstanding + Number(row.outstanding || 0),
  }), { gross: 0, discounts: 0, collected: 0, outstanding: 0 })
  return [
    { label: 'Facturado bruto', value: money(totals.gross) },
    { label: 'Descuentos', value: money(totals.discounts) },
    { label: 'Cobrado', value: money(totals.collected) },
    { label: 'Por cobrar', value: money(totals.outstanding) },
  ]
})

const clinicalTiles = computed(() => {
  const s = appointments.value.summary || {}
  const c = compliance.value || {}
  return [
    { label: 'Turnos atendidos', value: number(s.completed), hint: `de ${number(s.total_scheduled)} agendados` },
    { label: 'Ausentismo', value: percent(s.no_show_rate), hint: `${number(s.no_show)} pacientes no vinieron` },
    { label: 'Duración promedio', value: s.avg_duration_minutes ? `${Math.round(Number(s.avg_duration_minutes))} min` : '—' },
    { label: 'Vacunación al día', value: percent(c.compliance_rate), hint: `${number(c.vaccinated_last_year)} de ${number(c.total_active_patients)} pacientes` },
  ]
})

const revenueRows = computed(() => revenue.value.map((row) => ({ ...row, period: shortPeriodLong(row.period) })))

function shortPeriodLong(value) {
  const text = String(value || '')
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return formatDate(text)
  if (/^\d{4}-\d{2}$/.test(text)) {
    const label = new Date(`${text}-01T12:00:00`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
    return label.charAt(0).toUpperCase() + label.slice(1)
  }
  return text
}

const newPatientRows = computed(() => newPatients.value.map((row) => ({ ...row, period: shortPeriodLong(row.period) })))

const revenueSeries = computed(() => revenue.value.map((row) => ({
  label: shortPeriodLong(row.period),
  short: shortPeriod(row.period),
  value: Number(row.gross_revenue) || 0,
})))

function zip(chart, labelMap = {}) {
  return (chart.labels || []).map((label, index) => ({
    label: labelMap[label] || label,
    value: Number(chart.values?.[index]) || 0,
    pct: chart.percents?.[index] ?? null,
  }))
}

const speciesItems = computed(() => zip(species.value))
const paymentItems = computed(() => zip(payments.value, PAYMENT_LABELS))
const serviceItems = computed(() => services.value.map((row) => ({ label: row.category || 'Sin rubro', value: row.revenue, pct: row.pct })))
const appointmentTypeItems = computed(() => (appointments.value.byType || []).map((row) => ({
  label: row.type || row.appointment_type || APPOINTMENT_TYPE_FALLBACK,
  value: row.count ?? row.total ?? 0,
  pct: row.pct ?? null,
})))
const diagnosisItems = computed(() => diagnoses.value.map((row) => ({ label: row.diagnosis_name, value: row.frequency, pct: row.pct })))

// ── Carga ───────────────────────────────────────────────────────────────────
function unwrap(res) {
  return res?.data?.data ?? res?.data
}

async function loadRevenue() {
  try {
    revenue.value = unwrap(await reportsApi.revenue({ from: from.value, to: to.value, groupBy: groupBy.value })) || []
  } catch (err) {
    logError('reports.revenue', err)
  }
}

async function load() {
  loading.value = true
  error.value = ''
  const params = { from: from.value, to: to.value }
  const results = await Promise.allSettled([
    reportsApi.kpis(params),
    reportsApi.revenue({ ...params, groupBy: groupBy.value }),
    reportsApi.charts.speciesDistribution(params),
    reportsApi.charts.paymentMethods(params),
    reportsApi.revenueByService(params),
    reportsApi.topClients({ ...params, limit: 10 }),
    reportsApi.appointments(params),
    reportsApi.diagnoses({ ...params, limit: 10 }),
    reportsApi.newPatients(params),
    reportsApi.vaccinationCompliance(params),
  ])
  const [k, rev, sp, pay, svc, clients, appts, diag, newPts, comp] = results
  const value = (r, fallback) => (r.status === 'fulfilled' ? (unwrap(r.value) ?? fallback) : fallback)
  kpis.value = value(k, {})
  revenue.value = value(rev, [])
  species.value = value(sp, { labels: [] })
  payments.value = value(pay, { labels: [] })
  services.value = value(svc, [])
  topClients.value = value(clients, [])
  appointments.value = value(appts, { summary: {}, byType: [] })
  diagnoses.value = value(diag, [])
  newPatients.value = value(newPts, [])
  compliance.value = value(comp, {})

  const failed = results.filter((r) => r.status === 'rejected')
  if (failed.length === results.length) {
    error.value = extractDetailedErrorMessage(failed[0].reason, 'No pudimos cargar los reportes.', { context: 'Reportes' })
  } else {
    failed.forEach((r) => logError('reports.load', r.reason))
  }
  loading.value = false
}

async function loadScheduled() {
  try {
    scheduled.value = unwrap(await reportsApi.scheduled.list()) || []
    const runRows = unwrap(await reportsApi.scheduled.runs()) || []
    const STATUS = { completed: 'Enviado', failed: 'Falló', running: 'En curso', pending: 'Pendiente' }
    runs.value = runRows.slice(0, 10).map((run) => ({
      ...run,
      status_label: STATUS[run.status] || run.status,
      created_label: formatDateTime(run.created_at || run.started_at),
    }))
  } catch (err) {
    logError('reports.scheduled', err)
  }
}

watch(activeTab, (tab) => {
  if (tab === 'scheduled') loadScheduled()
})

// ── Exportar ────────────────────────────────────────────────────────────────
async function exportReport(type, format) {
  exportOpen.value = false
  exporting.value = true
  try {
    const res = await reportsApi.exportReport(type, format, { from: from.value, to: to.value, groupBy: groupBy.value })
    const ext = { excel: 'xlsx', pdf: 'pdf', csv: 'csv' }[format]
    const url = URL.createObjectURL(res.data)
    const link = document.createElement('a')
    link.href = url
    link.download = `reporte-${type}-${from.value}-${to.value}.${ext}`
    link.click()
    URL.revokeObjectURL(url)
  } catch (err) {
    notifyError('reports.export', err, 'No pudimos generar el archivo.')
  } finally {
    exporting.value = false
  }
}

function onDocumentClick(event) {
  if (exportOpen.value && exportRef.value && !exportRef.value.contains(event.target)) exportOpen.value = false
}

// ── Envíos programados ──────────────────────────────────────────────────────
function formatsFor(type) {
  return EXPORTABLE.find((r) => r.type === type)?.formats || ['excel']
}

function frequencyLabel(item) {
  if (item.frequency === 'daily') return 'todos los días'
  if (item.frequency === 'weekly') return `los ${WEEKDAYS[item.day_of_week ?? 1]?.toLowerCase()}`
  if (item.frequency === 'monthly') return `el día ${item.day_of_month || 1} de cada mes`
  return item.frequency
}

function recipientsLabel(value) {
  let list = value
  if (typeof value === 'string') {
    try { list = JSON.parse(value) } catch { list = value.split(',') }
  }
  return (Array.isArray(list) ? list : []).join(', ') || '—'
}

function openScheduleForm() {
  Object.assign(scheduleForm, { open: true, saving: false, error: '', name: '', reportType: 'revenue', format: 'excel',
    frequency: 'weekly', dayOfWeek: 1, dayOfMonth: 1, recipients: '' })
}

async function saveSchedule() {
  const recipients = scheduleForm.recipients.split(',').map((e) => e.trim()).filter(Boolean)
  if (!recipients.length || recipients.some((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))) {
    scheduleForm.error = 'Revisá los emails de los destinatarios.'
    return
  }
  scheduleForm.saving = true
  scheduleForm.error = ''
  try {
    await reportsApi.scheduled.create({
      name: scheduleForm.name,
      reportType: scheduleForm.reportType,
      format: scheduleForm.format,
      frequency: scheduleForm.frequency,
      dayOfWeek: scheduleForm.frequency === 'weekly' ? scheduleForm.dayOfWeek : undefined,
      dayOfMonth: scheduleForm.frequency === 'monthly' ? scheduleForm.dayOfMonth : undefined,
      recipients,
    })
    scheduleForm.open = false
    success('Vas a recibir el reporte automáticamente.', { title: 'Envío programado' })
    loadScheduled()
  } catch (err) {
    scheduleForm.error = extractDetailedErrorMessage(err, 'No pudimos programar el envío.', { context: 'Reportes' })
  } finally {
    scheduleForm.saving = false
  }
}

async function runNow(item) {
  try {
    await reportsApi.scheduled.run(item.id)
    success(`Enviamos "${item.name}" a sus destinatarios.`)
    loadScheduled()
  } catch (err) {
    notifyError('reports.runNow', err, 'No pudimos enviar el reporte.')
  }
}

async function toggleActive(item) {
  try {
    await reportsApi.scheduled.update(item.id, { isActive: item.is_active === 0 })
    loadScheduled()
  } catch (err) {
    notifyError('reports.toggle', err, 'No pudimos actualizar el envío.')
  }
}

async function removeSchedule(item) {
  const ok = await confirm({ title: 'Eliminar envío programado', message: `"${item.name}" dejará de enviarse.`, confirmText: 'Eliminar', variant: 'danger' })
  if (!ok) return
  try {
    await reportsApi.scheduled.remove(item.id)
    loadScheduled()
  } catch (err) {
    notifyError('reports.remove', err, 'No pudimos eliminar el envío.')
  }
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  setPeriod('month')
})
onBeforeUnmount(() => document.removeEventListener('click', onDocumentClick))
</script>

<style scoped>
.reports {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 1280px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.page-header__left {
  display: flex;
  align-items: center;
  gap: 14px;
}

.export {
  position: relative;
}

.export__menu {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  z-index: 50;
  width: 260px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: var(--shadow-lg);
}

.export__group {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px;
}

.export__group + .export__group {
  border-top: 1px solid var(--border);
}

.export__title {
  font-weight: 600;
  font-size: 0.88rem;
}

.export__formats {
  display: flex;
  gap: 4px;
}

.export__formats button {
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text-2);
  font-size: 0.78rem;
  cursor: pointer;
}

.export__formats button:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.segmented {
  display: inline-flex;
  padding: 3px;
  border-radius: var(--radius);
  background: var(--surface-3);
}

.segmented button {
  border: none;
  background: transparent;
  padding: 6px 12px;
  border-radius: var(--radius-sm);
  color: var(--text-2);
  font-size: 0.86rem;
  cursor: pointer;
}

.segmented button[aria-pressed="true"] {
  background: var(--surface);
  color: var(--text);
  font-weight: 600;
  box-shadow: var(--shadow-sm);
}

.segmented--sm button {
  padding: 4px 10px;
  font-size: 0.8rem;
}

.toolbar__dates {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-3);
}

.toolbar__dates input {
  padding: 6px 10px;
  min-height: 36px;
}

.report-tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--border);
  overflow-x: auto;
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--text-2);
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
}

.tab--active {
  color: var(--primary);
  border-bottom-color: var(--primary);
  font-weight: 600;
}

.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.tiles {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.tile {
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tile__label {
  font-size: 0.82rem;
  color: var(--text-2);
}

.tile__value {
  font-size: 1.55rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}

.tile__hint {
  font-size: 0.78rem;
  color: var(--text-3);
}

.card {
  padding: 18px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  min-width: 0;
}

.card--wide {
  grid-column: 1 / -1;
}

.card__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 16px;
}

.card__head h3 {
  font-size: 1rem;
}

.card__head p {
  font-size: 0.82rem;
  color: var(--text-3);
  margin-top: 2px;
}

.link-button {
  border: none;
  background: transparent;
  color: var(--primary);
  font-weight: 600;
  font-size: 0.84rem;
  cursor: pointer;
}

.empty-text {
  color: var(--text-3);
  font-size: 0.9rem;
  line-height: 1.5;
}

.schedule-list {
  list-style: none;
}

.schedule {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
}

.schedule + .schedule {
  border-top: 1px solid var(--border);
}

.schedule__info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.schedule__info span {
  font-size: 0.84rem;
  color: var(--text-2);
}

.schedule__meta {
  color: var(--text-3) !important;
  font-size: 0.78rem !important;
}

.badge {
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 0.74rem;
  font-weight: 600;
}

.badge--ok { background: var(--success-light); color: var(--success); }
.badge--muted { background: var(--surface-3); color: var(--text-3); }

.schedule__actions {
  display: flex;
  gap: 4px;
}

.icon-btn {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text-2);
  cursor: pointer;
}

.icon-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.icon-btn--danger:hover {
  border-color: var(--danger);
  color: var(--danger);
}

.hint {
  font-size: 0.78rem;
  color: var(--text-3);
}

@media (max-width: 1000px) {
  .grid { grid-template-columns: 1fr; }
  .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 560px) {
  .tiles { grid-template-columns: 1fr; }
  .toolbar__dates { width: 100%; }
  .toolbar__dates input { flex: 1; }
}
</style>
