<template>
  <div class="page">

    <div class="page-header">
      <div class="page-header__left">
        <span class="page-emoji">🔪</span>
        <div>
          <h2 class="page-title">{{ t('surgery.title') }}</h2>
          <p class="page-sub">{{ t('surgery.subtitle') }}</p>
        </div>
      </div>
      <BaseButton type="button" @click="openNewSurgery()">+ {{ t('surgery.newSurgery') }}</BaseButton>
    </div>

    <!-- Stats -->
    <div class="stats-row">
      <div class="stat-card" style="--c:#D6EEFF;--ct:#1A5FAA">
        <span class="stat-card__icon">📅</span>
        <div>
          <strong>{{ stats.scheduled }}</strong>
          <span>{{ t('surgery.scheduled') }}</span>
        </div>
      </div>
      <div class="stat-card" style="--c:#FFF3CC;--ct:#8A6200">
        <span class="stat-card__icon">⚡</span>
        <div>
          <strong>{{ stats.inProgress }}</strong>
          <span>{{ t('surgery.inProgress') }}</span>
        </div>
      </div>
      <div class="stat-card" style="--c:#D6F3EC;--ct:#1A9E7F">
        <span class="stat-card__icon">✅</span>
        <div>
          <strong>{{ stats.completedToday }}</strong>
          <span>{{ t('surgery.completedToday') }}</span>
        </div>
      </div>
    </div>

    <!-- Filtros -->
    <div class="filters">
      <label for="surg-search" class="sr-only">{{ t('surgery.searchPlaceholder') }}</label>
      <input
        id="surg-search"
        name="surg-search"
        v-model.trim="search"
        type="search"
        :placeholder="t('surgery.searchPlaceholder')"
        class="filter-input filter-input--grow"
        @input="debouncedLoad()"
      />
      <label for="surg-status" class="sr-only">{{ t('common.allStatuses') }}</label>
      <select id="surg-status" name="surg-status" v-model="statusFilter" class="filter-select" @change="load()">
        <option value="">{{ t('common.allStatuses') }}</option>
        <option value="scheduled">{{ t('surgery.statusScheduled') }}</option>
        <option value="in_progress">{{ t('surgery.inProgress') }}</option>
        <option value="completed">{{ t('surgery.statusCompleted') }}</option>
        <option value="cancelled">{{ t('surgery.statusCancelled') }}</option>
        <option value="postponed">{{ t('surgery.statusPostponed') }}</option>
      </select>
    </div>

    <div v-if="loading" class="loading-state" role="status" aria-live="polite">
      <span class="spin spin--dark" /> {{ t('surgery.loading') }}
    </div>
    <div v-else-if="error" class="alert alert--error" role="alert">{{ error }}</div>
    <div v-else-if="items.length === 0" class="empty-state">
      <span class="empty-state__emoji">🔪</span>
      <p>{{ t('surgery.empty') }}</p>
    </div>

    <div v-else class="card">
      <table class="table">
        <thead>
          <tr>
            <th>{{ t('surgery.tablePatient') }}</th>
            <th>{{ t('surgery.tableType') }}</th>
            <th>{{ t('surgery.tableSurgeon') }}</th>
            <th>{{ t('surgery.tableStatus') }}</th>
            <th>{{ t('surgery.tableScheduled') }}</th>
            <th>{{ t('surgery.tableDuration') }}</th>
            <th>{{ t('surgery.tableActions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in items" :key="s.id">
            <td>
              <div class="pet-cell">
                <span>{{ petEmoji(s.species) }}</span>
                <div>
                  <strong>{{ s.patient_name || '—' }}</strong>
                  <span class="sub">{{ s.vet_name || '' }}</span>
                </div>
              </div>
            </td>
            <td>
              <div>
                <strong class="type-name">{{ s.surgery_type_name || '—' }}</strong>
                <div class="sub">{{ s.category_name || '' }}</div>
              </div>
            </td>
            <td class="sub">{{ s.surgeon_name || '—' }}</td>
            <td>
              <span class="badge" :class="surgeryStatusClass(s.status)">{{ surgeryStatusLabel(s.status) }}</span>
              <span v-if="s.complications" class="badge badge--red" style="margin-left:4px" :title="t('surgery.complicationsLabel')">⚠</span>
            </td>
            <td class="sub">{{ formatDate(s.scheduled_date) }}</td>
            <td class="sub">{{ s.duration_minutes ? s.duration_minutes + ' min' : '—' }}</td>
            <td>
              <div class="action-btns">
                <button
                  v-if="s.status === 'in_progress' || s.status === 'completed'"
                  class="btn-action btn-action--primary"
                  @click="openAnesthesia(s)"
                  :title="t('surgery.registerAnesthesia')"
                >
                  {{ t('surgery.registerAnesthesia') }}
                </button>
                <button
                  v-if="s.status === 'scheduled' || s.status === 'in_progress'"
                  class="btn-action"
                  @click="openChangeStatus(s)"
                  :title="t('surgery.changeStatus')"
                >
                  {{ t('surgery.tableStatus') }}
                </button>
                <button
                  class="btn-action"
                  @click="viewDetail(s)"
                  :title="t('surgery.viewDetail')"
                >
                  {{ t('surgery.viewDetail') }}
                </button>
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

    <!-- Modal programar cirugía -->
    <Transition name="modal">
      <div v-if="showNew" class="modal-backdrop" @click.self="showNew = false">
        <div class="modal modal--wide">
          <div class="modal__header">
            <h3>🔪 {{ t('surgery.newModalTitle') }}</h3>
            <BaseButton type="button" variant="ghost" class="modal__close" :aria-label="t('common.close')" @click="showNew = false">×</BaseButton>
          </div>

          <form @submit.prevent="handleCreate" novalidate>
            <div class="form-body">

              <!-- Paciente autocomplete -->
              <div class="field field--full" style="position:relative">
                <label for="surg-m-patient">{{ t('surgery.patientLabel') }} <span class="req">*</span></label>
                <input
                  id="surg-m-patient"
                  name="surg-m-patient"
                  v-model.trim="patientSearch"
                  type="search"
                  :placeholder="t('surgery.patientPlaceholder')"
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
                    :aria-label="`${t('common.selectPatient')} ${pt.name}`"
                    @click="selectPatient(pt)"
                  >
                    {{ petEmoji(pt.species) }} <b>{{ pt.name }}</b>
                    <span v-if="pt.hc_number" class="autocomplete__owner"> · HC {{ pt.hc_number }}</span>
                    <span class="autocomplete__owner">— {{ pt.primary_owner || '' }}</span>
                  </button>
                </div>
                <div v-if="newForm.patientId" class="selected-patient">✅ {{ selectedPatientLabel }}</div>
                <span v-if="fe.patientId" class="field-error">{{ fe.patientId }}</span>
              </div>

              <!-- Tipo de cirugía -->
              <div class="field field--full">
                <label for="surg-m-type">{{ t('surgery.typeLabel') }} <span class="req">*</span></label>
                <select id="surg-m-type" name="surg-m-type" v-model="newForm.surgeryTypeId" :disabled="saving || typesLoading">
                  <option value="">{{ typesLoading ? t('surgery.typeLoading') : t('surgery.typePlaceholder') }}</option>
                  <optgroup v-for="(types, cat) in groupedTypes" :key="cat" :label="cat">
                    <option v-for="t in types" :key="t.id" :value="t.id">
                      {{ t.name }}
                      <template v-if="t.risk_level"> · Riesgo {{ riskLabel(t.risk_level) }}</template>
                      <template v-if="t.estimated_duration_minutes"> · {{ t.estimated_duration_minutes }} min est.</template>
                    </option>
                  </optgroup>
                </select>
                <!-- Info del tipo seleccionado -->
                <div v-if="selectedTypeInfo" class="type-info">
                  <span v-if="selectedTypeInfo.description" class="type-info__desc">{{ selectedTypeInfo.description }}</span>
                  <div class="type-info__badges">
                    <span class="badge" :class="riskClass(selectedTypeInfo.risk_level)">{{ t('surgery.risk') }}: {{ riskLabel(selectedTypeInfo.risk_level) }}</span>
                    <span v-if="selectedTypeInfo.requires_specialist" class="badge badge--yellow">{{ t('surgery.requiresSpecialist') }}</span>
                    <span v-if="selectedTypeInfo.estimated_duration_minutes" class="sub">{{ selectedTypeInfo.estimated_duration_minutes }} min estimados</span>
                  </div>
                </div>
                <span v-if="fe.surgeryTypeId" class="field-error">{{ fe.surgeryTypeId }}</span>
              </div>

              <div class="form-grid">
                <div class="field">
                  <label for="surg-m-date">{{ t('surgery.scheduledLabel') }} <span class="req">*</span></label>
                  <input id="surg-m-date" name="surg-m-date" v-model="newForm.scheduledDate" type="datetime-local" :disabled="saving" />
                  <span v-if="fe.scheduledDate" class="field-error">{{ fe.scheduledDate }}</span>
                </div>

                <div class="field">
                  <label for="surg-m-duration">{{ t('surgery.durationLabel') }}</label>
                  <input id="surg-m-duration" name="surg-m-duration" v-model.number="newForm.estimatedDurationMinutes" type="number" min="1" max="600" placeholder="ej: 90" :disabled="saving" />
                </div>
                <div class="field">
                  <label for="surg-m-urgency">Urgencia</label>
                  <select id="surg-m-urgency" name="surg-m-urgency" v-model="newForm.urgency" :disabled="saving">
                    <option value="routine">Rutina</option>
                    <option value="urgent">Urgente</option>
                    <option value="emergency">Emergencia</option>
                  </select>
                </div>

                <div class="field field--full">
                  <label for="surg-m-notes">{{ t('surgery.notesLabel') }}</label>
                  <textarea
                    id="surg-m-notes"
                    name="surg-m-notes"
                    v-model.trim="newForm.preOpNotes"
                    rows="3"
                    :placeholder="t('surgery.notesPlaceholder')"
                    :disabled="saving"
                  />
                </div>
              </div>

            </div>

            <div v-if="saveError" class="alert alert--error mx">{{ saveError }}</div>

            <div class="modal__actions">
              <BaseButton type="button" variant="ghost" @click="showNew = false" :disabled="saving">{{ t('common.cancel') }}</BaseButton>
              <BaseButton type="submit" :disabled="saving">
                <span v-if="saving" class="spin spin--sm" />
                <span v-else>{{ t('common.create') }}</span>
              </BaseButton>
            </div>
          </form>
        </div>
      </div>
    </Transition>

    <!-- Modal registrar anestesia -->
    <Transition name="modal">
      <div v-if="showAnesthesia" class="modal-backdrop" @click.self="showAnesthesia = false">
        <div class="modal modal--wide">
          <div class="modal__header">
            <h3>💉 {{ t('surgery.anesthesiaTitle') }} — {{ selectedSurgery?.patient_name }}</h3>
            <BaseButton type="button" variant="ghost" class="modal__close" @click="showAnesthesia = false">✕</BaseButton>
          </div>

          <form @submit.prevent="handleAnesthesia" novalidate>
            <div class="form-body">
              <div class="form-grid">

                <div class="field">
                  <label for="surg-a-type">{{ t('surgery.anesthesiaTypeLabel') }} <span class="req">*</span></label>
                  <select id="surg-a-type" name="surg-a-type" v-model="aneForm.anesthesiaType" :disabled="aneSaving">
                    <option value="">{{ t('surgery.anesthesiaTypePlaceholder') }}</option>
                    <option value="general">{{ t('surgery.anesthesiaGeneral') }}</option>
                    <option value="local">{{ t('surgery.anesthesiaLocal') }}</option>
                    <option value="regional">{{ t('surgery.anesthesiaRegional') }}</option>
                    <option value="sedation">{{ t('surgery.anesthesiaSedation') }}</option>
                  </select>
                  <span v-if="afe.anesthesiaType" class="field-error">{{ afe.anesthesiaType }}</span>
                </div>

                <div class="field">
                  <label for="surg-a-duration">{{ t('surgery.totalDurationLabel') }}</label>
                  <input id="surg-a-duration" name="surg-a-duration" v-model.number="aneForm.totalDurationMinutes" type="number" min="1" max="600" placeholder="ej: 75" :disabled="aneSaving" />
                </div>

                <div class="field field--full">
                  <label for="surg-a-agents">{{ t('surgery.agentsLabel') }} <span class="req">*</span></label>
                  <textarea
                    id="surg-a-agents"
                    name="surg-a-agents"
                    v-model.trim="aneForm.anestheticAgents"
                    rows="2"
                    :placeholder="t('surgery.agentsPlaceholder') || 'Propofol, isoflurano, ketamina...'"
                    :disabled="aneSaving"
                  />
                  <span v-if="afe.anestheticAgents" class="field-error">{{ afe.anestheticAgents }}</span>
                </div>

                <div class="field">
                  <label for="surg-a-induction">{{ t('surgery.inductionLabel') }}</label>
                  <input id="surg-a-induction" name="surg-a-induction" v-model="aneForm.inductionTime" type="time" :disabled="aneSaving" />
                </div>

                <div class="field">
                  <label for="surg-a-recovery">{{ t('surgery.recoveryLabel') }}</label>
                  <input id="surg-a-recovery" name="surg-a-recovery" v-model="aneForm.recoveryTime" type="time" :disabled="aneSaving" />
                </div>

                <div class="field field--full">
                  <label for="surg-a-monitoring">{{ t('surgery.monitoringLabel') }}</label>
                  <textarea
                    id="surg-a-monitoring"
                    name="surg-a-monitoring"
                    v-model.trim="aneForm.monitoringNotes"
                    rows="2"
                    placeholder="Saturación, frecuencia cardíaca, PA durante el procedimiento..."
                    :disabled="aneSaving"
                  />
                </div>

                <div class="field field--full">
                  <label class="checkbox-label">
                    <input id="surg-a-complications" name="surg-a-complications" type="checkbox" v-model="aneForm.complications" :disabled="aneSaving" />
                    {{ t('surgery.complicationsLabel') }}
                  </label>
                </div>

                <div v-if="aneForm.complications" class="field field--full">
                  <label for="surg-a-comp-notes">{{ t('surgery.complicationNotesLabel') }} <span class="req">*</span></label>
                  <textarea
                    id="surg-a-comp-notes"
                    name="surg-a-comp-notes"
                    v-model.trim="aneForm.complicationNotes"
                    rows="3"
                    :placeholder="t('surgery.complicationNotesPlaceholder')"
                    :disabled="aneSaving"
                  />
                  <span v-if="afe.complicationNotes" class="field-error">{{ afe.complicationNotes }}</span>
                </div>

              </div>
            </div>

            <div v-if="aneError" class="alert alert--error mx" role="alert">{{ aneError }}</div>

            <div class="modal__actions">
              <BaseButton type="button" variant="ghost" @click="showAnesthesia = false" :disabled="aneSaving">{{ t('common.cancel') }}</BaseButton>
              <BaseButton type="submit" :disabled="aneSaving">
                <span v-if="aneSaving" class="spin spin--sm" />
                <span v-else>{{ t('common.save') }}</span>
              </BaseButton>
            </div>
          </form>
        </div>
      </div>
    </Transition>

    <!-- Modal cambiar estado -->
    <Transition name="modal">
      <div v-if="showStatus" class="modal-backdrop" @click.self="showStatus = false">
        <div class="modal modal--sm">
          <div class="modal__header">
            <h3>🔄 {{ t('surgery.statusTitle') }}</h3>
            <BaseButton type="button" variant="ghost" class="modal__close" @click="showStatus = false">✕</BaseButton>
          </div>
          <div class="form-body">
            <p class="sub" style="margin-bottom:8px">
              {{ t('surgery.generalData') }}: <strong>{{ selectedSurgery?.surgery_type_name }}</strong> — {{ selectedSurgery?.patient_name }}
            </p>
            <div class="status-options">
              <button
                v-if="selectedSurgery?.status === 'scheduled'"
                type="button"
                class="status-opt status-opt--yellow"
                @click="changeStatus('in_progress')"
                :disabled="statusSaving"
              >
                ⚡ {{ t('surgery.statusScheduled') }}
              </button>
              <button
                v-if="selectedSurgery?.status === 'scheduled' || selectedSurgery?.status === 'in_progress'"
                type="button"
                class="status-opt status-opt--green"
                @click="changeStatus('completed')"
                :disabled="statusSaving"
              >
                ✅ {{ t('surgery.statusCompleted') }}
              </button>
              <button
                v-if="selectedSurgery?.status === 'scheduled'"
                type="button"
                class="status-opt status-opt--gray"
                @click="changeStatus('postponed')"
                :disabled="statusSaving"
              >
                📌 {{ t('surgery.statusPostponed') }}
              </button>
              <button
                v-if="selectedSurgery?.status !== 'cancelled' && selectedSurgery?.status !== 'completed'"
                type="button"
                class="status-opt status-opt--red"
                @click="changeStatus('cancelled')"
                :disabled="statusSaving"
              >
                ✕ {{ t('surgery.statusCancelled') }}
              </button>
            </div>
          </div>
          <div v-if="statusError" class="alert alert--error mx" role="alert">{{ statusError }}</div>
          <div class="modal__actions" style="border-top:none;padding-top:4px">
            <BaseButton type="button" variant="ghost" @click="showStatus = false" :disabled="statusSaving">{{ t('common.close') }}</BaseButton>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Modal detalle -->
    <Transition name="modal">
      <div v-if="showDetail" class="modal-backdrop" @click.self="showDetail = false">
        <div class="modal modal--wide">
          <div class="modal__header">
            <h3>🔪 {{ t('surgery.detailTitle') }} — {{ detailData?.patient_name }}</h3>
            <BaseButton type="button" variant="ghost" class="modal__close" @click="showDetail = false">✕</BaseButton>
          </div>
          <div v-if="detailLoading" class="loading-state" style="min-height:200px" role="status" aria-live="polite">
            <span class="spin spin--dark" /> {{ t('surgery.detailLoading') }}
          </div>
          <div v-else-if="detailData" class="form-body">
            <div class="detail-grid">
              <div class="detail-item">
                <span class="detail-label">{{ t('surgery.detailPatient') }}</span>
                <span>{{ detailData.patient_name }} ({{ detailData.species }})</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">{{ t('surgery.detailType') }}</span>
                <span>{{ detailData.surgery_type_name }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">{{ t('surgery.detailCategory') }}</span>
                <span>{{ detailData.category_name || '—' }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">{{ t('surgery.detailSurgeon') }}</span>
                <span>{{ detailData.surgeon_name || '—' }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">{{ t('surgery.tableStatus') }}</span>
                <span class="badge" :class="surgeryStatusClass(detailData.status)">{{ surgeryStatusLabel(detailData.status) }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">{{ t('surgery.detailDate') }}</span>
                <span>{{ formatDate(detailData.scheduled_date) }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">{{ t('surgery.detailDuration') }}</span>
                <span>{{ detailData.duration_minutes ? detailData.duration_minutes + ' min' : '—' }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">{{ t('surgery.detailComplications') }}</span>
                <span>{{ detailData.complications ? 'Sí' : 'No' }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">Urgencia</span>
                <span>{{ detailData.urgency || '-' }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">Inicio / fin</span>
                <span>{{ formatDate(detailData.start_time) }} / {{ formatDate(detailData.end_time) }}</span>
              </div>
              <div v-if="detailData.medical_record_id" class="detail-item">
                <span class="detail-label">Ficha médica</span>
                <span>#{{ detailData.medical_record_id }}</span>
              </div>
              <div v-if="detailData.assistant_surgeon_name || detailData.assistant_surgeon_id" class="detail-item">
                <span class="detail-label">Cirujano asistente</span>
                <span>{{ detailData.assistant_surgeon_name || ('#' + detailData.assistant_surgeon_id) }}</span>
              </div>
              <div v-if="detailData.anesthesiologist_name || detailData.anesthesiologist_id" class="detail-item">
                <span class="detail-label">Anestesiólogo</span>
                <span>{{ detailData.anesthesiologist_name || ('#' + detailData.anesthesiologist_id) }}</span>
              </div>
              <div v-if="detailData.surgical_nurse_name || detailData.surgical_nurse_id" class="detail-item">
                <span class="detail-label">Instrumentador/a</span>
                <span>{{ detailData.surgical_nurse_name || ('#' + detailData.surgical_nurse_id) }}</span>
              </div>
              <div v-if="detailData.preoperative_diagnosis" class="detail-item detail-item--full">
                <span class="detail-label">Diagnóstico preoperatorio</span>
                <span>{{ detailData.preoperative_diagnosis }}</span>
              </div>
              <div v-if="detailData.surgical_approach" class="detail-item detail-item--full">
                <span class="detail-label">Abordaje quirúrgico</span>
                <span>{{ detailData.surgical_approach }}</span>
              </div>
              <div v-if="detailData.notes" class="detail-item detail-item--full">
                <span class="detail-label">{{ t('surgery.notesLabel') }}</span>
                <span>{{ detailData.notes }}</span>
              </div>
            </div>

            <!-- {{ t('surgery.anesthesiaTitle') }} -->
            <template v-if="detailData.anesthesia_records && detailData.anesthesia_records.length">
              <div class="section-title" style="margin-top:16px">{{ t('surgery.anesthesiaTitle') }}</div>
              <div
                v-for="(rec, i) in detailData.anesthesia_records"
                :key="i"
                class="ane-record"
              >
                <div class="ane-record__header">
                  <span class="badge badge--blue">{{ aneTypeLabel(rec.anesthesia_type) }}</span>
                  <span v-if="rec.complications" class="badge badge--red">⚠ {{ t('surgery.detailComplications') }}</span>
                  <span class="sub">{{ rec.total_duration_minutes ? rec.total_duration_minutes + ' min' : '' }}</span>
                </div>
                <p class="sub" style="margin-top:4px">{{ t('surgery.agentsLabel') }}: {{ rec.anesthetic_agents }}</p>
                <p v-if="rec.monitoring_notes" class="sub">{{ t('surgery.monitoringLabel') }}: {{ rec.monitoring_notes }}</p>
                <p v-if="rec.complication_notes" class="sub" style="color:#c0392b">{{ rec.complication_notes }}</p>
              </div>
            </template>
            <div v-else class="sub" style="margin-top:12px; padding:12px; background:var(--surface); border-radius:var(--radius)">
              {{ t('common.none') }}
            </div>
          </div>
          <div class="modal__actions">
            <BaseButton type="button" variant="ghost" @click="showDetail = false">{{ t('common.close') }}</BaseButton>
          </div>
        </div>
      </div>
    </Transition>

  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import BaseButton from '../components/base/BaseButton.vue'
import { t } from '../i18n'
import { extractDetailedErrorMessage, logError } from '../utils/errors'
import {
  addAnesthesiaRecord as addAnesthesiaRecordRequest,
  createSurgery as createSurgeryRequest,
  getSurgeryDetail as getSurgeryDetailRequest,
  loadSurgeryTypes as loadSurgeryTypesRequest,
  loadSurgeries as loadSurgeriesRequest,
  searchPatients as searchPatientsRequest,
  updateSurgeryStatus as updateSurgeryStatusRequest,
} from '../composables/surgery/useSurgeryDomain'

// Lista
const items        = ref([])
const loading      = ref(false)
const error        = ref('')
const search       = ref('')
const statusFilter = ref('')
const pagination   = ref({ page: 1, totalPages: 1 })

const stats = reactive({ scheduled: 0, inProgress: 0, completedToday: 0 })

async function load(page = 1) {
  loading.value = true; error.value = ''
  try {
    const pageSize = 15
    const rows = await loadSurgeriesRequest({ status: statusFilter.value })
    const needle = search.value.trim().toLowerCase()
    const filtered = needle
      ? rows.filter((row) => [row.patient_name, row.surgery_type_name, row.category_name, row.surgeon_name]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle)))
      : rows
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
    const safePage = Math.min(page, totalPages)
    items.value = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)
    pagination.value = { page: safePage, totalPages }
    computeStats()
  } catch (e) {
    logError('cirugias.load', e)
    error.value = extractDetailedErrorMessage(e, 'No se pudieron cargar las cirugias', { context: 'Carga de cirugias' })
  } finally { loading.value = false }
}

function computeStats() {
  const today = new Date().toISOString().split('T')[0]
  let scheduled = 0, inProgress = 0, completedToday = 0
  items.value.forEach(s => {
    if (s.status === 'scheduled') scheduled++
    if (s.status === 'in_progress') inProgress++
    if (s.status === 'completed' && (s.scheduled_date || '').startsWith(today)) completedToday++
  })
  stats.scheduled = scheduled
  stats.inProgress = inProgress
  stats.completedToday = completedToday
}

let loadTimer = null
function debouncedLoad() { clearTimeout(loadTimer); loadTimer = setTimeout(load, 350) }

// Helpers
function petEmoji(s) {
  if (!s) return '🐾'
  const m = { perro:'🐶', dog:'🐶', gato:'🐱', cat:'🐱', conejo:'🐰', rabbit:'🐰', loro:'🦜', bird:'🦜', pez:'🐟', fish:'🐟', tortuga:'🐢', reptile:'🦎', hamster:'🐹' }
  return m[s.toLowerCase()] || '🐾'
}

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function surgeryStatusClass(s) {
  return { scheduled: 'badge--blue', in_progress: 'badge--yellow', completed: 'badge--green', cancelled: 'badge--red', postponed: 'badge--gray' }[s] || 'badge--gray'
}

function surgeryStatusLabel(s) {
  return { scheduled: 'Programada', in_progress: 'En curso', completed: 'Completada', cancelled: 'Cancelada', postponed: 'Postergada' }[s] || s || '—'
}

function riskClass(r) {
  return { low: 'badge--green', medium: 'badge--yellow', high: 'badge--red', critical: 'badge--red-dark' }[r] || 'badge--gray'
}

function riskLabel(r) {
  return { low: 'Bajo', medium: 'Medio', high: 'Alto', critical: 'Crítico' }[r] || r || '—'
}

function aneTypeLabel(t) {
  return { general: 'General', local: 'Local', regional: 'Regional', sedation: 'Sedación' }[t] || t || '—'
}

// Tipos de cirugía
const allTypes   = ref([])
const typesLoading = ref(false)

const groupedTypes = computed(() => {
  const groups = {}
  allTypes.value.forEach(t => {
    const cat = t.category_name || 'General'
    if (!groups[cat]) groups[cat] = []
    groups[cat].push(t)
  })
  return groups
})

const selectedTypeInfo = computed(() => {
  if (!newForm.surgeryTypeId) return null
  return allTypes.value.find(t => t.id === newForm.surgeryTypeId) || null
})

async function loadTypes() {
  typesLoading.value = true
  try {
    allTypes.value = await loadSurgeryTypesRequest()
  } catch (error) {
    logError('cirugias.loadTypes', error)
    allTypes.value = []
  }
  finally { typesLoading.value = false }
}

// Autocomplete paciente
const patientSearch        = ref('')
const patientResults       = ref([])
const selectedPatientLabel = ref('')
let patientTimer = null

async function searchPatients() {
  clearTimeout(patientTimer)
  newForm.patientId = ''
  selectedPatientLabel.value = ''
  if (patientSearch.value.length < 2) { patientResults.value = []; return }
  patientTimer = setTimeout(async () => {
    try {
      patientResults.value = await searchPatientsRequest(patientSearch.value)
    } catch (error) {
      logError('cirugias.searchPatients', error, { search: patientSearch.value })
      patientResults.value = []
    }
  }, 300)
}

function selectPatient(pt) {
  newForm.patientId = pt.id
  selectedPatientLabel.value = `${pt.name}${pt.hc_number ? ' · HC ' + pt.hc_number : ''}${pt.primary_owner ? ' — ' + pt.primary_owner : ''}`
  patientSearch.value = pt.name
  patientResults.value = []
}

// Modal nueva cirugía
const showNew   = ref(false)
const saving    = ref(false)
const saveError = ref('')
const fe        = reactive({})

const newForm = reactive({
  patientId: '',
  surgeryTypeId: '',
  scheduledDate: '',
  estimatedDurationMinutes: null,
  urgency: 'routine',
  preOpNotes: '',
})

function openNewSurgery() {
  Object.assign(newForm, { patientId: '', surgeryTypeId: '', scheduledDate: '', estimatedDurationMinutes: null, urgency: 'routine', preOpNotes: '' })
  patientSearch.value = ''
  patientResults.value = []
  selectedPatientLabel.value = ''
  saveError.value = ''
  Object.keys(fe).forEach(k => delete fe[k])
  showNew.value = true
  if (allTypes.value.length === 0) loadTypes()
}

function validateNew() {
  Object.keys(fe).forEach(k => delete fe[k])
  if (!newForm.patientId)    fe.patientId    = t('surgery.selectPatient')
  if (!newForm.surgeryTypeId) fe.surgeryTypeId = t('surgery.selectType')
  if (!newForm.scheduledDate) fe.scheduledDate = t('surgery.enterDate')
  return Object.keys(fe).length === 0
}

async function handleCreate() {
  if (!validateNew()) return
  saving.value = true; saveError.value = ''
  try {
    await createSurgeryRequest(newForm)
    showNew.value = false
    await load()
  } catch (e) {
    saveError.value = extractDetailedErrorMessage(e, 'No se pudo programar la cirugia.', { context: 'Programacion de cirugia' })
  } finally { saving.value = false }
}

// Modal anestesia
const showAnesthesia  = ref(false)
const selectedSurgery = ref(null)
const aneSaving       = ref(false)
const aneError        = ref('')
const afe             = reactive({})

const aneForm = reactive({
  anesthesiaType: '',
  anestheticAgents: '',
  inductionTime: '',
  recoveryTime: '',
  complications: false,
  complicationNotes: '',
  monitoringNotes: '',
  totalDurationMinutes: null,
})

function openAnesthesia(surgery) {
  selectedSurgery.value = surgery
  Object.assign(aneForm, {
    anesthesiaType: '', anestheticAgents: '', inductionTime: '', recoveryTime: '',
    complications: false, complicationNotes: '', monitoringNotes: '', totalDurationMinutes: null,
  })
  aneError.value = ''
  Object.keys(afe).forEach(k => delete afe[k])
  showAnesthesia.value = true
}

function validateAne() {
  Object.keys(afe).forEach(k => delete afe[k])
  if (!aneForm.anesthesiaType)    afe.anesthesiaType    = t('surgery.anesthesiaTypePlaceholder')
  if (!aneForm.anestheticAgents)  afe.anestheticAgents  = t('surgery.enterAgents')
  if (aneForm.complications && !aneForm.complicationNotes) afe.complicationNotes = t('surgery.describeComplications')
  return Object.keys(afe).length === 0
}

async function handleAnesthesia() {
  if (!validateAne()) return
  aneSaving.value = true; aneError.value = ''
  try {
    await addAnesthesiaRecordRequest(selectedSurgery.value.id, aneForm)
    showAnesthesia.value = false
    await load()
  } catch (e) {
    aneError.value = extractDetailedErrorMessage(e, 'No se pudo registrar la anestesia.', { context: 'Registro de anestesia' })
  } finally { aneSaving.value = false }
}

// Modal cambiar estado
const showStatus   = ref(false)
const statusSaving = ref(false)
const statusError  = ref('')

function openChangeStatus(surgery) {
  selectedSurgery.value = surgery
  statusError.value = ''
  showStatus.value = true
}

async function changeStatus(newStatus) {
  statusSaving.value = true; statusError.value = ''
  try {
    await updateSurgeryStatusRequest(selectedSurgery.value.id, newStatus)
    showStatus.value = false
    await load()
  } catch (e) {
    statusError.value = extractDetailedErrorMessage(e, 'No se pudo cambiar el estado.', { context: 'Cambio de estado quirurgico' })
  } finally { statusSaving.value = false }
}

// Modal detalle
const showDetail   = ref(false)
const detailLoading = ref(false)
const detailData   = ref(null)

async function viewDetail(surgery) {
  showDetail.value = true
  detailLoading.value = true
  detailData.value = null
  try {
    detailData.value = await getSurgeryDetailRequest(surgery.id)
  } catch (error) {
    logError('cirugias.openDetail', error, { surgeryId: surgery?.id })
    detailData.value = surgery
  }
  finally { detailLoading.value = false }
}

onMounted(load)
onUnmounted(() => {
  clearTimeout(loadTimer)
  clearTimeout(patientTimer)
})
</script>

<style scoped>
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
.page { display: flex; flex-direction: column; gap: 20px; }
.page-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
.page-header__left { display: flex; align-items: center; gap: 14px; }
.page-emoji { font-size: 2rem; }
.page-title { font-size: 1.35rem; font-weight: 700; color: var(--text); }
.page-sub   { font-size: 0.82rem; color: var(--text-2); margin-top: 2px; }

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
.type-name { font-size: 0.88rem; color: var(--text); display: block; }

/* Badges */
.badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 0.73rem; font-weight: 700; white-space: nowrap; }
.badge--gray     { background: #EAEAEA; color: #555; }
.badge--yellow   { background: #FFF3CC; color: #8A6200; }
.badge--blue     { background: #D6EEFF; color: #1A5FAA; }
.badge--green    { background: #D6F3EC; color: #1A9E7F; }
.badge--red      { background: #FDEAEA; color: #c0392b; }
.badge--red-dark { background: #7B0000; color: #fff; }

/* Acciones */
.action-btns { display: flex; gap: 6px; flex-wrap: wrap; }
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
.modal--sm   { max-width: 440px; }
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

/* Tipo de cirugía info */
.type-info { background: var(--surface); border: 1.5px solid var(--border); border-radius: var(--radius); padding: 10px 14px; display: flex; flex-direction: column; gap: 8px; margin-top: 4px; }
.type-info__desc { font-size: 0.84rem; color: var(--text-2); }
.type-info__badges { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

/* Checkbox label */
.checkbox-label { display: flex; align-items: center; gap: 8px; font-size: 0.86rem; color: var(--text-2); cursor: pointer; padding: 9px 11px; border: 1.5px solid var(--border); border-radius: var(--radius); transition: background 0.12s; font-weight: 600; }
.checkbox-label:hover { background: var(--surface-2); }
.checkbox-label input[type="checkbox"] { width: 15px; height: 15px; cursor: pointer; }

/* Cambio de estado */
.status-options { display: flex; flex-direction: column; gap: 8px; }
.status-opt { width: 100%; padding: 11px 16px; border: 1.5px solid var(--border); border-radius: var(--radius); font-size: 0.9rem; font-weight: 600; cursor: pointer; text-align: left; transition: filter 0.12s, transform 0.1s; background: var(--white); color: var(--text); }
.status-opt:hover:not(:disabled) { filter: brightness(0.95); transform: translateX(2px); }
.status-opt:disabled { opacity: 0.5; cursor: not-allowed; }
.status-opt--yellow { border-color: #8A6200; color: #8A6200; background: #FFF3CC; }
.status-opt--green  { border-color: #1A9E7F; color: #1A9E7F; background: #D6F3EC; }
.status-opt--gray   { border-color: #888; color: #555; background: #EAEAEA; }
.status-opt--red    { border-color: var(--danger); color: var(--danger); background: #FDEAEA; }

/* Detalle */
.detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.detail-item { display: flex; flex-direction: column; gap: 3px; padding: 10px 12px; background: var(--surface); border-radius: var(--radius); }
.detail-item--full { grid-column: 1 / -1; }
.detail-label { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-3); }

/* Registros anestesia */
.ane-record { background: var(--surface); border: 1.5px solid var(--border); border-radius: var(--radius-lg); padding: 12px 16px; margin-bottom: 10px; }
.ane-record__header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

/* Alertas */
.alert { padding: 10px 14px; border-radius: var(--radius-sm); font-size: 0.875rem; }
.alert--error { background: #FDEAEA; color: #c0392b; border-left: 3px solid var(--danger); }
.mx { margin: 0 24px 8px; }

/* {{ t('surgery.tableStatus') }}s */
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
  .stats-row { gap: 10px; }
  .stat-card { min-width: 130px; }
  .form-grid { grid-template-columns: 1fr; }
  .detail-grid { grid-template-columns: 1fr; }
  .modal { max-width: 100%; max-height: 100vh; border-radius: 0; }
  .table thead th:nth-child(3), .table tbody td:nth-child(3),
  .table thead th:nth-child(6), .table tbody td:nth-child(6) { display: none; }
}
</style>
