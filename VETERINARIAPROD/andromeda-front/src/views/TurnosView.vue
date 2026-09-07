<template>
  <div class="page">

    <!-- Encabezado -->
    <div class="page-header">
      <div class="page-header__left">
        <span class="page-emoji">&#x1F43E;</span>
        <div>
          <h2 class="page-title">{{ t('appointments.title') }}</h2>
          <p class="page-sub">{{ t('appointments.subtitle') }}</p>
        </div>
      </div>
      <button type="button" class="btn-primary" @click="openModal()">&#x1F43E; {{ t('appointments.newAppointment') }}</button>
    </div>

    <!-- Filtros -->
    <div class="filters">
      <label for="filter-date" class="sr-only">{{ t('appointments.dateTimeLabel') }}</label>
      <input id="filter-date" name="filter-date" v-model="filters.date" type="date" class="filter-input" @change="load()" />
      <label for="filter-status" class="sr-only">{{ t('common.allStatuses') }}</label>
      <select id="filter-status" name="filter-status" v-model="filters.status" class="filter-select" @change="load()">
        <option value="">{{ t('common.allStatuses') }}</option>
        <option v-for="(label, val) in STATUS_LABELS" :key="val" :value="val">{{ label }}</option>
      </select>
      <label for="filter-search" class="sr-only">{{ t('appointments.searchPlaceholder') }}</label>
      <input id="filter-search" name="filter-search" v-model.trim="filters.search" type="search" :placeholder="t('appointments.searchPlaceholder')" class="filter-input filter-input--grow" @input="debouncedLoad()" />
    </div>

    <!-- Tarjetas de turnos -->
    <div v-if="loading" class="loading-state" role="status" aria-live="polite">
      <span class="spin" /> {{ t('appointments.loading') }}
    </div>

    <div v-else-if="error" class="alert alert--error" role="alert">{{ error }}</div>

    <div v-else-if="items.length === 0" class="empty-state">
      <span class="empty-state__emoji">&#x1F43E;</span>
      <p>{{ t('appointments.empty') }}</p>
      <button type="button" class="btn-ghost" @click="openModal()">{{ t('appointments.scheduleFirst') }}</button>
    </div>

    <div v-else class="appt-grid">
      <div
        v-for="a in items"
        :key="a.id"
        class="appt-card"
        :class="`appt-card--${a.status}`"
      >
        <div class="appt-card__time">
          <span class="appt-card__hour">{{ formatTime(a.scheduled_date) }}</span>
          <span class="badge" :class="`status--${a.status}`">{{ STATUS_LABELS[a.status] || a.status }}</span>
        </div>
        <div class="appt-card__body">
          <div class="appt-card__patient">
            <span class="appt-card__pet-emoji">{{ petEmoji(a.species) }}</span>
            <div>
              <strong>{{ a.patient_name || a.patient?.name || '—' }}</strong>
              <span class="appt-card__owner">{{ a.owner_name || a.owner?.full_name || '' }}</span>
            </div>
          </div>
          <p class="appt-card__reason">{{ a.reason || a.appointment_type || 'Consulta general' }}</p>
          <div class="appt-card__meta-chips">
            <span v-if="a.duration_minutes" class="vital-chip">&#x2713; {{ a.duration_minutes }} min</span>
            <span v-if="a.is_emergency" class="vital-chip vital-chip--danger">&#x1F43E; Emergencia</span>
            <span v-if="a.record_status" class="vital-chip">&#x1F43E; {{ a.record_status }}</span>
          </div>
          <p v-if="a.owner_phone" class="appt-card__vet">&#x1F43E; {{ a.owner_phone }}</p>
          <p v-if="a.vet_name" class="appt-card__vet">&#x1F43E; {{ a.vet_name }}</p>
          <p v-if="a.notes" class="appt-card__notes">{{ a.notes }}</p>
        </div>
        <div class="appt-card__actions">
          <button type="button"
            v-if="a.status === 'scheduled' || a.status === 'confirmed'"
            class="btn-xs btn-xs--green"
            @click="updateStatus(a, 'in_progress')"
          >{{ t('appointments.inProgress') }}</button>
          <button type="button"
            v-if="a.status === 'in_progress'"
            class="btn-xs btn-xs--blue"
            @click="updateStatus(a, 'completed')"
          >{{ t('appointments.complete') }}</button>
          <button type="button"
            v-if="a.status !== 'cancelled' && a.status !== 'completed'"
            class="btn-xs btn-xs--red"
            @click="updateStatus(a, 'cancelled')"
          >{{ t('appointments.cancel') }}</button>
        </div>
      </div>
    </div>

    <!-- Modal nuevo turno -->
    <Transition name="modal">
      <div v-if="showModal" class="modal-backdrop" @click.self="closeModal()">
        <div class="modal">
          <div class="modal__header">
            <h3>&#x1F43E; {{ t('appointments.newAppointment') }}</h3>
            <button type="button" class="modal__close" @click="closeModal()">&times;</button>
          </div>
          <form @submit.prevent="handleCreate" novalidate>
            <div class="form-grid">
              <div class="field">
                <label for="appt-date">{{ t('appointments.dateTimeLabel') }} <span class="req">*</span></label>
                <input id="appt-date" name="appt-date" v-model="form.scheduledDate" type="datetime-local" :disabled="saving" required />
                <span v-if="fe.scheduledDate" class="field-error">{{ fe.scheduledDate }}</span>
              </div>
              <div class="field">
                <label for="appt-type">{{ t('appointments.typeLabel') }} <span class="req">*</span></label>
                <select id="appt-type" name="appt-type" v-model="form.appointmentTypeId" :disabled="saving" required>
                  <option value="">{{ t('common.choose') }}</option>
                  <option v-for="t in typeList" :key="t.id" :value="t.id">{{ t.name }}</option>
                </select>
                <span v-if="fe.appointmentTypeId" class="field-error">{{ fe.appointmentTypeId }}</span>
              </div>
              <div class="field field--full">
                <label for="appt-vet">{{ t('appointments.vetLabel') }} <span class="req">*</span></label>
                <select id="appt-vet" name="appt-vet" v-model="form.vetId" :disabled="saving" required>
                  <option value="">{{ t('appointments.selectVet') }}</option>
                  <option v-for="v in vetList" :key="v.id" :value="v.id">
                    {{ v.first_name }} {{ v.last_name }}
                  </option>
                </select>
                <span v-if="fe.vetId" class="field-error">{{ fe.vetId }}</span>
              </div>
              <div class="field field--full">
                <label for="appt-patient">{{ t('appointments.patientLabel') }} <span class="req">*</span></label>
                <input
                  id="appt-patient"
                  name="appt-patient"
                  v-model.trim="patientSearch"
                  type="search"
                  :placeholder="t('appointments.patientSearchPlaceholder')"
                  :disabled="saving"
                  @input="searchPatients"
                  autocomplete="off"
                />
                <div v-if="patientResults.length" class="autocomplete" role="listbox" :aria-label="t('common.searchResults')">
                  <button
                    v-for="pt in patientResults"
                    :key="pt.id"
                    type="button"
                    class="autocomplete__item"
                    role="option"
                    :aria-label="`Seleccionar ${pt.name}`"
                    @click="selectPatient(pt)"
                  >
                    {{ petEmoji(pt.species) }} <b>{{ pt.name }}</b>
                    <span class="autocomplete__owner">— {{ pt.primary_owner || pt.owner_name }}</span>
                  </button>
                </div>
                <div v-if="form.patientId" class="selected-patient">
                  ? {{ selectedPatientLabel }}
                </div>
                <span v-if="fe.patientId" class="field-error">{{ fe.patientId }}</span>
              </div>
              <div class="field field--full">
                <label for="appt-reason">{{ t('appointments.reasonLabel') }}</label>
                <textarea id="appt-reason" name="appt-reason" v-model.trim="form.reason" rows="2" :placeholder="t('appointments.reasonPlaceholder')" :disabled="saving" />
              </div>
              <div class="field">
                <label for="appt-duration">Duración (min)</label>
                <input id="appt-duration" name="appt-duration" v-model.number="form.duration" type="number" min="5" step="5" :disabled="saving" />
              </div>
              <label class="checkbox-label field--full">
                <input id="appt-emergency" name="appt-emergency" v-model="form.isEmergency" type="checkbox" :disabled="saving" />
                Marcar como emergencia
              </label>
              <div class="field field--full">
                <label for="appt-notes">Notas internas</label>
                <textarea id="appt-notes" name="appt-notes" v-model.trim="form.notes" rows="2" placeholder="Indicaciones, contexto clínico, observaciones" :disabled="saving" />
              </div>
            </div>
            <div v-if="saveError" class="alert alert--error" role="alert">{{ saveError }}</div>
            <div class="modal__actions">
              <button type="button" class="btn-ghost" @click="closeModal()" :disabled="saving">{{ t('common.cancel') }}</button>
              <button type="submit" class="btn-primary" :disabled="saving">
                <span v-if="saving" class="spin spin--sm" /> <span v-else>{{ t('appointments.save') }}</span>
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
import { useAuthStore } from '../stores/auth'
import { appointmentsApi, patientsApi } from '../api'
import { adminUsersApi } from '../api/adminUsers'
import { t } from '../i18n'
import { extractDetailedErrorMessage, logError } from '../utils/errors'
import { useUiFeedback } from '../composables/useUiFeedback'

const auth = useAuthStore()
const { notifyError, success } = useUiFeedback()
const items   = ref([])
const loading = ref(false)
const error   = ref('')

function asArray(value) {
  return Array.isArray(value) ? value : []
}

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

function normalizeAppointment(row) {
  if (!row || typeof row !== 'object') return null
  return {
    ...row,
    species: row.species || row.species_name || row.speciesName || '',
    patient_name: row.patient_name || row.patient?.name || row.patientName || '',
    owner_name: row.owner_name || row.owner?.full_name || row.ownerName || '',
    owner_phone: row.owner_phone || row.ownerPhone || '',
    reason: row.reason || row.appointment_type || row.appointmentType || '',
    appointment_type: row.appointment_type || row.appointmentType || '',
    vet_name: row.vet_name || row.veterinarian_name || row.vetName || '',
    scheduled_date: row.scheduled_date || row.scheduledDate || '',
    duration_minutes: row.duration_minutes ?? row.durationMinutes ?? null,
    is_emergency: row.is_emergency ?? row.isEmergency ?? false,
    notes: row.notes || '',
    medical_record_id: row.medical_record_id ?? row.medicalRecordId ?? null,
    record_status: row.record_status ?? row.recordStatus ?? '',
    status: row.status || 'scheduled',
  }
}

// -- Vets list -------------------------------------------------------------
const vetList = ref([])
async function loadVets() {
  try {
    const VET_ROLES = ['veterinarian','surgeon','vet_technician','tele_vet']
    const currentRoles = normalizeRoleList(auth.roles)
    const currentUser = auth.user || {}
    const isAdmin = currentRoles.includes('superadmin') || currentRoles.includes('org_admin')

    if (isAdmin) {
      const { data } = await adminUsersApi.list({ limit: 100 })
      vetList.value = asArray(data?.data).filter(u =>
        normalizeRoleList(u.roles).some(r => VET_ROLES.includes(r))
      )
      return
    }

    if (VET_ROLES.some(r => currentRoles.includes(r))) {
      vetList.value = [{
        id: currentUser.id || currentUser.userId || null,
        first_name: currentUser.first_name || currentUser.name || currentUser.email || 'Yo',
        last_name: '',
        roles: currentRoles,
      }]
      return
    }

    vetList.value = []
  } catch (error) { logError('turnos.loadVets', error); vetList.value = [] }
}

// -- Appointment types -----------------------------------------------------
const typeList = ref([])
async function loadTypes() {
  try {
    const { data } = await appointmentsApi.types()
    typeList.value = asArray(data?.data || data)
  } catch (error) { logError('turnos.loadTypes', error); typeList.value = [] }
}

const filters = reactive({
  date:   new Date().toISOString().split('T')[0],
  status: '',
  search: '',
})

const STATUS_LABELS = {
  scheduled:   'Programado',
  confirmed:   'Confirmado',
  in_progress: 'En curso',
  completed:   'Completado',
  cancelled:   'Cancelado',
  no_show:     'Ausente',
}

function petEmoji(species) {
  const map = { dog: '\u{1F43E}', cat: '\u{1F43E}', rabbit: '\u{1F43E}', bird: '\u{1F43E}', fish: '\u{1F43E}', reptile: '\u{1F43E}', hamster: '\u{1F43E}' }
  return map[species?.toLowerCase()] || '\u{1F43E}'
}

function formatTime(dt) {
  if (!dt) return '—'
  return new Date(dt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const params = { limit: 50 }
    if (filters.date)   params.date   = filters.date
    if (filters.status) params.status = filters.status
    const { data } = await appointmentsApi.list(params)
    const rows = asArray(data?.data || data?.appointments || data).map(normalizeAppointment).filter(Boolean)
    const needle = filters.search.trim().toLowerCase()
    items.value = needle
      ? rows.filter((row) => [row.patient_name, row.owner_name, row.reason, row.appointment_type]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle)))
      : rows
  } catch (e) {
    logError('turnos.load', e)
    error.value = extractDetailedErrorMessage(e, 'No se pudieron cargar los turnos', { context: 'Carga de turnos' })
  } finally {
    loading.value = false
  }
}

let debounceTimer = null
function debouncedLoad() {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(load, 350)
}

async function updateStatus(appt, status) {
  try {
    await appointmentsApi.changeStatus(appt.id, status)
    appt.status = status
    success('Turno actualizado correctamente.')
  } catch (e) {
    notifyError('turnos.updateStatus', e, 'No se pudo actualizar el turno', { context: 'Actualización de turno' })
  }
}

// -- Modal ------------------------------------------------------------------
const showModal = ref(false)
const saving    = ref(false)
const saveError = ref('')
const fe        = reactive({})

const form = reactive({
  scheduledDate:     '',
  appointmentTypeId: '',
  patientId:         '',
  clientId:          '',
  reason:            '',
  notes:             '',
  vetId:             '',
  duration:          30,
  isEmergency:       false,
})

// Patient autocomplete
const patientSearch       = ref('')
const patientResults      = ref([])
const selectedPatientLabel = ref('')

let patientTimer = null
async function searchPatients() {
  clearTimeout(patientTimer)
  form.patientId = ''
  selectedPatientLabel.value = ''
  if (patientSearch.value.length < 2) { patientResults.value = []; return }
  patientTimer = setTimeout(async () => {
    try {
      const { data } = await patientsApi.list({ search: patientSearch.value, limit: 8 })
      patientResults.value = asArray(data?.data || data).map((row) => ({
        ...row,
        species: row.species || row.species_name || row.speciesName || '',
        primary_owner: row.primary_owner || row.owner_name || row.ownerName || '',
        owner_name: row.owner_name || row.primary_owner || row.ownerName || '',
      })).filter(Boolean)
    } catch (error) { logError('turnos.searchPatients', error, { search: patientSearch.value }); patientResults.value = [] }
  }, 300)
}

function selectPatient(pt) {
  form.patientId = pt.id
  form.clientId  = pt.owner_id || ''
  selectedPatientLabel.value = `${pt.name} (${pt.primary_owner || pt.owner_name || ''})`
  patientSearch.value = pt.name
  patientResults.value = []
}

function openModal() { resetForm(); showModal.value = true }
function closeModal() { showModal.value = false; resetForm() }

function resetForm() {
  form.scheduledDate = ''
  form.appointmentTypeId = ''
  form.patientId = ''
  form.clientId = ''
  form.reason = ''
  form.notes = ''
  form.vetId = ''
  form.duration = 30
  form.isEmergency = false
  patientSearch.value = ''
  patientResults.value = []
  selectedPatientLabel.value = ''
  saveError.value = ''
  Object.keys(fe).forEach(k => delete fe[k])
}

function validate() {
  Object.keys(fe).forEach(k => delete fe[k])
  if (!form.scheduledDate)     fe.scheduledDate     = 'Requerido'
  if (!form.appointmentTypeId) fe.appointmentTypeId = 'Requerido'
  if (!form.vetId)             fe.vetId             = 'Requerido'
  if (!form.patientId)         fe.patientId         = 'Requerido'
  return Object.keys(fe).length === 0
}

async function handleCreate() {
  if (!validate()) return
  saving.value = true
  saveError.value = ''
  try {
    const payload = {
      scheduledDate:     form.scheduledDate ? new Date(form.scheduledDate).toISOString() : form.scheduledDate,
      patientId:         parseInt(form.patientId, 10),
      vetId:             parseInt(form.vetId, 10),
      appointmentTypeId: parseInt(form.appointmentTypeId, 10),
      durationMinutes:   form.duration || 30,
    }
    if (form.clientId)  payload.clientId = parseInt(form.clientId, 10)
    if (form.reason)    payload.reason   = form.reason
    if (form.notes)     payload.notes    = form.notes
    if (form.isEmergency) payload.isEmergency = true
    await appointmentsApi.create(payload)
    closeModal()
    await load()
  } catch (e) {
    saveError.value = extractDetailedErrorMessage(e, 'No se pudo guardar el turno', { context: 'Guardado de turno' })
  } finally {
    saving.value = false
  }
}

onMounted(() => { load(); loadVets(); loadTypes() })
onUnmounted(() => {
  clearTimeout(debounceTimer)
  clearTimeout(patientTimer)
})
</script>

<style scoped>
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
.page { display: flex; flex-direction: column; gap: 20px; }

.page-header {
  display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;
}
.page-header__left { display: flex; align-items: center; gap: 14px; }
.page-emoji { font-size: 2rem; }
.page-title { font-size: 1.35rem; font-weight: 700; color: var(--text); }
.page-sub   { font-size: 0.82rem; color: var(--text-2); margin-top: 2px; }

/* Filtros */
.filters { display: flex; gap: 10px; flex-wrap: wrap; }
.filter-input, .filter-select {
  padding: 9px 13px;
  border: 1.5px solid var(--border);
  border-radius: var(--radius);
  font-size: 0.87rem;
  background: var(--white);
  color: var(--text);
  outline: none;
  transition: border-color var(--transition);
}
.filter-input:focus, .filter-select:focus { border-color: var(--primary); }
.filter-input--grow { flex: 1; min-width: 180px; }

/* Grid de turnos */
.appt-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
}

.appt-card {
  background: var(--white);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
  border-left: 4px solid var(--border);
  transition: box-shadow var(--transition), transform var(--transition);
}
.appt-card:hover { box-shadow: var(--shadow); transform: translateY(-2px); }
.appt-card--scheduled   { border-left-color: #90D5F0; }
.appt-card--confirmed   { border-left-color: #06D6A0; }
.appt-card--in_progress { border-left-color: #FFB703; }
.appt-card--completed   { border-left-color: #1A9E7F; }
.appt-card--cancelled   { border-left-color: #EF5350; }
.appt-card--no_show     { border-left-color: var(--text-3); }

.appt-card__time {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px 8px;
  border-bottom: 1px solid var(--border);
}
.appt-card__hour { font-size: 1.1rem; font-weight: 700; color: var(--primary); }

.appt-card__body { padding: 12px 14px; }
.appt-card__patient { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.appt-card__pet-emoji { font-size: 1.6rem; }
.appt-card__patient strong { display: block; font-size: 0.95rem; color: var(--text); }
.appt-card__owner { display: block; font-size: 0.78rem; color: var(--text-3); }
.appt-card__reason { font-size: 0.82rem; color: var(--text-2); margin-top: 4px; }
.appt-card__vet    { font-size: 0.78rem; color: var(--text-3); margin-top: 4px; }

.appt-card__actions {
  padding: 10px 14px;
  display: flex; gap: 6px; flex-wrap: wrap;
  border-top: 1px solid var(--border);
  background: var(--surface);
}

/* Badges */
.badge { display: inline-block; padding: 3px 9px; border-radius: 20px; font-size: 0.72rem; font-weight: 600; }
.status--scheduled   { background: #D6EEFF; color: #2980b9; }
.status--confirmed   { background: #D6F3EC; color: #1A9E7F; }
.status--in_progress { background: #FFF3CC; color: #d68910; }
.status--completed   { background: #EAFAF1; color: #1e8449; }
.status--cancelled   { background: #FDEAEA; color: #c0392b; }
.status--no_show     { background: var(--surface-2); color: var(--text-3); }

/* Botones xs */
.btn-xs {
  padding: 4px 10px; border: none; border-radius: 6px;
  font-size: 0.75rem; font-weight: 600; cursor: pointer;
  transition: opacity var(--transition);
}
.btn-xs:hover { opacity: 0.8; }
.btn-xs--green { background: #D6F3EC; color: #1A9E7F; }
.btn-xs--blue  { background: #D6EEFF; color: #2980b9; }
.btn-xs--red   { background: #FDEAEA; color: #c0392b; }

/* Autocomplete */
.autocomplete {
  position: absolute; background: var(--white); border: 1.5px solid var(--border);
  border-radius: var(--radius); box-shadow: var(--shadow); z-index: 10;
  max-height: 200px; overflow-y: auto; width: 100%; margin-top: 2px;
}
.autocomplete__item {
  padding: 9px 12px; cursor: pointer; font-size: 0.87rem; color: var(--text);
  transition: background var(--transition);
}
.autocomplete__item:hover { background: var(--surface-2); }
.autocomplete__owner { font-size: 0.78rem; color: var(--text-3); }
.selected-patient { font-size: 0.8rem; color: var(--primary); margin-top: 4px; }
.field { position: relative; }

/* Form */
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; padding: 20px 24px 0; }
.field { display: flex; flex-direction: column; gap: 5px; }
.field label { font-size: 0.82rem; font-weight: 600; color: var(--text-2); }
.field input, .field select, .field textarea {
  padding: 9px 12px; border: 1.5px solid var(--border); border-radius: var(--radius);
  font-size: 0.9rem; color: var(--text); background: var(--surface); outline: none;
  transition: border-color var(--transition);
}
.field input:focus, .field select:focus, .field textarea:focus { border-color: var(--primary); }
.field textarea { resize: vertical; }
.field--full { grid-column: 1 / -1; }
.field-error { font-size: 0.75rem; color: var(--danger); }
.req { color: var(--danger); }

/* Buttons */
.btn-primary {
  padding: 10px 20px;
  background: linear-gradient(135deg, var(--primary) 0%, var(--accent-mint) 100%);
  color: white; border: none; border-radius: var(--radius);
  font-size: 0.9rem; font-weight: 600; cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px;
  transition: opacity var(--transition), transform var(--transition);
}
.btn-primary:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
.btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }

.btn-ghost {
  padding: 10px 20px; background: none; border: 1.5px solid var(--border);
  border-radius: var(--radius); color: var(--text-2); font-size: 0.9rem;
  font-weight: 500; cursor: pointer; transition: background var(--transition);
}
.btn-ghost:hover:not(:disabled) { background: var(--surface-2); }

/* Modal */
.modal-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,0.4);
  display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 16px;
}
.modal {
  background: var(--white); border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg); width: 100%; max-width: 540px; max-height: 90vh; overflow-y: auto;
}
.modal__header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 20px 24px 16px; border-bottom: 1px solid var(--border);
}
.modal__header h3 { font-size: 1.1rem; font-weight: 700; color: var(--text); }
.modal__close {
  background: none; border: none; cursor: pointer; font-size: 1rem;
  color: var(--text-3); padding: 4px 8px; border-radius: var(--radius-sm);
}
.modal__close:hover { background: var(--surface-2); }
.modal__actions {
  display: flex; gap: 12px; justify-content: flex-end;
  padding: 16px 24px 24px;
}

/* Alerts */
.alert { padding: 10px 14px; border-radius: var(--radius-sm); font-size: 0.875rem; margin: 0 24px 8px; }
.alert--error { background: #FDEAEA; color: #c0392b; border-left: 3px solid var(--danger); }

/* States */
.loading-state, .empty-state {
  display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 12px; padding: 60px 20px;
  color: var(--text-3); font-size: 0.9rem;
  background: var(--white); border-radius: var(--radius-xl); box-shadow: var(--shadow-sm);
}
.empty-state__emoji { font-size: 3rem; }

/* Spinner */
.spin {
  width: 20px; height: 20px; border: 2px solid rgba(255,255,255,0.3);
  border-top-color: white; border-radius: 50%; animation: spin 0.7s linear infinite; display: inline-block;
}
.spin--sm { width: 14px; height: 14px; }
@keyframes spin { to { transform: rotate(360deg); } }

/* Modal transition */
.modal-enter-active, .modal-leave-active { transition: opacity 0.2s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }

@media (max-width: 600px) {
  .form-grid { grid-template-columns: 1fr; }
}
</style>
