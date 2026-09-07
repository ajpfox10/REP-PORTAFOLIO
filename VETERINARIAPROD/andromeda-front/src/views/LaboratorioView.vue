<template>
  <div class="page">

    <div class="page-header">
      <div class="page-header__left">
        <span class="page-emoji">&#x1F43E;</span>
        <div>
          <h2 class="page-title">Bandeja de laboratorio</h2>
          <p class="page-sub">Órdenes generadas desde evoluciones clínicas y seguimiento de resultados.</p>
        </div>
      </div>
      <RouterLink class="btn-primary route-action" to="/evoluciones">Crear desde evolución</RouterLink>
    </div>

    <section class="workflow-banner" aria-label="Flujo clínico de laboratorio">
      <div>
        <strong>Flujo clínico</strong>
        <span>Evolución → Orden de laboratorio → Resultados → Revisión clínica</span>
      </div>
      <p>Las órdenes nuevas deben nacer desde una evolución para conservar motivo, paciente, profesional y trazabilidad de ficha.</p>
    </section>

    <!-- Stats -->
    <div class="stats-row">
      <div class="stat-card" style="--c:#FFF3CC;--ct:#8A6200">
        <span class="stat-card__icon">&#x2713;</span>
        <div>
          <strong>{{ stats.pending }}</strong>
          <span>{{ t('laboratory.pending') }}</span>
        </div>
      </div>
      <div class="stat-card" style="--c:#D6EEFF;--ct:#1A5FAA">
        <span class="stat-card__icon">&#x1F43E;</span>
        <div>
          <strong>{{ stats.inProgress }}</strong>
          <span>{{ t('laboratory.inProgress') }}</span>
        </div>
      </div>
      <div class="stat-card" style="--c:#D6F3EC;--ct:#1A9E7F">
        <span class="stat-card__icon">&#x2713;</span>
        <div>
          <strong>{{ stats.completedToday }}</strong>
          <span>{{ t('laboratory.completedToday') }}</span>
        </div>
      </div>
    </div>

    <!-- Filtros -->
    <div class="filters">
      <label for="lab-search" class="sr-only">{{ t('laboratory.searchPlaceholder') }}</label>
      <input
        id="lab-search"
        name="lab-search"
        v-model.trim="search"
        type="search"
        :placeholder="t('laboratory.searchPlaceholder')"
        class="filter-input filter-input--grow"
        @input="debouncedLoad()"
      />
      <label for="lab-status" class="sr-only">{{ t('common.allStatuses') }}</label>
      <select id="lab-status" name="lab-status" v-model="statusFilter" class="filter-select" @change="load()">
        <option value="">{{ t('common.allStatuses') }}</option>
        <option value="pending">{{ t('laboratory.pending') }}</option>
        <option value="in_progress">{{ t('laboratory.inProgress') }}</option>
        <option value="completed">{{ t('laboratory.statusCompleted') }}</option>
        <option value="cancelled">{{ t('laboratory.statusCancelled') }}</option>
      </select>
    </div>

      <div v-if="loading" class="loading-state" role="status" aria-live="polite">
      <span class="spin spin--dark" /> {{ t('laboratory.loading') }}
    </div>
    <div v-else-if="error" class="alert alert--error" role="alert">{{ error }}</div>
    <div v-else-if="items.length === 0" class="empty-state">
      <span class="empty-state__emoji">&#x1F43E;</span>
      <p>{{ t('laboratory.empty') }}</p>
    </div>

    <div v-else class="card">
      <table class="table">
        <thead>
          <tr>
            <th>{{ t('laboratory.tablePatient') }}</th>
            <th>Evolución</th>
            <th>{{ t('laboratory.tableTests') }}</th>
            <th>{{ t('laboratory.tablePriority') }}</th>
            <th>{{ t('laboratory.tableStatus') }}</th>
            <th>{{ t('laboratory.tableDate') }}</th>
            <th>Reporte</th>
            <th>{{ t('laboratory.tableActions') }}</th>
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
              <span class="test-count">{{ order.test_count || 0 }} {{ t('laboratory.testsTitle') }}</span>
            </td>
            <td>
              <span class="badge" :class="priorityClass(order.priority)">{{ priorityLabel(order.priority) }}</span>
            </td>
            <td>
              <span class="badge" :class="statusClass(order.status)">{{ statusLabel(order.status) }}</span>
            </td>
            <td class="sub">{{ formatDate(order.requested_at) }}</td>
            <td class="sub"><span v-if="order.reported_at">{{ formatDate(order.reported_at) }}</span><span v-else>-</span><span v-if="order.results_count != null"> · {{ order.results_count }} res.</span></td>
            <td>
              <div class="action-btns">
                  <BaseButton
                  v-if="order.status === 'pending' || order.status === 'in_progress'"
                  class="btn-action btn-action--primary"
                  @click="openResults(order)"
                  :title="t('laboratory.resultsTitle')"
                >
                  {{ t('laboratory.resultsButton') }}
                </BaseButton>
                <BaseButton
                  class="btn-action"
                  @click="viewDetail(order)"
                  :title="t('laboratory.view')"
                >
                  {{ t('laboratory.view') }}
                </BaseButton>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="pagination.totalPages > 1" class="pagination">
      <button type="button" :disabled="pagination.page <= 1" @click="load(pagination.page - 1)">{{ t('common.previous') }}</button>
      <span>{{ pagination.page }} / {{ pagination.totalPages }}</span>
      <button type="button" :disabled="pagination.page >= pagination.totalPages" @click="load(pagination.page + 1)">{{ t('common.next') }}</button>
    </div>

    <!-- Modal ingresar resultados -->
    <Transition name="modal">
      <div v-if="showResults" class="modal-backdrop" @click.self="showResults = false">
        <div class="modal modal--wide">
          <div class="modal__header">
            <h3>{{ t('laboratory.resultsTitle') }} — {{ selectedOrder?.patient_name }}</h3>
            <BaseButton type="button" variant="ghost" class="modal__close" @click="showResults = false">&times;</BaseButton>
          </div>

          <div v-if="detailLoading" class="loading-state" style="min-height:200px" role="status" aria-live="polite">
            <span class="spin spin--dark" /> {{ t('laboratory.resultsLoading') }}
          </div>
          <form v-else @submit.prevent="handleSubmitResults" novalidate>
            <div class="form-body">
              <div v-if="orderDetail" class="result-item" style="margin-bottom:16px">
                <div class="result-item__header">
                  <strong>{{ orderDetail.order_number || ('Orden #' + selectedOrder?.id) }}</strong>
                  <span class="sub">{{ orderDetail.ordered_by || orderDetail.vet_name || '' }}</span>
                </div>
                <div class="sub">
                  {{ formatDate(orderDetail.ordered_at || orderDetail.requested_at) }}
                  <span v-if="orderDetail.reported_at"> · Reportado {{ formatDate(orderDetail.reported_at) }}</span>
                </div>
                <p v-if="orderDetail.clinical_notes" class="sub" style="margin-top:6px">{{ orderDetail.clinical_notes }}</p>
              </div>
              <div v-if="orderDetail && orderDetail.items && orderDetail.items.length > 0">
                <div
                  v-for="item in orderDetail.items"
                  :key="item.id"
                  class="result-item"
                >
                  <div class="result-item__header">
                    <strong>{{ item.test_name || item.name }}</strong>
                    <span class="sub">{{ item.normal_range ? 'Rango normal: ' + item.normal_range : '' }}{{ item.units ? ' (' + item.units + ')' : '' }}</span>
                  </div>
                  <div class="form-grid">
                    <div class="field">
                      <label :for="`lab-r-val-${item.id}`">{{ t('laboratory.valueLabel') }}</label>
                      <input
                        :id="`lab-r-val-${item.id}`"
                        :name="`lab-r-val-${item.id}`"
                        v-model.trim="resultInputs[item.id].value"
                        type="text"
                        :placeholder="item.units || 'Resultado'"
                        :disabled="savingResults"
                      />
                    </div>
                    <div class="field">
                      <label :for="`lab-r-int-${item.id}`">{{ t('laboratory.interpretationLabel') }}</label>
                      <select :id="`lab-r-int-${item.id}`" :name="`lab-r-int-${item.id}`" v-model="resultInputs[item.id].interpretation" :disabled="savingResults">
                        <option value="">{{ t('laboratory.interpretationNone') }}</option>
                        <option value="normal">{{ t('laboratory.normal') }}</option>
                        <option value="low">{{ t('laboratory.low') }}</option>
                        <option value="high">{{ t('laboratory.high') }}</option>
                        <option value="critical_low">{{ t('laboratory.criticalLow') }}</option>
                        <option value="critical_high">{{ t('laboratory.criticalHigh') }}</option>
                      </select>
                    </div>
                    <div class="field field--full">
                      <label :for="`lab-r-notes-${item.id}`">{{ t('laboratory.notesResultLabel') }}</label>
                      <input
                        :id="`lab-r-notes-${item.id}`"
                        :name="`lab-r-notes-${item.id}`"
                        v-model.trim="resultInputs[item.id].notes"
                        type="text"
                        :placeholder="t('laboratory.notesResultLabel')"
                        :disabled="savingResults"
                      />
                    </div>
                  </div>
                </div>
              </div>
              <div v-else class="empty-state" style="padding:30px">
                <p>{{ t('laboratory.noItems') }}</p>
              </div>
            </div>

            <div v-if="resultsError" class="alert alert--error mx" role="alert">{{ resultsError }}</div>

            <div class="modal__actions">
              <BaseButton type="button" variant="ghost" @click="showResults = false" :disabled="savingResults">{{ t('common.cancel') }}</BaseButton>
              <BaseButton type="submit" :disabled="savingResults">
                <span v-if="savingResults" class="spin spin--sm" />
                <span v-else>{{ t('laboratory.saveResults') }}</span>
              </BaseButton>
            </div>
          </form>
        </div>
      </div>
    </Transition>

  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import BaseButton from '../components/base/BaseButton.vue'
import { labApi } from '../api'
import { t } from '../i18n'
import { extractDetailedErrorMessage, logError } from '../utils/errors'
import { useUiFeedback } from '../composables/useUiFeedback'

const { success } = useUiFeedback()

function asArray(value) {
  if (Array.isArray(value)) return value
  if (value == null) return []
  return [value]
}

function normalizeOrder(row) {
  if (!row || typeof row !== 'object') return null
  return {
    ...row,
    id: row.id ?? row.order_id ?? row.orderId ?? null,
    medical_record_id: row.medical_record_id ?? row.medicalRecordId ?? null,
    patient_name: row.patient_name ?? row.patient?.name ?? row.patientName ?? '',
    vet_name: row.vet_name ?? row.vet?.name ?? row.vetName ?? '',
    species: row.species ?? row.species_name ?? row.speciesName ?? '',
    priority: row.priority ?? 'routine',
    status: row.status ?? 'pending',
    requested_at: row.requested_at ?? row.ordered_at ?? row.requestedAt ?? row.orderedAt ?? null,
    ordered_at: row.ordered_at ?? row.requested_at ?? row.orderedAt ?? row.requestedAt ?? null,
    reported_at: row.reported_at ?? row.reportedAt ?? null,
    clinical_notes: row.clinical_notes ?? row.clinicalNotes ?? '',
    ordered_by: row.ordered_by ?? row.orderedBy ?? '',
    test_count: row.test_count ?? row.testCount ?? row.tests?.length ?? 0,
    results_count: row.results_count ?? row.resultsCount ?? null,
  }
}

// -- Lista de órdenes --------------------------------------------------------
const items       = ref([])
const loading     = ref(false)
const error       = ref('')
const search      = ref('')
const statusFilter = ref('')
const pagination  = ref({ page: 1, totalPages: 1 })

const stats = reactive({ pending: 0, inProgress: 0, completedToday: 0 })

async function load(page = 1) {
  loading.value = true; error.value = ''
  try {
    const pageSize = 15
    const params = {}
    if (statusFilter.value) params.status = statusFilter.value
    const { data } = await labApi.orders.list(params)
    const rows = asArray(data?.data || data?.orders || data).map(normalizeOrder).filter(Boolean)
    const needle = search.value.trim().toLowerCase()
    const filtered = needle
      ? rows.filter((row) => [row.order_number, row.patient_name, row.ordered_by, row.clinical_notes]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle)))
      : rows
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
    const safePage = Math.min(page, totalPages)
    items.value = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)
    pagination.value = { page: safePage, totalPages }
    await loadStats()
  } catch (e) {
    error.value = extractDetailedErrorMessage(e, 'No se pudieron cargar las órdenes.', { context: 'Carga de órdenes de laboratorio' })
  } finally { loading.value = false }
}

async function loadStats() {
  try {
    const { data } = await labApi.orders.pending()
    const pending = asArray(data?.data || data?.orders || data).map(normalizeOrder).filter(Boolean)
    stats.pending = pending.length
  } catch (error) { logError('laboratorio.loadPendingStats', error) }

  // Calcular stats desde la lista completa si no hay endpoint dedicado
  const today = new Date().toISOString().split('T')[0]
  let inProgress = 0, completedToday = 0
  items.value.forEach(o => {
    if (o.status === 'in_progress') inProgress++
    if (o.status === 'completed' && (o.requested_at || '').startsWith(today)) completedToday++
  })
  stats.inProgress     = inProgress
  stats.completedToday = completedToday
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

function priorityClass(p) {
  return { routine: 'badge--blue', urgent: 'badge--yellow', emergency: 'badge--red' }[p] || 'badge--gray'
}

function priorityLabel(p) {
  return { routine: 'Rutina', urgent: 'Urgente', emergency: 'Emergencia' }[p] || p || '—'
}

function statusClass(s) {
  return { pending: 'badge--gray', in_progress: 'badge--yellow', completed: 'badge--green', cancelled: 'badge--red' }[s] || 'badge--gray'
}

function statusLabel(s) {
  return { pending: 'Pendiente', in_progress: 'En proceso', completed: 'Completada', cancelled: 'Cancelada' }[s] || s || '—'
}

// -- Detalle (solo para ver) --------------------------------------------------
function viewDetail(order) {
  // Abrir modal de resultados en modo lectura o simplemente abrir
  // Por simplicidad, redirigimos a ingresar resultados si está pendiente
  openResults(order)
}

// -- Modal ingresar resultados ------------------------------------------------
const showResults    = ref(false)
const selectedOrder  = ref(null)
const orderDetail    = ref(null)
const detailLoading  = ref(false)
const resultInputs   = reactive({})
const savingResults  = ref(false)
const resultsError   = ref('')

async function openResults(order) {
  selectedOrder.value = order
  detailLoading.value = true
  showResults.value   = true
  resultsError.value  = ''
  orderDetail.value   = null
  Object.keys(resultInputs).forEach(k => delete resultInputs[k])
  try {
    const { data } = await labApi.orders.get(order.id)
    const detail = data.data || data
    orderDetail.value = detail
    const items = detail.items || []
    items.forEach(item => {
      resultInputs[item.id] = { value: '', interpretation: '', notes: '' }
    })
  } catch (e) {
    resultsError.value = extractDetailedErrorMessage(e, 'No se pudo cargar el detalle.', { context: 'Detalle de orden de laboratorio' })
  } finally { detailLoading.value = false }
}

async function handleSubmitResults() {
  savingResults.value = true; resultsError.value = ''
  try {
    const results = Object.entries(resultInputs)
      .filter(([, r]) => r.value !== '')
      .map(([itemId, r]) => {
        const entry = { itemId: parseInt(itemId, 10), value: r.value }
        if (r.interpretation) entry.interpretation = r.interpretation
        if (r.notes)          entry.notes          = r.notes
        return entry
      })
    if (results.length === 0) {
      resultsError.value = t('laboratory.atLeastOneResult')
      return
    }
    await labApi.orders.result(selectedOrder.value.id, { results })
    success('Resultados de laboratorio guardados.')
    showResults.value = false
    await load()
  } catch (e) {
    resultsError.value = extractDetailedErrorMessage(e, 'No se pudieron guardar los resultados.', { context: 'Guardado de resultados de laboratorio' })
  } finally { savingResults.value = false }
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
.test-count { font-size: 0.82rem; color: var(--text-2); }

/* Badges */
.badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 0.73rem; font-weight: 700; white-space: nowrap; }
.badge--gray   { background: #EAEAEA; color: #555; }
.badge--yellow { background: #FFF3CC; color: #8A6200; }
.badge--blue   { background: #D6EEFF; color: #1A5FAA; }
.badge--green  { background: #D6F3EC; color: #1A9E7F; }
.badge--red    { background: #FDEAEA; color: #c0392b; }

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
.modal { background: var(--white); border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); width: 100%; max-width: 700px; max-height: 92vh; overflow-y: auto; display: flex; flex-direction: column; }
.modal--wide { max-width: 860px; }
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

.section-title { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-3); margin-bottom: 8px; padding-bottom: 4px; border-bottom: 1px solid var(--border); }

/* Autocomplete */
.autocomplete { position: absolute; z-index: 100; background: var(--white); border: 1.5px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); width: 100%; max-height: 200px; overflow-y: auto; top: calc(100% + 2px); left: 0; }
.autocomplete__item { padding: 9px 13px; cursor: pointer; font-size: 0.88rem; }
.autocomplete__item:hover { background: var(--surface-2); }
.autocomplete__owner { font-size: 0.78rem; color: var(--text-3); }
.selected-patient { margin-top: 5px; font-size: 0.82rem; color: var(--primary); font-weight: 500; }

/* Catálogo pruebas */
.tests-catalog { display: flex; flex-direction: column; gap: 16px; max-height: 320px; overflow-y: auto; padding-right: 4px; }
.test-category__title { font-size: 0.78rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--primary); margin-bottom: 8px; }
.test-category__items { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.test-checkbox-label { display: flex; align-items: flex-start; gap: 8px; padding: 8px 10px; border: 1.5px solid var(--border); border-radius: var(--radius); cursor: pointer; transition: background 0.12s, border-color 0.12s; }
.test-checkbox-label:hover { background: var(--surface-2); }
.test-checkbox-label input[type="checkbox"] { width: 15px; height: 15px; cursor: pointer; flex-shrink: 0; margin-top: 2px; }
.test-info { display: flex; flex-direction: column; gap: 2px; }
.test-name { font-size: 0.85rem; color: var(--text); font-weight: 500; }
.test-meta { font-size: 0.72rem; }

/* Resultados */
.result-item { background: var(--surface); border: 1.5px solid var(--border); border-radius: var(--radius-lg); padding: 14px 16px; margin-bottom: 12px; }
.result-item__header { display: flex; flex-direction: column; gap: 2px; margin-bottom: 12px; }
.result-item__header strong { font-size: 0.93rem; color: var(--text); }

/* Alertas */
.alert { padding: 10px 14px; border-radius: var(--radius-sm); font-size: 0.875rem; }
.alert--error { background: #FDEAEA; color: #c0392b; border-left: 3px solid var(--danger); }
.mx { margin: 0 24px 8px; }

/* Estados */
.loading-state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 60px 20px; color: var(--text-3); font-size: 0.9rem; background: var(--white); border-radius: var(--radius-xl); box-shadow: var(--shadow-sm); }
.loading-state-sm { display: flex; align-items: center; gap: 8px; padding: 12px; color: var(--text-3); font-size: 0.85rem; }
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
  .test-category__items { grid-template-columns: 1fr; }
  .modal { max-width: 100%; max-height: 100vh; border-radius: 0; }
  .table thead th:nth-child(2), .table tbody td:nth-child(2) { display: none; }
}
</style>
