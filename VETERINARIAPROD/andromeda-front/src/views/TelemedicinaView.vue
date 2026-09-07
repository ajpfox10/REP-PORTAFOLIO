<template>
  <div class="page">

    <div class="page-header">
      <div class="page-header__left">
        <span class="page-emoji">💻</span>
        <div>
          <h2 class="page-title">{{ t('telemedicine.title') }}</h2>
          <p class="page-sub">{{ t('telemedicine.subtitle') }}</p>
        </div>
      </div>
      <button type="button" class="btn-primary" @click="openModal()">{{ t('telemedicine.newSession') }}</button>
    </div>

    <!-- KPI Stats bar -->
    <div class="kpi-row">
      <div class="kpi" style="--c:#D6EEFF;--ct:#1A5FAA">
        <span>💻</span>
        <div>
          <strong>{{ statsData.total }}</strong>
          <span>{{ t('telemedicine.totalSessions') }}</span>
        </div>
      </div>
      <div class="kpi" style="--c:#D6F3EC;--ct:#1A9E7F">
        <span>✅</span>
        <div>
          <strong>{{ statsData.completed }}</strong>
          <span>{{ t('telemedicine.completed') }}</span>
        </div>
      </div>
      <div class="kpi" style="--c:#FFF3CC;--ct:#8A6200">
        <span>⏱️</span>
        <div>
          <strong>{{ statsData.avgDuration }} min</strong>
          <span>Duración promedio</span>
        </div>
      </div>
      <div class="kpi" style="--c:#F0E6FF;--ct:#6B21A8">
        <span>📅</span>
        <div>
          <strong>{{ statsData.today }}</strong>
          <span>{{ t('telemedicine.sessionsToday') }}</span>
        </div>
      </div>
    </div>

    <!-- Info banner -->
    <div class="info-banner">
      <span>🎥</span>
      <div>
        <strong>{{ t('telemedicine.infoTitle') }}</strong>
        <span>Los dueños reciben un enlace por email para unirse a la videollamada en el horario pactado.</span>
      </div>
    </div>

    <!-- Filtros -->
    <div class="filters">
      <label for="tele-date" class="sr-only">{{ t('telemedicine.scheduledAt') }}</label>
      <input id="tele-date" name="tele-date" v-model="dateFilter" type="date" class="filter-input" @change="load()" />
      <label for="tele-status" class="sr-only">{{ t('telemedicine.allStatuses') }}</label>
      <select id="tele-status" name="tele-status" v-model="statusFilter" class="filter-select" @change="load()">
        <option value="">{{ t('telemedicine.allStatuses') }}</option>
        <option value="scheduled">{{ t('telemedicine.statusScheduled') }}</option>
        <option value="in_progress">{{ t('telemedicine.statusInProgress') }}</option>
        <option value="completed">{{ t('telemedicine.statusCompleted') }}</option>
        <option value="cancelled">{{ t('telemedicine.statusCancelled') }}</option>
        <option value="no_show">{{ t('telemedicine.statusNoShow') }}</option>
      </select>
      <label for="tele-search" class="sr-only">Buscar paciente</label>
      <input id="tele-search" name="tele-search" v-model.trim="search" type="search" placeholder="🔍 Buscar paciente…" class="filter-input filter-input--grow" @input="debouncedLoad()" />
    </div>

    <div v-if="loading" class="loading-state"><span class="spin spin--dark" /> {{ t('telemedicine.loading') }}</div>
    <div v-else-if="error" class="alert alert--error">{{ error }}</div>
    <div v-else-if="items.length === 0" class="empty-state">
      <span class="empty-state__emoji">🐱</span>
      <p>{{ t('telemedicine.emptyState') }}</p>
      <button type="button" class="btn-ghost" @click="openModal()">{{ t('telemedicine.programConsultation') }}</button>
    </div>

    <div v-else class="tele-list">
      <div v-for="t in items" :key="t.id" :id="`tele-session-${t.id}`" class="tele-card">
        <div class="tele-card__left">
          <div class="tele-time" :id="`tele-session-${t.id}-time`">{{ formatTime(t.scheduled_date || t.start_time) }}</div>
          <span class="badge" :class="`status--${t.status}`" :id="`tele-session-${t.id}-status`">{{ STATUS[t.status] || t.status }}</span>
        </div>
        <div class="tele-card__mid">
          <div class="tele-pet">
            <span>{{ petEmoji(t.patient?.species) }}</span>
            <div>
              <strong :id="`tele-session-${t.id}-patient`">{{ t.patient?.name || t.patient_name || '—' }}</strong>
              <span class="sub" :id="`tele-session-${t.id}-owner`">{{ t.patient?.owner?.full_name || t.owner_name || '' }}</span>
            </div>
          </div>
          <p class="tele-reason" :id="`tele-session-${t.id}-reason`">{{ t.reason || t.chief_complaint || t('telemedicine.generalConsultation') }}</p>
          <p class="tele-vet" v-if="t.vet_name" :id="`tele-session-${t.id}-vet`">👨‍⚕️ {{ t.vet_name }}</p>
          <p class="tele-phone" v-if="t.client_phone" :id="`tele-session-${t.id}-phone`">📞 {{ t.client_phone }}</p>
        </div>
        <div class="tele-card__right">
          <button
            v-if="t.status === 'scheduled'"
            type="button"
            class="btn-join"
            @click="joinCall(t)"
          >
            🎥 Unirse
          </button>
          <button
            v-if="t.status === 'in_progress'"
            type="button"
            class="btn-xs btn-xs--green"
            @click="changeStatus(t, 'completed')"
          >{{ t('telemedicine.finish') }}</button>
          <button
            v-if="t.status !== 'completed' && t.status !== 'cancelled'"
            type="button"
            class="btn-xs btn-xs--red"
            @click="changeStatus(t, 'cancelled')"
          >{{ t('telemedicine.cancelSession') }}</button>
        </div>
      </div>
    </div>

    <!-- Paginación sesiones -->
    <div v-if="totalPages > 1" class="pagination">
      <button type="button" :disabled="page <= 1" @click="loadPage(page - 1)">{{ t('common.previous') }}</button>
      <span>{{ page }} / {{ totalPages }}</span>
      <button type="button" :disabled="page >= totalPages" @click="loadPage(page + 1)">{{ t('common.next') }}</button>
    </div>

    <!-- Modal -->
    <Transition name="modal">
      <div v-if="showModal" class="modal-backdrop" @click.self="closeModal()">
        <div class="modal">
          <div class="modal__header">
            <h3>{{ t('telemedicine.modalTitle') }}</h3>
            <button type="button" class="modal__close" :aria-label="t('common.close')" @click="closeModal()">×</button>
          </div>
          <form @submit.prevent="handleCreate" novalidate>
            <div class="form-body">
              <div class="form-grid">
                <div class="field">
                  <label for="tele-m-date">{{ t('telemedicine.scheduledAt') }} <span class="req">*</span></label>
                  <input id="tele-m-date" name="tele-m-date" v-model="form.scheduledDate" type="datetime-local" :disabled="saving" required />
                  <span v-if="fe.scheduledDate" class="field-error">{{ fe.scheduledDate }}</span>
                </div>
                <div class="field">
                  <label for="tele-m-duration">{{ t('telemedicine.duration') }}</label>
                  <select id="tele-m-duration" name="tele-m-duration" v-model="form.duration" :disabled="saving">
                    <option value="15">{{ t('telemedicine.duration15') }}</option>
                    <option value="30">{{ t('telemedicine.duration30') }}</option>
                    <option value="45">{{ t('telemedicine.duration45') }}</option>
                    <option value="60">{{ t('telemedicine.duration60') }}</option>
                  </select>
                </div>
                <div class="field field--full">
                  <label for="tele-m-patient">{{ t('telemedicine.patient') }} <span class="req">*</span></label>
                  <input id="tele-m-patient" name="tele-m-patient" v-model.trim="patientSearch" type="search" :placeholder="t('telemedicine.patientSearch')" :disabled="saving" @input="searchPatients" autocomplete="off" />
                  <div v-if="patientResults.length" class="autocomplete" role="listbox" :aria-label="t('common.searchResults')">
                    <button v-for="pt in patientResults" :key="pt.id" type="button" class="autocomplete__item" role="option" :aria-label="`${t('common.selectPatient')} ${pt.name}`" @click="selectPatient(pt)">
                      🐾 <b>{{ pt.name }}</b>
                      <span class="autocomplete__owner">— {{ pt.primary_owner || '' }}</span>
                    </button>
                  </div>
                  <div v-if="form.patientId" class="selected-patient">✅ {{ selectedPatientLabel }}</div>
                  <span v-if="fe.patientId" class="field-error">{{ fe.patientId }}</span>
                </div>
                <div class="field field--full">
                  <label for="tele-m-vet">{{ t('telemedicine.vet') }} <span class="req">*</span></label>
                  <select id="tele-m-vet" name="tele-m-vet" v-model="form.vetId" :disabled="saving" required>
                    <option value="">{{ t('telemedicine.selectVet') }}</option>
                    <option v-for="v in vetList" :key="v.id" :value="v.id">{{ v.first_name }} {{ v.last_name }}</option>
                  </select>
                  <span v-if="fe.vetId" class="field-error">{{ fe.vetId }}</span>
                </div>
                <div class="field field--full">
                  <label for="tele-m-reason">{{ t('telemedicine.reason') }} <span class="req">*</span></label>
                  <textarea id="tele-m-reason" name="tele-m-reason" v-model.trim="form.reason" rows="2" :placeholder="t('telemedicine.reasonPlaceholder')" :disabled="saving" required />
                  <span v-if="fe.reason" class="field-error">{{ fe.reason }}</span>
                </div>
                <div class="field">
                  <label for="tele-m-type">{{ t('telemedicine.sessionType') }} <span class="req">*</span></label>
                  <select id="tele-m-type" name="tele-m-type" v-model="form.sessionType" :disabled="saving" required>
                    <option value="consultation">{{ t('telemedicine.typeConsultation') }}</option>
                    <option value="follow_up">{{ t('telemedicine.typeFollowUp') }}</option>
                    <option value="second_opinion">{{ t('telemedicine.typeSecondOpinion') }}</option>
                    <option value="emergency">{{ t('telemedicine.typeEmergency') }}</option>
                    <option value="prescription_renewal">{{ t('telemedicine.typePrescriptionRenewal') }}</option>
                  </select>
                </div>
                <div class="field">
                  <label for="tele-m-platform">{{ t('telemedicine.platform') }}</label>
                  <select id="tele-m-platform" name="tele-m-platform" v-model="form.platformId" :disabled="saving">
                    <option value="">{{ t('telemedicine.noPlatform') }}</option>
                    <option v-for="p in platformList" :key="p.id" :value="p.id">{{ p.name }}</option>
                  </select>
                </div>
              </div>
            </div>
            <div v-if="saveError" class="alert alert--error mx">{{ saveError }}</div>
            <div class="modal__actions">
              <button type="button" class="btn-ghost" @click="closeModal()" :disabled="saving">{{ t('telemedicine.cancelSession') }}</button>
              <button type="submit" class="btn-primary" :disabled="saving">
                <span v-if="saving" class="spin spin--sm" /> <span v-else>{{ t('telemedicine.programSession') }}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useAuthStore } from '../stores/auth'
import http from '../api/client'
import { adminUsersApi } from '../api/adminUsers'
import { t } from '../i18n'
import { logError } from '../utils/errors'

function asArray(value) {
  if (Array.isArray(value)) return value
  if (value == null) return []
  return [value]
}

function normalizeRoles(value) {
  return asArray(value)
    .map((role) => {
      if (typeof role === 'string') return role
      return role?.name || role?.code || role?.slug || role?.role || ''
    })
    .filter(Boolean)
}

function normalizeTeleSession(row) {
  if (!row || typeof row !== 'object') return null
  return {
    ...row,
    id: row.id ?? row.session_id ?? row.sessionId ?? null,
    patient_name: row.patient_name ?? row.patient?.name ?? row.patientName ?? '',
    client_name: row.client_name ?? row.client?.name ?? row.clientName ?? '',
    client_phone: row.client_phone ?? row.clientPhone ?? row.owner_phone ?? '',
    vet_name: row.vet_name ?? row.vet?.name ?? row.vetName ?? '',
    platform_name: row.platform_name ?? row.platform?.name ?? row.platformName ?? '',
    status: row.status ?? '',
    scheduled_date: row.scheduled_date ?? row.scheduledAt ?? row.start_time ?? null,
    start_time: row.start_time ?? row.scheduled_date ?? null,
    meeting_url: row.meeting_url ?? row.meetingUrl ?? '',
  }
}

function normalizeVet(row) {
  if (!row || typeof row !== 'object') return null
  return {
    ...row,
    id: row.id ?? row.user_id ?? row.userId ?? null,
    first_name: row.first_name ?? row.firstName ?? row.name ?? row.email ?? '',
    last_name: row.last_name ?? row.lastName ?? '',
    roles: normalizeRoles(row.roles),
  }
}

function normalizePlatform(row) {
  if (!row || typeof row !== 'object') return null
  return {
    ...row,
    id: row.id ?? row.platform_id ?? row.platformId ?? null,
    name: row.name ?? row.platform_name ?? row.platformName ?? '',
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

const allItems = ref([])
const items    = ref([])
const loading  = ref(false)
const error    = ref('')
const search   = ref('')
const dateFilter   = ref(new Date().toISOString().split('T')[0])
const statusFilter = ref('')

const page     = ref(1)
const pageSize = ref(20)
const totalSessions = computed(() => allItems.value.length)
const totalPages    = computed(() => Math.max(1, Math.ceil(totalSessions.value / pageSize.value)))

const STATUS = { scheduled: t('telemedicine.statusScheduled'), in_progress: t('telemedicine.statusInProgress'), completed: t('telemedicine.statusCompleted'), cancelled: t('telemedicine.statusCancelled'), no_show: t('telemedicine.statusNoShow') }

function petEmoji(s) {
  const m = { dog:'🐶', cat:'🐱', rabbit:'🐰', bird:'🐦', fish:'🐟', reptile:'🦎' }
  return m[s] || '🐾'
}

function formatTime(dt) {
  if (!dt) return '—'
  return new Date(dt).toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' })
}

function applyPage() {
  const start = (page.value - 1) * pageSize.value
  items.value = allItems.value.slice(start, start + pageSize.value)
}

function loadPage(newPage) {
  page.value = Math.max(1, Math.min(newPage, totalPages.value))
  applyPage()
}

async function load() {
  loading.value = true; error.value = ''
  try {
    const params = {}
    if (dateFilter.value)   params.date   = dateFilter.value
    if (statusFilter.value) params.status = statusFilter.value
    const { data } = await http.get('/tele/sessions', { params })
    const rows = asArray(data?.data || data?.consultations || data).map(normalizeTeleSession).filter(Boolean)
    const needle = search.value.trim().toLowerCase()
    allItems.value = needle
      ? rows.filter((row) => [row.patient_name, row.client_name, row.vet_name, row.platform_name]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle)))
      : rows
    page.value = 1
    applyPage()
  } catch (e) {
    error.value = e.response?.data?.message || t('telemedicine.loadError')
  } finally { loading.value = false }
}

let timer = null
function debouncedLoad() { clearTimeout(timer); timer = setTimeout(load, 350) }

function joinCall(t) {
  if (t.meeting_url) {
    window.open(t.meeting_url, '_blank', 'noopener,noreferrer')
  } else {
    alert('El enlace de videollamada no está disponible aún.')
  }
}

async function changeStatus(t, status) {
  try {
    await http.patch(`/tele/sessions/${t.id}/status`, { status })
    t.status = status
  } catch (e) {
    alert(e.response?.data?.message || t('telemedicine.updateError'))
  }
}

// Stats KPIs
const statsData = reactive({ total: 0, completed: 0, avgDuration: 0, today: 0 })
const auth = useAuthStore()
async function loadStats() {
  try {
    const { data } = await http.get('/tele/stats')
    const rows = asArray(data?.data || data).filter(Boolean)
    const todayStr = new Date().toISOString().split('T')[0]
    let totalSessions = 0
    let completedSessions = 0
    let durationSum = 0
    let durationCount = 0
    let todaySessions = 0
    for (const row of rows) {
      const ts = Number(row.total_sessions) || 0
      const cs = Number(row.completed_sessions) || 0
      const avg = Number(row.avg_duration_minutes) || 0
      const td = Number(row.today_sessions) || 0
      totalSessions += ts
      completedSessions += cs
      if (avg > 0) { durationSum += avg; durationCount++ }
      todaySessions += td
    }
    statsData.total = totalSessions
    statsData.completed = completedSessions
    statsData.avgDuration = durationCount > 0 ? Math.round(durationSum / durationCount) : 0
    statsData.today = todaySessions
  } catch (error) {
    logError('telemedicina.loadStats', error)
  }
}

// Vet list
const vetList = ref([])
async function loadVets() {
  try {
    const VET_ROLES = ['veterinarian','surgeon','vet_technician','tele_vet']
    const currentRoles = normalizeRoles(auth.roles)
    const currentUser = auth.user || {}
    const isAdmin = currentRoles.includes('superadmin') || currentRoles.includes('org_admin')

    if (isAdmin) {
      const { data } = await adminUsersApi.list({ limit: 100 })
      vetList.value = asArray(data?.data || data)
        .map(normalizeVet)
        .filter((u) => u && VET_ROLES.some((r) => u.roles.includes(r)))
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
  } catch (error) { logError('telemedicina.loadVets', error); vetList.value = [] }
}

// Platform list
const platformList = ref([])
async function loadPlatforms() {
  try {
    const { data } = await http.get('/tele/platforms')
    platformList.value = asArray(data?.data || data).map(normalizePlatform).filter(Boolean)
  } catch (error) { logError('telemedicina.loadPlatforms', error); platformList.value = [] }
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
      const { data } = await http.get('/patients', { params: { search: patientSearch.value, limit: 8 } })
      patientResults.value = asArray(data?.data || data?.patients || data).map(normalizePatient).filter(Boolean)
    } catch (error) { logError('telemedicina.searchPatients', error, { search: patientSearch.value }); patientResults.value = [] }
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
const form = reactive({ scheduledDate:'', duration:'30', patientId:'', clientId:'', vetId:'', reason:'', sessionType:'consultation', platformId:'' })

function openModal()  {
  resetForm()
  patientSearch.value = ''; patientResults.value = []; selectedPatientLabel.value = ''
  showModal.value = true
}
function closeModal() { showModal.value = false; resetForm() }
function resetForm() {
  form.scheduledDate = ''; form.duration = '30'; form.patientId = ''; form.clientId = ''
  form.vetId = ''; form.reason = ''; form.sessionType = 'consultation'; form.platformId = ''
  saveError.value = ''; Object.keys(fe).forEach(k => delete fe[k])
}

function validate() {
  Object.keys(fe).forEach(k => delete fe[k])
  if (!form.scheduledDate) fe.scheduledDate = t('common.required')
  if (!form.patientId)     fe.patientId     = t('common.required')
  if (!form.vetId)         fe.vetId         = t('common.required')
  if (!form.reason)        fe.reason        = t('common.required')
  return Object.keys(fe).length === 0
}

async function handleCreate() {
  if (!validate()) return
  saving.value = true; saveError.value = ''
  try {
    const payload = {
      scheduledAt:     form.scheduledDate,
      patientId:       parseInt(form.patientId),
      clientId:        parseInt(form.clientId),
      vetId:           parseInt(form.vetId),
      chiefComplaint:  form.reason,
      durationMinutes: parseInt(form.duration),
      sessionType:     form.sessionType,
    }
    if (form.platformId) payload.platformId = parseInt(form.platformId)
    await http.post('/tele/sessions', payload)
    closeModal(); await load()
  } catch (e) {
    saveError.value = e.response?.data?.message || t('telemedicine.createError')
  } finally { saving.value = false }
}

onMounted(() => { load(); loadStats(); loadVets(); loadPlatforms() })
</script>

<style scoped>
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }

.page { display: flex; flex-direction: column; gap: 20px; }
.page-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
.page-header__left { display: flex; align-items: center; gap: 14px; }
.page-emoji { font-size: 2rem; }
.page-title { font-size: 1.35rem; font-weight: 700; color: var(--text); }
.page-sub   { font-size: 0.82rem; color: var(--text-2); margin-top: 2px; }

/* KPI Stats bar */
.kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.kpi { display: flex; align-items: center; gap: 12px; padding: 14px 18px; background: var(--c, #D6EEFF); border-radius: var(--radius-lg); }
.kpi > span:first-child { font-size: 1.6rem; flex-shrink: 0; }
.kpi > div { display: flex; flex-direction: column; gap: 2px; }
.kpi strong { font-size: 1.25rem; font-weight: 700; color: var(--ct, #1A5FAA); line-height: 1.1; }
.kpi > div > span { font-size: 0.75rem; color: var(--ct, #1A5FAA); opacity: 0.8; white-space: nowrap; }
@media (max-width: 700px) { .kpi-row { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 400px) { .kpi-row { grid-template-columns: 1fr; } }

.info-banner { display: flex; align-items: flex-start; gap: 12px; padding: 14px 18px; background: #EEF6FF; border-radius: var(--radius-lg); border-left: 3px solid #90D5F0; font-size: 0.85rem; }
.info-banner span:first-child { font-size: 1.4rem; flex-shrink: 0; }
.info-banner strong { display: block; color: var(--text); margin-bottom: 2px; }
.info-banner span:last-child { color: var(--text-2); }

.filters { display: flex; gap: 10px; flex-wrap: wrap; }
.filter-input, .filter-select { padding: 9px 13px; border: 1.5px solid var(--border); border-radius: var(--radius); font-size: 0.87rem; background: var(--white); color: var(--text); outline: none; }
.filter-input:focus, .filter-select:focus { border-color: var(--primary); }
.filter-input--grow { flex: 1; min-width: 180px; }

/* Tele list */
.tele-list { display: flex; flex-direction: column; gap: 10px; }
.tele-card { background: var(--white); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); display: flex; align-items: center; gap: 16px; padding: 16px; transition: box-shadow var(--transition); }
.tele-card:hover { box-shadow: var(--shadow); }

.tele-card__left { display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 80px; }
.tele-time { font-size: 1.1rem; font-weight: 700; color: var(--primary); }

.tele-card__mid { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.tele-pet { display: flex; align-items: center; gap: 8px; font-size: 1.3rem; }
.tele-pet strong { display: block; font-size: 0.95rem; color: var(--text); }
.sub { font-size: 0.75rem; color: var(--text-3); }
.tele-reason { font-size: 0.83rem; color: var(--text-2); margin-top: 2px; }
.tele-vet    { font-size: 0.78rem; color: var(--text-3); }
.tele-phone  { font-size: 0.78rem; color: var(--text-3); }

.tele-card__right { display: flex; flex-direction: column; gap: 6px; align-items: flex-end; }

/* Badges */
.badge { display: inline-block; padding: 3px 9px; border-radius: 20px; font-size: 0.72rem; font-weight: 600; }
.status--scheduled   { background: #D6EEFF; color: #1A5FAA; }
.status--in_progress { background: #FFF3CC; color: #8A6200; }
.status--completed   { background: #D6F3EC; color: #1A9E7F; }
.status--cancelled   { background: #FDEAEA; color: #c0392b; }
.status--no_show     { background: var(--surface-2); color: var(--text-3); }

.btn-join { padding: 8px 14px; background: linear-gradient(135deg, #4A90D9 0%, #2C6FAC 100%); color: white; border: none; border-radius: var(--radius); font-size: 0.85rem; font-weight: 600; cursor: pointer; white-space: nowrap; transition: opacity var(--transition); }
.btn-join:hover { opacity: 0.9; }

.btn-xs { padding: 4px 10px; border: none; border-radius: 6px; font-size: 0.75rem; font-weight: 600; cursor: pointer; }
.btn-xs:hover { opacity: 0.8; }
.btn-xs--green { background: #D6F3EC; color: #1A9E7F; }
.btn-xs--red   { background: #FDEAEA; color: #c0392b; }

.btn-primary { padding: 10px 20px; background: linear-gradient(135deg, var(--primary) 0%, var(--accent-mint) 100%); color: white; border: none; border-radius: var(--radius); font-size: 0.9rem; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: opacity var(--transition), transform var(--transition); }
.btn-primary:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
.btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
.btn-ghost { padding: 10px 20px; background: none; border: 1.5px solid var(--border); border-radius: var(--radius); color: var(--text-2); font-size: 0.9rem; font-weight: 500; cursor: pointer; transition: background var(--transition); }
.btn-ghost:hover:not(:disabled) { background: var(--surface-2); }

.modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 16px; }
.modal { background: var(--white); border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); width: 100%; max-width: 520px; max-height: 92vh; overflow-y: auto; }
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
.pagination { display: flex; align-items: center; justify-content: center; gap: 16px; font-size: 0.85rem; color: var(--text-2); }
.pagination button { padding: 6px 14px; border: 1.5px solid var(--border); border-radius: var(--radius-sm); background: none; cursor: pointer; font-size: 0.82rem; color: var(--text-2); }
.pagination button:hover:not(:disabled) { background: var(--surface-2); }
.pagination button:disabled { opacity: 0.4; cursor: not-allowed; }
@media (max-width: 600px) {
  .tele-card { flex-wrap: wrap; }
  .form-grid { grid-template-columns: 1fr; }
}
.autocomplete { position: absolute; z-index: 100; background: var(--white); border: 1.5px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); width: 100%; max-height: 200px; overflow-y: auto; }
.autocomplete__item { padding: 9px 13px; cursor: pointer; font-size: 0.88rem; }
.autocomplete__item:hover { background: var(--surface-2); }
.autocomplete__owner { font-size: 0.78rem; color: var(--text-3); }
.selected-patient { margin-top: 6px; font-size: 0.82rem; color: var(--primary); font-weight: 500; }
.field { position: relative; }
</style>



