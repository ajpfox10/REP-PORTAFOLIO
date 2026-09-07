<template>
  <div class="page">

    <div class="page-header">
      <div class="page-header__left">
        <span class="page-emoji">&#x1F43E;</span>
        <div>
          <h2 class="page-title">Bandeja de imágenes</h2>
          <p class="page-sub">Estudios solicitados desde evoluciones clínicas, informes y trazabilidad.</p>
        </div>
      </div>
      <RouterLink class="btn-primary route-action" to="/evoluciones">Crear desde evolución</RouterLink>
    </div>

    <section class="workflow-banner" aria-label="Flujo clínico de imágenes">
      <div>
        <strong>Flujo clínico</strong>
        <span>Evolución → Solicitud de estudio → Informe → Seguimiento</span>
      </div>
      <p>Las nuevas solicitudes se originan en la evolución para que la indicación clínica quede atada a una ficha.</p>
    </section>

    <!-- Stats -->
    <div class="stats-row">
      <div class="stat-card" style="--c:#FFF3CC;--ct:#8A6200">
        <span class="stat-card__icon">&#x1F43E;</span>
        <div>
          <strong>{{ stats.pendingReport }}</strong>
          <span>{{ t('imaging.pendingReport') }}</span>
        </div>
      </div>
      <div class="stat-card" style="--c:#D6F3EC;--ct:#1A9E7F">
        <span class="stat-card__icon">&#x2713;</span>
        <div>
          <strong>{{ stats.completed }}</strong>
          <span>{{ t('imaging.completed') }}</span>
        </div>
      </div>
      <div class="stat-card" style="--c:#D6EEFF;--ct:#1A5FAA">
        <span class="stat-card__icon">&#x1F43E;</span>
        <div>
          <strong>{{ stats.topModality }}</strong>
          <span>{{ t('imaging.topModality') }}</span>
        </div>
      </div>
    </div>

    <!-- Filtros -->
    <div class="filters">
      <label for="img-search" class="sr-only">{{ t('imaging.searchPlaceholder') }}</label>
      <input
        id="img-search"
        name="img-search"
        v-model.trim="search"
        type="search"
        :placeholder="t('imaging.searchPlaceholder')"
        class="filter-input filter-input--grow"
        @input="debouncedLoad()"
        />
      <label for="img-status" class="sr-only">{{ t('imaging.allStatuses') }}</label>
      <select id="img-status" name="img-status" v-model="statusFilter" class="filter-select" @change="load()">
        <option value="">{{ t('imaging.allStatuses') }}</option>
        <option value="pending">{{ t('imaging.pendingStatus') }}</option>
        <option value="scheduled">{{ t('imaging.scheduledStatus') }}</option>
        <option value="in_progress">{{ t('imaging.inProgressStatus') }}</option>
        <option value="reported">{{ t('imaging.reportedStatus') }}</option>
        <option value="cancelled">{{ t('imaging.cancelledStatus') }}</option>
      </select>
    </div>

    <div v-if="loading" class="loading-state" role="status" aria-live="polite">
      <span class="spin spin--dark" /> {{ t('imaging.loading') }}
    </div>
    <div v-else-if="error" class="alert alert--error" role="alert">{{ error }}</div>
    <div v-else-if="items.length === 0" class="empty-state">
      <span class="empty-state__emoji">&#x1F43E;</span>
      <p>{{ t('imaging.empty') }}</p>
    </div>

    <div v-else class="card">
      <table class="table">
        <thead>
          <tr>
            <th>{{ t('imaging.patient') }}</th>
            <th>Evolución</th>
            <th>{{ t('imaging.typeLabel') }}</th>
            <th>{{ t('imaging.status') }}</th>
            <th>{{ t('imaging.date') }}</th>
            <th>{{ t('imaging.report') }}</th>
            <th>{{ t('imaging.actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="order in items" :key="order.id">
            <td>
              <div class="pet-cell">
                <span>{{ petEmoji(order.species) }}</span>
                <div>
                  <strong>{{ order.patient_name || '—' }}</strong>
                  <span class="sub">{{ order.vet_name || '' }}</span>
                </div>
              </div>
            </td>
            <td>
              <span v-if="order.medical_record_id" class="record-link">Ficha #{{ order.medical_record_id }}</span>
              <span v-else class="badge badge--yellow">Sin ficha</span>
            </td>
            <td>
              <div>
                <strong class="modality-name">{{ order.modality ? modalityLabel(order.modality) : '—' }}</strong>
                <span v-if="order.study_count" class="sub">{{ order.study_count }} {{ t('imaging.studies') }}</span>
              </div>
              <span v-if="order.modality" class="badge" :class="modalityClass(order.modality)" style="margin-top:4px">
                {{ order.modality.toUpperCase() }}
              </span>
            </td>
            <td>
              <span class="badge" :class="statusClass(order.status)">{{ statusLabel(order.status) }}</span>
            </td>
            <td class="sub">{{ formatDate(order.requested_at) }}</td>
            <td>
              <span v-if="order.has_report" class="badge badge--green">{{ t('imaging.withReport') }}</span>
              <span v-else class="badge badge--gray">{{ t('imaging.withoutReport') }}</span>
            </td>
            <td>
              <div class="action-btns">
                <button
                  v-if="!order.has_report && order.status !== 'cancelled'"
                  type="button"
                  class="btn-action btn-action--primary"
                  @click="openReport(order)"
                  :title="t('imaging.report')"
                >
                  {{ t('imaging.report') }}
                </button>
                <button
                  v-if="order.has_report"
                  type="button"
                  class="btn-action"
                  @click="openReport(order)"
                  :title="t('imaging.viewReport')"
                >
                  {{ t('imaging.viewReport') }}
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="pagination.totalPages > 1" class="pagination">
      <button type="button" :disabled="pagination.page <= 1" @click="load(pagination.page - 1)">{{ t('billing.previous') }}</button>
      <span>{{ pagination.page }} / {{ pagination.totalPages }}</span>
      <button type="button" :disabled="pagination.page >= pagination.totalPages" @click="load(pagination.page + 1)">{{ t('billing.next') }}</button>
    </div>

    <!-- Modal informe -->
    <Transition name="modal">
      <div v-if="showReport" class="modal-backdrop" @click.self="showReport = false">
        <div class="modal modal--wide">
          <div class="modal__header">
            <h3>&#x1F43E; {{ t('imaging.reportTitle') }} — {{ selectedOrder?.patient_name }}</h3>
            <BaseButton type="button" variant="ghost" class="modal__close" @click="showReport = false">&times;</BaseButton>
          </div>

          <div v-if="detailLoading" class="loading-state" style="min-height:200px" role="status" aria-live="polite">
            <span class="spin spin--dark" /> {{ t('imaging.detailLoading') }}</div>
          <template v-else>
            <!-- Si ya tiene informe, mostrarlo de solo lectura -->
            <div v-if="existingReport" class="form-body">
              <div class="report-readonly">
                <div class="report-section">
                  <div class="section-title">{{ t('imaging.findings') }}</div>
                  <p>{{ existingReport.findings }}</p>
                </div>
                <div class="report-section">
                  <div class="section-title">{{ t('imaging.conclusion') }}</div>
                  <p>{{ existingReport.conclusion }}</p>
                </div>
                <div v-if="existingReport.recommendations" class="report-section">
                  <div class="section-title">{{ t('imaging.recommendations') }}</div>
                  <p>{{ existingReport.recommendations }}</p>
                </div>
                <div v-if="existingReport.radiologist_name" class="report-meta">
                  <strong>{{ t('imaging.radiologist') }}:</strong> {{ existingReport.radiologist_name }}
                </div>
              </div>
              <div class="modal__actions" style="position:static;border-top:none;padding-top:0">
                <BaseButton type="button" variant="ghost" @click="showReport = false">{{ t('common.close') }}</BaseButton>
              </div>
            </div>

            <!-- Formulario para ingresar informe -->
            <form v-else @submit.prevent="handleSubmitReport" novalidate>
              <div class="form-body">
                <div class="form-grid">
                  <div class="field field--full">
                    <label for="img-r-findings">{{ t('imaging.findings') }} <span class="req">*</span></label>
                    <textarea
                      id="img-r-findings"
                      name="img-r-findings"
                      v-model.trim="reportForm.findings"
                      rows="4"
                      :placeholder="t('imaging.findings')"
                      :disabled="savingReport"
                    />
                    <span v-if="rfe.findings" class="field-error">{{ rfe.findings }}</span>
                  </div>
                  <div class="field field--full">
                    <label for="img-r-conclusion">{{ t('imaging.conclusion') }} <span class="req">*</span></label>
                    <textarea
                      id="img-r-conclusion"
                      name="img-r-conclusion"
                      v-model.trim="reportForm.conclusion"
                      rows="3"
                      :placeholder="t('imaging.conclusion')"
                      :disabled="savingReport"
                    />
                    <span v-if="rfe.conclusion" class="field-error">{{ rfe.conclusion }}</span>
                  </div>
                  <div class="field field--full">
                    <label for="img-r-recommendations">{{ t('imaging.recommendations') }}</label>
                    <textarea
                      id="img-r-recommendations"
                      name="img-r-recommendations"
                      v-model.trim="reportForm.recommendations"
                      rows="2"
                      :placeholder="t('imaging.recommendations')"
                      :disabled="savingReport"
                    />
                  </div>
                  <div class="field">
                    <label for="img-r-radiologist">{{ t('imaging.radiologist') }}</label>
                    <input
                      id="img-r-radiologist"
                      name="img-r-radiologist"
                      v-model.trim="reportForm.radiologistName"
                      type="text"
                      :placeholder="t('imaging.radiologist')"
                      :disabled="savingReport"
                    />
                  </div>
                </div>
              </div>

              <div v-if="reportError" class="alert alert--error mx" role="alert">{{ reportError }}</div>

              <div class="modal__actions">
                <BaseButton type="button" variant="ghost" @click="showReport = false" :disabled="savingReport">{{ t('common.cancel') }}</BaseButton>
                <BaseButton type="submit" :disabled="savingReport">
                  <span v-if="savingReport" class="spin spin--sm" />
                  <span v-else>&#x1F43E; {{ t('imaging.saveReport') }}</span>
                </BaseButton>
              </div>
            </form>
          </template>
        </div>
      </div>
    </Transition>

  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import { labApi } from '../api'
import { t } from '../i18n'
import { extractDetailedErrorMessage, logError } from '../utils/errors'
import BaseButton from '../components/base/BaseButton.vue'
import { useUiFeedback } from '../composables/useUiFeedback'

const { success } = useUiFeedback()

// -- Lista de órdenes --------------------------------------------------------
function asArray(value) {
  if (Array.isArray(value)) return value
  if (value == null) return []
  return [value]
}

function normalizeImagingOrder(row) {
  if (!row || typeof row !== 'object') return null
  return {
    ...row,
    id: row.id ?? row.order_id ?? row.orderId ?? null,
    medical_record_id: row.medical_record_id ?? row.medicalRecordId ?? null,
    patient_name: row.patient_name ?? row.patient?.name ?? row.patientName ?? '',
    vet_name: row.vet_name ?? row.vet?.name ?? row.vetName ?? '',
    imaging_type: row.imaging_type ?? row.type_name ?? row.typeName ?? '',
    modality: row.modality ?? row.imaging_modality ?? '',
    status: row.status ?? '',
    requested_at: row.requested_at ?? row.created_at ?? row.createdAt ?? null,
    has_report: Boolean(row.has_report ?? row.report ?? row.report_id ?? row.reportId),
    study_count: Number(row.study_count ?? row.studyCount ?? 0) || 0,
    species: row.species ?? row.patient?.species ?? '',
  }
}

const items        = ref([])
const loading      = ref(false)
const error        = ref('')
const search       = ref('')
const statusFilter = ref('')
const pagination   = ref({ page: 1, totalPages: 1 })

const stats = reactive({ pendingReport: 0, completed: 0, topModality: '—' })

async function load(page = 1) {
  loading.value = true; error.value = ''
  try {
    const pageSize = 15
    const params = {}
    if (statusFilter.value) params.status = statusFilter.value
    const { data } = await labApi.imaging.list(params)
    const rows = asArray(data?.data || data?.orders || data).map(normalizeImagingOrder).filter(Boolean)
    const needle = search.value.trim().toLowerCase()
    const filtered = needle
      ? rows.filter((row) => [row.order_number, row.patient_name, row.imaging_type, row.ordered_by]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle)))
      : rows
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
    const safePage = Math.min(page, totalPages)
    items.value = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)
    pagination.value = { page: safePage, totalPages }
    computeStats()
  } catch (e) {
    error.value = extractDetailedErrorMessage(e, 'No se pudieron cargar las órdenes.', { context: 'Carga de órdenes de imágenes' })
  } finally { loading.value = false }
}

function computeStats() {
  let pendingReport = 0, completed = 0
  const modalityCounts = {}
  items.value.forEach(o => {
    if (!o.has_report && o.status !== 'cancelled') pendingReport++
    if (o.status === 'reported' || o.status === 'completed') completed++
    if (o.modality) modalityCounts[o.modality] = (modalityCounts[o.modality] || 0) + 1
  })
  stats.pendingReport = pendingReport
  stats.completed     = completed
  const topEntry = Object.entries(modalityCounts).sort((a, b) => b[1] - a[1])[0]
  stats.topModality = topEntry ? modalityLabel(topEntry[0]) : '—'
}

let loadTimer = null
function debouncedLoad() { clearTimeout(loadTimer); loadTimer = setTimeout(load, 350) }

// -- Helpers -----------------------------------------------------------------
function petEmoji(s) {
  if (!s) return '\u{1F43E}'
  const m = { perro:'\u{1F43E}', dog:'\u{1F43E}', gato:'\u{1F43E}', cat:'\u{1F43E}', conejo:'\u{1F43E}', rabbit:'\u{1F43E}', loro:'\u{1F43E}', bird:'\u{1F43E}', pez:'\u{1F43E}', fish:'\u{1F43E}', tortuga:'\u{1F43E}', reptile:'\u{1F43E}', hamster:'\u{1F43E}' }
  return m[s.toLowerCase()] || '\u{1F43E}'
}

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function modalityLabel(m) {
  const map = {
    xray: t('imaging.xray'),
    ultrasound: t('imaging.ultrasound'),
    ct: t('imaging.ct'),
    mri: t('imaging.mri'),
    endoscopy: t('imaging.endoscopy'),
    other: t('imaging.otherModality'),
  }
  return map[m] || m || '—'
}

function modalityClass(m) {
  const map = { xray: 'badge--blue', ultrasound: 'badge--green', ct: 'badge--purple', mri: 'badge--orange', endoscopy: 'badge--red', other: 'badge--gray' }
  return map[m] || 'badge--gray'
}

function statusClass(s) {
  const map = { pending: 'badge--gray', scheduled: 'badge--blue', in_progress: 'badge--yellow', reported: 'badge--green', cancelled: 'badge--red' }
  return map[s] || 'badge--gray'
}

function statusLabel(s) {
  const map = {
    pending: t('imaging.pendingStatus'),
    scheduled: t('imaging.scheduledStatus'),
    in_progress: t('imaging.inProgressStatus'),
    reported: t('imaging.reportedStatus'),
    cancelled: t('imaging.cancelledStatus'),
  }
  return map[s] || s || '—'
}

// -- Modal informe ------------------------------------------------------------
const showReport    = ref(false)
const selectedOrder = ref(null)
const detailLoading = ref(false)
const existingReport = ref(null)

const reportForm = reactive({ findings: '', conclusion: '', recommendations: '', radiologistName: '' })
const rfe        = reactive({})
const savingReport = ref(false)
const reportError  = ref('')

async function openReport(order) {
  selectedOrder.value = order
  detailLoading.value = true
  showReport.value    = true
  existingReport.value = null
  reportError.value   = ''
  Object.assign(reportForm, { findings: '', conclusion: '', recommendations: '', radiologistName: '' })
  Object.keys(rfe).forEach(k => delete rfe[k])
  try {
    const { data } = await labApi.imaging.get(order.id)
    const detail = data?.data || data
    existingReport.value = detail?.report || null
    // Pre-rellenar si ya tiene informe para edición futura (solo lectura en este caso)
  } catch (e) {
    reportError.value = extractDetailedErrorMessage(e, 'No se pudo cargar el detalle.', { context: 'Detalle de orden de imágenes' })
  } finally { detailLoading.value = false }
}

function validateReport() {
  Object.keys(rfe).forEach(k => delete rfe[k])
  if (!reportForm.findings)   rfe.findings   = 'Requerido'
  if (!reportForm.conclusion) rfe.conclusion = 'Requerido'
  return Object.keys(rfe).length === 0
}

async function handleSubmitReport() {
  if (!validateReport()) return
  savingReport.value = true; reportError.value = ''
  try {
    const payload = { findings: reportForm.findings, conclusion: reportForm.conclusion }
    if (reportForm.recommendations)  payload.recommendations  = reportForm.recommendations
    if (reportForm.radiologistName)  payload.radiologistName  = reportForm.radiologistName
    await labApi.imaging.report(selectedOrder.value.id, payload)
    success('Informe de imágenes guardado.')
    showReport.value = false
    await load()
  } catch (e) {
    reportError.value = extractDetailedErrorMessage(e, 'No se pudo guardar el informe.', { context: 'Guardado de informe de imágenes' })
  } finally { savingReport.value = false }
}

onMounted(load)
onUnmounted(() => clearTimeout(loadTimer))
</script>

<style scoped>
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
.page { display: flex; flex-direction: column; gap: 20px; }
.page-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
.page-header__left { display: flex; align-items: center; gap: 14px; }
.page-emoji { font-size: 2rem; }
.page-title { font-size: 1.35rem; font-weight: 700; color: var(--text); }
.page-sub   { font-size: 0.82rem; color: var(--text-2); margin-top: 2px; }
.route-action { white-space: nowrap; }
.workflow-banner {
  display: grid;
  grid-template-columns: minmax(220px, 0.9fr) 1.4fr;
  gap: 14px;
  align-items: center;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
}
.workflow-banner div { display: flex; flex-direction: column; gap: 4px; }
.workflow-banner strong { color: var(--primary-hover); font-size: 0.86rem; }
.workflow-banner span { color: var(--text); font-weight: 800; font-size: 0.9rem; }
.workflow-banner p { color: var(--text-2); font-size: 0.86rem; line-height: 1.45; }

/* Stats */
.stats-row { display: flex; gap: 14px; flex-wrap: wrap; }
.stat-card { display: flex; align-items: center; gap: 14px; background: var(--c, var(--surface)); border-radius: var(--radius-lg); padding: 16px 20px; flex: 1; min-width: 160px; }
.stat-card__icon { font-size: 1.6rem; }
.stat-card strong { display: block; font-size: 1.5rem; font-weight: 800; color: var(--ct, var(--text)); line-height: 1; }
.stat-card span { font-size: 0.78rem; color: var(--ct, var(--text-2)); opacity: 0.85; }

/* Filtros */
.filters { display: flex; gap: 10px; flex-wrap: wrap; }
.filter-input { padding: 9px 13px; border: 1.5px solid var(--border); border-radius: var(--radius); font-size: 0.87rem; background: var(--white); color: var(--text); outline: none; }
.filter-input:focus { border-color: var(--primary); }
.filter-input--grow { flex: 1; min-width: 200px; }
.filter-select { padding: 9px 13px; border: 1.5px solid var(--border); border-radius: var(--radius); font-size: 0.87rem; background: var(--white); color: var(--text); outline: none; cursor: pointer; }
.filter-select:focus { border-color: var(--primary); }

/* Card / Table */
.card { background: var(--white); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); overflow: hidden; }
.table { width: 100%; border-collapse: collapse; font-size: 0.87rem; }
.table thead th { background: var(--surface); padding: 11px 14px; text-align: left; font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-3); border-bottom: 1.5px solid var(--border); white-space: nowrap; }
.table tbody tr { border-bottom: 1px solid var(--border); transition: background 0.12s; }
.table tbody tr:last-child { border-bottom: none; }
.table tbody tr:hover { background: var(--surface); }
.table tbody td { padding: 11px 14px; color: var(--text); vertical-align: middle; }

.pet-cell { display: flex; align-items: center; gap: 10px; }
.pet-cell div { display: flex; flex-direction: column; gap: 1px; }
.pet-cell strong { font-size: 0.88rem; color: var(--text); }
.sub { font-size: 0.75rem; color: var(--text-3); }
.record-link { font-size: 0.78rem; font-weight: 800; color: #1d4ed8; white-space: nowrap; }
.modality-name { font-size: 0.88rem; color: var(--text); display: block; }

/* Badges */
.badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 0.73rem; font-weight: 700; white-space: nowrap; }
.badge--gray   { background: #EAEAEA; color: #555; }
.badge--yellow { background: #FFF3CC; color: #8A6200; }
.badge--blue   { background: #D6EEFF; color: #1A5FAA; }
.badge--green  { background: #D6F3EC; color: #1A9E7F; }
.badge--red    { background: #FDEAEA; color: #c0392b; }
.badge--purple { background: #EDE6FF; color: #5B21B6; }
.badge--orange { background: #FEF0E0; color: #B45309; }

/* Acciones */
.action-btns { display: flex; gap: 6px; }
.btn-action { padding: 5px 12px; border: 1.5px solid var(--border); border-radius: var(--radius-sm); background: none; font-size: 0.78rem; font-weight: 500; color: var(--text-2); cursor: pointer; transition: background 0.12s; }
.btn-action:hover { background: var(--surface); }
.btn-action--primary { background: var(--primary); color: white; border-color: var(--primary); }
.btn-action--primary:hover { opacity: 0.88; }

/* Paginación */
.pagination { display: flex; align-items: center; justify-content: center; gap: 16px; font-size: 0.85rem; color: var(--text-2); }
.pagination button { padding: 6px 14px; border: 1.5px solid var(--border); border-radius: var(--radius-sm); background: none; cursor: pointer; font-size: 0.82rem; color: var(--text-2); }
.pagination button:hover:not(:disabled) { background: var(--surface-2); }
.pagination button:disabled { opacity: 0.4; cursor: not-allowed; }

/* Botones */
.btn-primary { padding: 10px 20px; background: linear-gradient(135deg, var(--primary) 0%, var(--accent-mint) 100%); color: white; border: none; border-radius: var(--radius); font-size: 0.9rem; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: opacity var(--transition), transform var(--transition); }
.btn-primary:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
.btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
.btn-ghost { padding: 10px 20px; background: none; border: 1.5px solid var(--border); border-radius: var(--radius); color: var(--text-2); font-size: 0.9rem; font-weight: 500; cursor: pointer; transition: background var(--transition); }
.btn-ghost:hover:not(:disabled) { background: var(--surface-2); }

/* Modal */
.modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 16px; }
.modal { background: var(--white); border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); width: 100%; max-width: 660px; max-height: 92vh; overflow-y: auto; display: flex; flex-direction: column; }
.modal--wide { max-width: 820px; }
.modal__header { display: flex; align-items: center; justify-content: space-between; padding: 20px 24px 14px; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: var(--white); z-index: 2; }
.modal__header h3 { font-size: 1.1rem; font-weight: 700; color: var(--text); }
.modal__close { background: none; border: none; cursor: pointer; font-size: 1rem; color: var(--text-3); padding: 4px 8px; border-radius: var(--radius-sm); }
.modal__close:hover { background: var(--surface-2); }
.modal__actions { display: flex; align-items: center; justify-content: flex-end; gap: 10px; padding: 14px 24px 20px; border-top: 1px solid var(--border); position: sticky; bottom: 0; background: var(--white); z-index: 1; }

/* Formulario */
.form-body { padding: 20px 24px 4px; flex: 1; display: flex; flex-direction: column; gap: 14px; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.field { display: flex; flex-direction: column; gap: 4px; }
.field label { font-size: 0.8rem; font-weight: 600; color: var(--text-2); }
.field input, .field select, .field textarea { padding: 8px 11px; border: 1.5px solid var(--border); border-radius: var(--radius); font-size: 0.88rem; color: var(--text); background: var(--surface); outline: none; transition: border-color var(--transition); }
.field input:focus, .field select:focus, .field textarea:focus { border-color: var(--primary); background: var(--white); }
.field textarea { resize: vertical; }
.field--full { grid-column: 1 / -1; }
.field-error { font-size: 0.73rem; color: var(--danger); }
.req { color: var(--danger); }

.checkbox-label { display: flex; align-items: center; gap: 8px; font-size: 0.86rem; color: var(--text-2); cursor: pointer; padding: 9px 11px; border: 1.5px solid var(--border); border-radius: var(--radius); transition: background 0.12s; }
.checkbox-label:hover { background: var(--surface-2); }
.checkbox-label input[type="checkbox"] { width: 15px; height: 15px; cursor: pointer; }

.section-title { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-3); margin-bottom: 8px; padding-bottom: 4px; border-bottom: 1px solid var(--border); }

/* Autocomplete */
.autocomplete { position: absolute; z-index: 100; background: var(--white); border: 1.5px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); width: 100%; max-height: 200px; overflow-y: auto; top: calc(100% + 2px); left: 0; }
.autocomplete__item { padding: 9px 13px; cursor: pointer; font-size: 0.88rem; }
.autocomplete__item:hover { background: var(--surface-2); }
.autocomplete__owner { font-size: 0.78rem; color: var(--text-3); }
.selected-patient { margin-top: 5px; font-size: 0.82rem; color: var(--primary); font-weight: 500; }

/* Info tipo estudio */
.type-info { background: var(--surface); border: 1.5px solid var(--border); border-radius: var(--radius); padding: 10px 14px; gap: 6px; }
.type-info__desc { font-size: 0.84rem; color: var(--text-2); }
.type-info__prep { font-size: 0.82rem; color: #8A6200; background: #FFF3CC; border-radius: var(--radius-sm); padding: 6px 10px; margin-top: 4px; }

/* Informe solo lectura */
.report-readonly { display: flex; flex-direction: column; gap: 16px; }
.report-section { display: flex; flex-direction: column; gap: 6px; }
.report-section p { font-size: 0.9rem; color: var(--text); line-height: 1.6; background: var(--surface); border-radius: var(--radius); padding: 12px 14px; }
.report-meta { font-size: 0.82rem; color: var(--text-3); padding-top: 4px; }

/* Alertas */
.alert { padding: 10px 14px; border-radius: var(--radius-sm); font-size: 0.875rem; }
.alert--error { background: #FDEAEA; color: #c0392b; border-left: 3px solid var(--danger); }
.mx { margin: 0 24px 8px; }

/* Estados */
.loading-state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 60px 20px; color: var(--text-3); font-size: 0.9rem; background: var(--white); border-radius: var(--radius-xl); box-shadow: var(--shadow-sm); }
.empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 60px 20px; color: var(--text-3); font-size: 0.9rem; background: var(--white); border-radius: var(--radius-xl); box-shadow: var(--shadow-sm); }
.empty-state__emoji { font-size: 3rem; }

/* Spinner */
.spin { width: 20px; height: 20px; border: 2px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: spin 0.7s linear infinite; display: inline-block; }
.spin--sm { width: 14px; height: 14px; }
.spin--dark { border-color: rgba(0,0,0,0.1); border-top-color: var(--primary); }
@keyframes spin { to { transform: rotate(360deg); } }

/* Transición modal */
.modal-enter-active, .modal-leave-active { transition: opacity 0.2s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }

@media (max-width: 700px) {
  .workflow-banner { grid-template-columns: 1fr; }
  .stats-row { gap: 10px; }
  .stat-card { min-width: 130px; }
  .form-grid { grid-template-columns: 1fr; }
  .modal { max-width: 100%; max-height: 100vh; border-radius: 0; }
  .table thead th:nth-child(5), .table tbody td:nth-child(5) { display: none; }
}
</style>
