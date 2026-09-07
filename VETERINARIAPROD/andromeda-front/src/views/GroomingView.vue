<template>
  <div class="page">

    <div class="page-header">
      <div class="page-header__left">
        <span class="page-emoji" aria-hidden="true">&#x1F43E;</span>
        <div>
          <h2 class="page-title">{{ t('grooming.title') }}</h2>
          <p class="page-sub">{{ t('grooming.subtitle') }}</p>
        </div>
      </div>
      <button type="button" class="btn-primary" @click="openModal()">{{ t('grooming.newSession') }}</button>
    </div>

    <!-- KPIs -->
    <div class="kpi-row">
      <div class="kpi" style="--c:#FFE4D6;--ct:#c0392b">
        <span aria-hidden="true">&#x1F43E;</span><div><strong>{{ kpis.today }}</strong><span>{{ t('common.today') }}</span></div>
      </div>
      <div class="kpi" style="--c:#FFF3CC;--ct:#8A6200">
        <span aria-hidden="true">&#x2713;</span><div><strong>{{ kpis.pending }}</strong><span>{{ t('common.pending') }}</span></div>
      </div>
      <div class="kpi" style="--c:#D6F3EC;--ct:#1A9E7F">
        <span aria-hidden="true">&#x2713;</span><div><strong>{{ kpis.completed }}</strong><span>{{ t('grooming.completed') }}</span></div>
      </div>
      <div class="kpi" style="--c:#D6EEFF;--ct:#1A5FAA">
        <span aria-hidden="true">&#x1F43E;</span><div><strong>{{ kpis.revenue }}</strong><span>{{ t('grooming.revenueToday') }}</span></div>
      </div>
    </div>

    <div class="filters">
      <label for="groom-date" class="sr-only">{{ t('grooming.dateFilter') }}</label>
      <input id="groom-date" name="groom-date" v-model="dateFilter" type="date" class="filter-input" @change="load()" />
      <label for="groom-status" class="sr-only">{{ t('grooming.allStatuses') }}</label>
      <select id="groom-status" name="groom-status" v-model="statusFilter" class="filter-select" @change="load()">
        <option value="">{{ t('grooming.allStatuses') }}</option>
        <option value="scheduled">{{ t('grooming.statusScheduled') }}</option>
        <option value="in_progress">{{ t('grooming.statusInProgress') }}</option>
        <option value="completed">{{ t('grooming.statusCompleted') }}</option>
        <option value="cancelled">{{ t('grooming.statusCancelled') }}</option>
      </select>
      <label for="groom-search" class="sr-only">{{ t('grooming.searchPlaceholder') }}</label>
      <input id="groom-search" name="groom-search" v-model.trim="search" type="search" :placeholder="t('grooming.searchPlaceholder')" class="filter-input filter-input--grow" @input="debouncedLoad()" />
    </div>

    <div v-if="loading" class="loading-state" role="status"><span class="spin spin--dark" /> {{ t('grooming.loading') }}</div>
    <div v-else-if="error" class="alert alert--error">{{ error }}</div>
    <div v-else-if="items.length === 0" class="empty-state">
      <span class="empty-state__emoji" aria-hidden="true">&#x1F43E;</span>
      <p>{{ t('grooming.emptyState') }}</p>
    </div>

    <div v-else class="groom-grid">
      <div v-for="g in items" :key="g.id" class="groom-card">
        <div class="groom-card__header" :class="`header--${g.status}`">
          <div class="groom-card__time">
            <span class="groom-card__hour">{{ formatTime(g.scheduled_date || g.start_time) }}</span>
            <span class="badge" :class="`status--${g.status}`">{{ STATUS[g.status] || g.status }}</span>
          </div>
        </div>
        <div class="groom-card__body">
          <div class="groom-card__pet">
            <span class="groom-emoji" aria-hidden="true">{{ petEmoji(g.patient?.species) }}</span>
            <div>
              <strong>{{ g.patient?.name || g.patient_name || '—' }}</strong>
              <span class="sub">{{ g.patient?.owner?.full_name || g.owner_name || '' }}</span>
            </div>
          </div>
          <div class="groom-card__services">
            <span v-for="svc in parseServices(g.services)" :key="svc" class="svc-chip">{{ svc }}</span>
          </div>
          <div class="groom-card__row" v-if="g.groomer_name">
            <span aria-hidden="true">Groomer</span> <span>{{ g.groomer_name }}</span>
          </div>
          <div class="groom-card__row" v-if="g.phone">
            <span aria-hidden="true">Tel</span> <span>{{ g.phone }}</span>
          </div>
          <div class="groom-card__row" v-if="g.estimated_duration_minutes">
            <span aria-hidden="true">Dur</span> <span>{{ g.estimated_duration_minutes }} min</span>
          </div>
          <div class="groom-card__row" v-if="g.price">
            <span aria-hidden="true">Est</span> <span>${{ g.price }}</span>
          </div>
          <div class="groom-card__row" v-if="g.final_price">
            <span aria-hidden="true">Fin</span> <span>Final ${{ g.final_price }}</span>
          </div>
          <div class="groom-card__services" v-if="g.pickup_required || g.delivery_required">
            <span v-if="g.pickup_required" class="svc-chip">Retiro</span>
            <span v-if="g.delivery_required" class="svc-chip">Entrega</span>
          </div>
          <div class="groom-card__row" v-if="g.pickup_address || g.delivery_address">
            <span aria-hidden="true">Dir</span> <span>{{ g.pickup_address || g.delivery_address }}</span>
          </div>
          <div class="groom-card__row" v-if="g.notes">
            <span aria-hidden="true">Obs</span> <span class="notes-text">{{ g.notes }}</span>
          </div>
        </div>
        <div class="groom-card__actions">
          <button v-if="g.status === 'scheduled'" type="button" class="btn-xs btn-xs--yellow" @click="changeStatus(g, 'in_progress')">{{ t('grooming.start') }}</button>
          <button v-if="g.status === 'in_progress'" type="button" class="btn-xs btn-xs--green" @click="changeStatus(g, 'completed')">{{ t('grooming.finish') }}</button>
          <button v-if="g.status !== 'completed' && g.status !== 'cancelled'" type="button" class="btn-xs btn-xs--red" @click="changeStatus(g, 'cancelled')">{{ t('common.cancel') }}</button>
        </div>
      </div>
    </div>

    <!-- Modal -->
    <Transition name="modal">
      <div v-if="showModal" class="modal-backdrop" @click.self="closeModal()">
        <div class="modal">
          <div class="modal__header">
            <h3>{{ t('grooming.modalTitle') }}</h3>
            <button type="button" class="modal__close" :aria-label="t('common.close')" @click="closeModal()">×</button>
          </div>
          <form @submit.prevent="handleCreate" novalidate>
            <div class="form-body">
              <div class="form-grid">
                <div class="field">
                  <label for="groom-m-date">{{ t('grooming.scheduledAt') }} <span class="req">*</span></label>
                  <input id="groom-m-date" name="groom-m-date" v-model="form.scheduledAt" type="datetime-local" :disabled="saving" required />
                  <span v-if="fe.scheduledAt" class="field-error">{{ fe.scheduledAt }}</span>
                </div>
                <div class="field field--full">
                  <label for="groom-m-groomer">{{ t('grooming.groomer') }} <span class="req">*</span></label>
                  <select id="groom-m-groomer" name="groom-m-groomer" v-model="form.groomerId" :disabled="saving" required>
                    <option value="">{{ t('grooming.selectGroomer') }}</option>
                    <option v-for="g in groomerList" :key="g.id" :value="g.id">{{ g.name }}</option>
                  </select>
                  <span v-if="fe.groomerId" class="field-error">{{ fe.groomerId }}</span>
                </div>
                <div class="field field--full">
                  <label for="groom-m-patient">{{ t('grooming.patient') }} <span class="req">*</span></label>
                  <input id="groom-m-patient" name="groom-m-patient" v-model.trim="patientSearch" type="search" :placeholder="t('grooming.patientSearch')" :disabled="saving" @input="searchPatients" autocomplete="off" />
                  <div v-if="patientResults.length" class="autocomplete" role="listbox" :aria-label="t('common.searchResults')">
                    <button v-for="pt in patientResults" :key="pt.id" type="button" class="autocomplete__item" role="option" :aria-label="`${t('common.selectPatient')} ${pt.name}`" @click="selectPatient(pt)">
                      {{ petEmoji(pt.species) }} <b>{{ pt.name }}</b>
                      <span class="autocomplete__owner">— {{ pt.primary_owner || '' }}</span>
                    </button>
                  </div>
                  <div v-if="form.patientId" class="selected-patient">&#x2713; {{ selectedPatientLabel }}</div>
                  <span v-if="fe.patientId" class="field-error">{{ fe.patientId }}</span>
                </div>
                <div class="field field--full">
                  <label>{{ t('grooming.services') }}</label>
                  <div class="services-check">
                    <label v-for="svc in serviceTypesList" :key="svc.id" class="check-item">
                      <input type="checkbox" v-model="form.selectedServiceIds" :value="svc.id" :disabled="saving" />
                      <span>{{ svc.name }}</span>
                    </label>
                  </div>
                  <span v-if="serviceTypesError" class="field-error">{{ serviceTypesError }}</span>
                  <span v-if="fe.services" class="field-error">{{ fe.services }}</span>
                </div>
                <div class="field">
                  <label for="groom-m-price">{{ t('grooming.estimatedPrice') }}</label>
                  <input id="groom-m-price" name="groom-m-price" v-model.number="form.price" type="number" min="0" step="0.01" :placeholder="t('grooming.pricePlaceholder')" :disabled="saving" />
                </div>
                <div class="field">
                  <label for="groom-m-duration">Duración estimada</label>
                  <input id="groom-m-duration" name="groom-m-duration" v-model.number="form.estimatedDurationMinutes" type="number" min="0" step="1" placeholder="ej: 90" :disabled="saving" />
                </div>
                <div class="field field--full">
                  <label class="check-item">
                    <input type="checkbox" v-model="form.pickupRequired" :disabled="saving" />
                    <span>Requiere retiro</span>
                  </label>
                </div>
                <div v-if="form.pickupRequired" class="field field--full">
                  <label for="groom-m-pickup-addr">Direccion de retiro</label>
                  <input id="groom-m-pickup-addr" name="groom-m-pickup-addr" v-model.trim="form.pickupAddress" type="text" placeholder="Direccion de retiro" :disabled="saving" />
                </div>
                <div class="field field--full">
                  <label class="check-item">
                    <input type="checkbox" v-model="form.deliveryRequired" :disabled="saving" />
                    <span>Requiere entrega</span>
                  </label>
                </div>
                <div v-if="form.deliveryRequired" class="field field--full">
                  <label for="groom-m-delivery-addr">Direccion de entrega</label>
                  <input id="groom-m-delivery-addr" name="groom-m-delivery-addr" v-model.trim="form.deliveryAddress" type="text" placeholder="Direccion de entrega" :disabled="saving" />
                </div>
                <div class="field field--full">
                  <label for="groom-m-notes">{{ t('grooming.notes') }}</label>
                  <textarea id="groom-m-notes" name="groom-m-notes" v-model.trim="form.notes" rows="2" :placeholder="t('grooming.notesPlaceholder')" :disabled="saving" />
                </div>
              </div>
            </div>
            <div v-if="saveError" class="alert alert--error mx">{{ saveError }}</div>
            <div class="modal__actions">
              <button type="button" class="btn-ghost" @click="closeModal()" :disabled="saving">{{ t('common.cancel') }}</button>
              <button type="submit" class="btn-primary" :disabled="saving">
                <span v-if="saving" class="spin spin--sm" /> <span v-else>{{ t('grooming.scheduleSession') }}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import { groomingApi, patientsApi } from '../api'
import { t } from '../i18n'
import { extractDetailedErrorMessage, logError } from '../utils/errors'
import { useUiFeedback } from '../composables/useUiFeedback'

const { notifyError, success } = useUiFeedback()

function asArray(value) {
  if (Array.isArray(value)) return value
  if (value == null) return []
  return [value]
}

function normalizeGrooming(row) {
  if (!row || typeof row !== 'object') return null
  return {
    ...row,
    id: row.id ?? row.appointment_id ?? row.appointmentId ?? null,
    patient_name: row.patient_name ?? row.patient?.name ?? row.patientName ?? '',
    client_name: row.client_name ?? row.client?.name ?? row.clientName ?? '',
    groomer_name: row.groomer_name ?? row.groomer?.name ?? row.groomerName ?? '',
    services: row.services ?? row.service_names ?? row.serviceNames ?? [],
    status: row.status ?? '',
    scheduled_date: row.scheduled_date ?? row.scheduledAt ?? row.start_time ?? null,
    start_time: row.start_time ?? row.scheduled_date ?? null,
    price: row.price ?? row.estimated_price ?? row.estimatedPrice ?? null,
    final_price: row.final_price ?? row.finalPrice ?? null,
    estimated_duration_minutes: row.estimated_duration_minutes ?? row.estimatedDurationMinutes ?? null,
    pickup_required: row.pickup_required ?? row.pickupRequired ?? false,
    pickup_address: row.pickup_address ?? row.pickupAddress ?? '',
    delivery_required: row.delivery_required ?? row.deliveryRequired ?? false,
    delivery_address: row.delivery_address ?? row.deliveryAddress ?? '',
    phone: row.phone ?? row.client_phone ?? row.clientPhone ?? '',
    patient: row.patient ?? null,
  }
}

function normalizeGroomer(row) {
  if (!row || typeof row !== 'object') return null
  return {
    ...row,
    id: row.id ?? row.groomer_id ?? row.groomerId ?? null,
    name: row.name ?? `${row.first_name || ''} ${row.last_name || ''}`.trim(),
  }
}

function normalizeServiceType(row) {
  if (!row || typeof row !== 'object') return null
  return {
    ...row,
    id: row.id ?? row.service_type_id ?? row.serviceTypeId ?? null,
    name: row.name ?? row.service_name ?? row.serviceName ?? '',
  }
}

function normalizePatient(row) {
  if (!row || typeof row !== 'object') return null
  return {
    ...row,
    id: row.id ?? row.patient_id ?? row.patientId ?? null,
    name: row.name ?? row.full_name ?? row.fullName ?? '',
    primary_owner: row.primary_owner ?? row.owner_name ?? row.ownerName ?? '',
    owner_id: row.owner_id ?? row.ownerId ?? '',
  }
}

const items = ref([])
const loading = ref(false)
const error   = ref('')
const search  = ref('')
const dateFilter   = ref(new Date().toISOString().split('T')[0])
const statusFilter = ref('')
const kpis = ref({ today: 0, pending: 0, completed: 0, revenue: '$0' })

const STATUS = {
  scheduled: t('grooming.statusScheduled'),
  confirmed: t('grooming.statusConfirmed'),
  in_progress: t('grooming.statusInProgress'),
  ready: t('grooming.statusReady'),
  completed: t('grooming.statusCompleted'),
  cancelled: t('grooming.statusCancelled'),
  no_show: t('grooming.statusNoShow'),
}

// Tipos de servicio desde DB
const serviceTypesList = ref([])
const serviceTypesError = ref('')
async function loadServiceTypes() {
  serviceTypesError.value = ''
  try {
    const { data } = await groomingApi.services()
    serviceTypesList.value = asArray(data?.data || data?.serviceTypes || data).map(normalizeServiceType).filter(Boolean)
  } catch (error) {
    logError('grooming.loadServiceTypes', error)
    serviceTypesList.value = []
    serviceTypesError.value = extractDetailedErrorMessage(error, 'No se pudo cargar el catálogo de servicios.', { context: 'Catálogo de grooming' })
  }
}

function petEmoji(s) {
  const sl = String(s || '').toLowerCase()
  const m = {
    perro: '\u{1F436}',
    dog: '\u{1F436}',
    gato: '\u{1F431}',
    cat: '\u{1F431}',
    conejo: '\u{1F430}',
    rabbit: '\u{1F430}',
    loro: '\u{1F99C}',
    bird: '\u{1F99C}',
    pez: '\u{1F41F}',
    fish: '\u{1F41F}',
    tortuga: '\u{1F422}',
    reptile: '\u{1F98E}',
    hamster: '\u{1F439}',
  }
  return m[sl] || '\u{1F43E}'
}

function parseServices(s) {
  if (!s) return []
  if (Array.isArray(s)) return s
  try { return JSON.parse(s) } catch { return s.split(',').map(x => x.trim()) }
}

function formatTime(dt) {
  if (!dt) return '—'
  return new Date(dt).toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' })
}

async function load() {
  loading.value = true; error.value = ''
  try {
    const params = {}
    if (dateFilter.value)   params.date   = dateFilter.value
    if (statusFilter.value) params.status = statusFilter.value
    const { data } = await groomingApi.appointments.list(params)
    const rows = asArray(data?.data || data?.sessions || data).map(normalizeGrooming).filter(Boolean)
    const needle = search.value.trim().toLowerCase()
    items.value = needle
      ? rows.filter((row) => [row.patient_name, row.client_name, row.groomer_name, row.services]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle)))
      : rows
    const all = items.value
    kpis.value.today     = all.length
    kpis.value.pending   = all.filter(g => g.status === 'scheduled').length
    kpis.value.completed = all.filter(g => g.status === 'completed').length
    const total = all.filter(g => g.status === 'completed').reduce((s, g) => s + (parseFloat(g.price) || 0), 0)
    kpis.value.revenue = '$' + total.toLocaleString('es-AR')
  } catch (e) {
    error.value = extractDetailedErrorMessage(e, t('grooming.loadError'), { context: 'Carga de grooming' })
  } finally { loading.value = false }
}

let timer = null
function debouncedLoad() { clearTimeout(timer); timer = setTimeout(load, 350) }

async function changeStatus(g, status) {
  try {
    await groomingApi.appointments.updateStatus(g.id, status)
    g.status = status
    kpis.value.pending   = items.value.filter(x => x.status === 'scheduled').length
    kpis.value.completed = items.value.filter(x => x.status === 'completed').length
    success('Sesión de grooming actualizada correctamente.')
  } catch (e) {
    notifyError('grooming.changeStatus', e, t('grooming.updateError'), { context: 'Actualización de grooming' })
  }
}

// Groomer list
const groomerList = ref([])
async function loadGroomers() {
  try {
    const { data } = await groomingApi.groomers()
    groomerList.value = asArray(data?.data || data?.groomers || data).map(normalizeGroomer).filter(Boolean)
  } catch (error) { logError('grooming.loadGroomers', error); groomerList.value = [] }
}

// Patient autocomplete
const patientSearch = ref('')
const patientResults = ref([])
const selectedPatientLabel = ref('')
let patientTimer = null
async function searchPatients() {
  clearTimeout(patientTimer)
  form.patientId = ''; form.clientId = ''
  selectedPatientLabel.value = ''
  if (patientSearch.value.length < 2) { patientResults.value = []; return }
  patientTimer = setTimeout(async () => {
    try {
      const { data } = await patientsApi.list({ search: patientSearch.value, limit: 8 })
      patientResults.value = asArray(data?.data || data?.patients || data).map(normalizePatient).filter(Boolean)
    } catch (error) { logError('grooming.searchPatients', error, { search: patientSearch.value }); patientResults.value = [] }
  }, 300)
}
function selectPatient(pt) {
  form.patientId = pt.id
  form.clientId  = pt.owner_id || ''
  selectedPatientLabel.value = `${pt.name} (${pt.primary_owner || ''})`
  patientSearch.value = pt.name
  patientResults.value = []
}

const showModal = ref(false)
const saving    = ref(false)
const saveError = ref('')
const fe        = reactive({})
// form usa serviceTypeId objects: { serviceTypeId, priceCharged }
const form = reactive({
  scheduledAt:'', patientId:'', clientId:'', groomerId:'', selectedServiceIds:[], price:'', notes:'',
  estimatedDurationMinutes:null, pickupRequired:false, pickupAddress:'', deliveryRequired:false, deliveryAddress:''
})

function openModal()  {
  resetForm()
  patientSearch.value = ''; patientResults.value = []; selectedPatientLabel.value = ''
  showModal.value = true
}
function closeModal() { showModal.value = false; resetForm() }
function resetForm() {
  form.scheduledAt = ''; form.patientId = ''; form.clientId = ''; form.groomerId = ''
  form.selectedServiceIds = []; form.price = ''; form.notes = ''
  form.estimatedDurationMinutes = null; form.pickupRequired = false; form.pickupAddress = ''; form.deliveryRequired = false; form.deliveryAddress = ''
  saveError.value = ''; Object.keys(fe).forEach(k => delete fe[k])
}

function validate() {
  Object.keys(fe).forEach(k => delete fe[k])
  if (!form.scheduledAt)              fe.scheduledAt = t('common.required')
  if (!form.patientId)                fe.patientId   = t('common.required')
  if (!form.groomerId)                fe.groomerId   = t('common.required')
  if (!form.clientId)                 fe.patientId   = `${fe.patientId || ''} ${t('grooming.petMustHaveOwner')}`.trim()
  if (!form.selectedServiceIds.length) fe.services   = t('grooming.selectAtLeastOneService')
  return Object.keys(fe).length === 0
}

async function handleCreate() {
  if (!validate()) return
  saving.value = true; saveError.value = ''
  try {
    const services = form.selectedServiceIds.map(id => ({ serviceTypeId: id }))
    const payload = {
      scheduledAt: form.scheduledAt,
      patientId:   parseInt(form.patientId, 10),
      clientId:    parseInt(form.clientId, 10),
      groomerId:   parseInt(form.groomerId, 10),
      services,
    }
    if (form.price) payload.estimatedPrice = parseFloat(form.price)
    if (form.estimatedDurationMinutes) payload.estimatedDurationMinutes = parseInt(form.estimatedDurationMinutes, 10)
    if (form.pickupRequired) payload.pickupRequired = true
    if (form.pickupAddress) payload.pickupAddress = form.pickupAddress
    if (form.deliveryRequired) payload.deliveryRequired = true
    if (form.deliveryAddress) payload.deliveryAddress = form.deliveryAddress
    if (form.notes) payload.notes          = form.notes
    await groomingApi.appointments.create(payload)
    closeModal(); await load()
  } catch (e) {
    saveError.value = extractDetailedErrorMessage(e, t('grooming.createError'), { context: 'Creación de sesión de grooming' })
  } finally { saving.value = false }
}

// Registro de resultado (grooming_records)
const showRecordModal  = ref(false)
const recordApptId     = ref(null)
const recordSaving     = ref(false)
const recordError      = ref('')
const recordForm = reactive({
  servicesPerformed: [],
  productsUsed:      '',
  behaviorObservations: '',
  coatCondition:     '',
  skinCondition:     '',
  vetReferralRequired: false,
  vetReferralReason: '',
  finalPrice:        '',
  groomingNotes:     '',
})

function openRecordModal(appt) {
  recordApptId.value = appt.id
  Object.assign(recordForm, {
    servicesPerformed: [], productsUsed: '', behaviorObservations: '',
    coatCondition: '', skinCondition: '', vetReferralRequired: false,
    vetReferralReason: '', finalPrice: appt.final_price || '', groomingNotes: '',
  })
  recordError.value = ''
  showRecordModal.value = true
}

async function handleRecord() {
  if (!recordForm.servicesPerformed.length) { recordError.value = t('grooming.indicateServicesPerformed'); return }
  recordSaving.value = true; recordError.value = ''
  try {
    const payload = {
      servicesPerformed:    recordForm.servicesPerformed,
      behaviorObservations: recordForm.behaviorObservations || undefined,
      coatCondition:        recordForm.coatCondition        || undefined,
      skinCondition:        recordForm.skinCondition        || undefined,
      vetReferralRequired:  recordForm.vetReferralRequired,
      vetReferralReason:    recordForm.vetReferralReason    || undefined,
      groomingNotes:        recordForm.groomingNotes        || undefined,
    }
    if (recordForm.finalPrice)  payload.finalPrice  = parseFloat(recordForm.finalPrice)
    if (recordForm.productsUsed) payload.productsUsed = recordForm.productsUsed.split(',').map(s => s.trim()).filter(Boolean)
    await groomingApi.appointments.record(recordApptId.value, payload)
    showRecordModal.value = false
    await load()
  } catch (e) {
    recordError.value = extractDetailedErrorMessage(e, t('grooming.saveRecordError'), { context: 'Registro de grooming' })
  } finally { recordSaving.value = false }
}

onMounted(() => { load(); loadGroomers(); loadServiceTypes() })
onUnmounted(() => { clearTimeout(timer); clearTimeout(patientTimer) })
</script>

<style scoped>
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
.page { display: flex; flex-direction: column; gap: 20px; }
.page-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
.page-header__left { display: flex; align-items: center; gap: 14px; }
.page-emoji { font-size: 2rem; }
.page-title { font-size: 1.35rem; font-weight: 700; color: var(--text); }
.page-sub   { font-size: 0.82rem; color: var(--text-2); margin-top: 2px; }

.kpi-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px; }
.kpi { background: var(--c); border-radius: var(--radius-lg); padding: 14px 16px; display: flex; align-items: center; gap: 10px; font-size: 1.5rem; }
.kpi strong { display: block; font-size: 1.3rem; font-weight: 700; color: var(--ct); }
.kpi span:last-child { font-size: 0.72rem; color: var(--ct); opacity: 0.75; }

.filters { display: flex; gap: 10px; flex-wrap: wrap; }
.filter-input, .filter-select { padding: 9px 13px; border: 1.5px solid var(--border); border-radius: var(--radius); font-size: 0.87rem; background: var(--white); color: var(--text); outline: none; }
.filter-input:focus, .filter-select:focus { border-color: var(--primary); }
.filter-input--grow { flex: 1; min-width: 180px; }

/* Grooming grid */
.groom-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }
.groom-card { background: var(--white); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); overflow: hidden; transition: box-shadow var(--transition), transform var(--transition); }
.groom-card:hover { box-shadow: var(--shadow); transform: translateY(-2px); }

.groom-card__header { padding: 10px 14px; border-bottom: 1px solid var(--border); }
.header--scheduled   { background: #D6EEFF; }
.header--in_progress { background: #FFF3CC; }
.header--completed   { background: #D6F3EC; }
.header--cancelled   { background: #FDEAEA; }

.groom-card__time { display: flex; align-items: center; justify-content: space-between; }
.groom-card__hour { font-size: 1.1rem; font-weight: 700; color: var(--text); }

.groom-card__body { padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
.groom-card__pet { display: flex; align-items: center; gap: 10px; }
.groom-emoji { font-size: 2rem; }
.groom-card__pet strong { display: block; font-size: 0.95rem; color: var(--text); }
.sub { display: block; font-size: 0.75rem; color: var(--text-3); }

.groom-card__services { display: flex; flex-wrap: wrap; gap: 4px; }
.svc-chip { background: #FFE4D6; color: #c0392b; padding: 2px 8px; border-radius: 6px; font-size: 0.72rem; font-weight: 600; }

.groom-card__row { display: flex; align-items: center; gap: 6px; font-size: 0.82rem; color: var(--text-2); }
.notes-text { font-size: 0.8rem; color: var(--text-3); }

.groom-card__actions { padding: 10px 14px; display: flex; gap: 6px; border-top: 1px solid var(--border); background: var(--surface); }

/* Badges */
.badge { display: inline-block; padding: 3px 9px; border-radius: 20px; font-size: 0.72rem; font-weight: 600; }
.status--scheduled   { background: #D6EEFF; color: #1A5FAA; }
.status--in_progress { background: #FFF3CC; color: #8A6200; }
.status--completed   { background: #D6F3EC; color: #1A9E7F; }
.status--cancelled   { background: #FDEAEA; color: #c0392b; }

.btn-xs { padding: 4px 10px; border: none; border-radius: 6px; font-size: 0.75rem; font-weight: 600; cursor: pointer; transition: opacity var(--transition); }
.btn-xs:hover { opacity: 0.8; }
.btn-xs--green  { background: #D6F3EC; color: #1A9E7F; }
.btn-xs--yellow { background: #FFF3CC; color: #8A6200; }
.btn-xs--red    { background: #FDEAEA; color: #c0392b; }

.btn-primary { padding: 10px 20px; background: linear-gradient(135deg, var(--primary) 0%, var(--accent-mint) 100%); color: white; border: none; border-radius: var(--radius); font-size: 0.9rem; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: opacity var(--transition), transform var(--transition); }
.btn-primary:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
.btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
.btn-ghost { padding: 10px 20px; background: none; border: 1.5px solid var(--border); border-radius: var(--radius); color: var(--text-2); font-size: 0.9rem; font-weight: 500; cursor: pointer; transition: background var(--transition); }
.btn-ghost:hover:not(:disabled) { background: var(--surface-2); }

.modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 16px; }
.modal { background: var(--white); border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); width: 100%; max-width: 540px; max-height: 92vh; overflow-y: auto; }
.modal__header { display: flex; align-items: center; justify-content: space-between; padding: 20px 24px 16px; border-bottom: 1px solid var(--border); }
.modal__header h3 { font-size: 1.1rem; font-weight: 700; color: var(--text); }
.modal__close { background: none; border: none; cursor: pointer; font-size: 1rem; color: var(--text-3); padding: 4px 8px; border-radius: var(--radius-sm); }
.modal__close:hover { background: var(--surface-2); }
.form-body { padding: 20px 24px 0; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.field { display: flex; flex-direction: column; gap: 5px; }
.field label { font-size: 0.82rem; font-weight: 600; color: var(--text-2); }
.field input, .field select, .field textarea { padding: 9px 12px; border: 1.5px solid var(--border); border-radius: var(--radius); font-size: 0.9rem; color: var(--text); background: var(--surface); outline: none; transition: border-color var(--transition); }
.field input:focus, .field select:focus, .field textarea:focus { border-color: var(--primary); }
.field textarea { resize: vertical; }
.field--full { grid-column: 1 / -1; }
.field-error { font-size: 0.75rem; color: var(--danger); }
.req { color: var(--danger); }

.services-check { display: flex; flex-wrap: wrap; gap: 8px; }
.check-item { display: flex; align-items: center; gap: 5px; font-size: 0.82rem; color: var(--text-2); cursor: pointer; }
.check-item input { accent-color: var(--primary); }

.modal__actions { display: flex; gap: 12px; justify-content: flex-end; padding: 16px 24px 24px; }
.alert { padding: 10px 14px; border-radius: var(--radius-sm); font-size: 0.875rem; }
.alert--error { background: #FDEAEA; color: #c0392b; border-left: 3px solid var(--danger); }
.mx { margin: 0 24px 8px; }
.loading-state, .empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 60px 20px; color: var(--text-3); font-size: 0.9rem; background: var(--white); border-radius: var(--radius-xl); box-shadow: var(--shadow-sm); }
.empty-state__emoji { font-size: 3rem; }
.spin { width: 20px; height: 20px; border: 2px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: spin 0.7s linear infinite; display: inline-block; }
.spin--sm { width: 14px; height: 14px; }
.spin--dark { border-color: rgba(0,0,0,0.1); border-top-color: var(--primary); }
@keyframes spin { to { transform: rotate(360deg); } }
.modal-enter-active, .modal-leave-active { transition: opacity 0.2s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
@media (max-width: 600px) { .form-grid { grid-template-columns: 1fr; } }
.autocomplete { position: absolute; z-index: 100; background: var(--white); border: 1.5px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); width: 100%; max-height: 200px; overflow-y: auto; }
.autocomplete__item { padding: 9px 13px; cursor: pointer; font-size: 0.88rem; }
.autocomplete__item:hover { background: var(--surface-2); }
.autocomplete__owner { font-size: 0.78rem; color: var(--text-3); }
.selected-patient { margin-top: 6px; font-size: 0.82rem; color: var(--primary); font-weight: 500; }
.field { position: relative; }
</style>
