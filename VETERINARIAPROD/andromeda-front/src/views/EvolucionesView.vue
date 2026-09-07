<template>
  <div class="page">

    <div class="page-header">
      <div class="page-header__left">
        <span class="page-emoji">📋</span>
        <div>
          <h2 class="page-title">{{ t('evolutions.title') }}</h2>
          <p class="page-sub">{{ t('evolutions.subtitle') }}</p>
        </div>
      </div>
      <button type="button" class="btn-primary" @click="openModal()">✏️ {{ t('evolutions.newEvolution') }}</button>
    </div>

    <div class="filters">
      <label for="evo-search" class="sr-only">{{ t('evolutions.searchPlaceholder') }}</label>
      <input id="evo-search" name="evo-search" v-model.trim="search" type="search" :placeholder="t('evolutions.searchPlaceholder')" class="filter-input filter-input--grow" @input="debouncedLoad()" />
      <label for="evo-date-from" class="sr-only">{{ t('evolutions.dateFrom') }}</label>
      <input id="evo-date-from" name="evo-date-from" v-model="dateFrom" type="date" class="filter-input" @change="load()" />
      <label for="evo-date-to" class="sr-only">{{ t('evolutions.dateTo') }}</label>
      <input id="evo-date-to" name="evo-date-to" v-model="dateTo" type="date" class="filter-input" @change="load()" />
    </div>

    <div v-if="loading" class="loading-state">
      <span class="spin spin--dark" /> {{ t('evolutions.loading') }}
    </div>
    <div v-else-if="error" class="alert alert--error">{{ error }}</div>

    <div v-else-if="items.length === 0" class="empty-state">
      <span class="empty-state__emoji">🐱</span>
      <p>{{ t('evolutions.empty') }}</p>
    </div>

    <div v-else class="evol-list">
      <div v-for="ev in items" :key="ev.id" class="evol-card">
        <div class="evol-card__aside">
          <span class="evol-card__emoji">{{ petEmoji(ev.species) }}</span>
          <div class="evol-card__meta">
            <strong>{{ ev.patient_name || '—' }}</strong>
            <span>{{ formatDate(ev.visit_date || ev.opened_at) }}</span>
          </div>
        </div>
        <div class="evol-card__body">
          <div class="evol-card__section" v-if="ev.chief_complaint">
            <span class="evol-tag evol-tag--blue">{{ t('evolutions.chiefComplaint') }}</span>
            <p>{{ ev.chief_complaint }}</p>
          </div>
          <div class="evol-card__vitals" v-if="ev.weight_kg || ev.temperature_celsius">
            <span v-if="ev.weight_kg" class="vital-chip">⚖️ {{ ev.weight_kg }} kg</span>
            <span v-if="ev.temperature_celsius" class="vital-chip">🌡️ {{ ev.temperature_celsius }}°C</span>
          </div>
        </div>
        <div class="evol-card__vet" v-if="ev.vet_name">
          <span>👨‍⚕️ {{ ev.vet_name }}</span>
          <span class="evol-status" :class="`status--${ev.status}`">{{ statusLabel(ev.status) }}</span>
        </div>
        <div class="appt-card__actions">
          <button type="button" class="btn-xs btn-xs--blue" @click="openDetail(ev)">Ver detalle</button>
        </div>
      </div>
    </div>

    <div v-if="pagination.totalPages > 1" class="pagination">
      <button type="button" :disabled="pagination.page <= 1" @click="load(pagination.page - 1)">← Ant.</button>
      <span>{{ pagination.page }} / {{ pagination.totalPages }}</span>
      <button :disabled="pagination.page >= pagination.totalPages" @click="load(pagination.page + 1)">Sig. →</button>
    </div>

    <Transition name="modal">
      <EvolutionDetailModal
        v-if="showDetail"
        :detail-loading="detailLoading"
        :detail-error="detailError"
        :detail-record="detailRecord"
        :related-orders-loading="relatedOrdersLoading"
        :related-orders="relatedOrders"
        :order-catalog-error="orderCatalogError"
        :detail-orders="detailOrders"
        :detail-action-saving="detailActionSaving"
        :detail-action-error="detailActionError"
        :detail-action-success="detailActionSuccess"
        :grouped-lab-tests="groupedLabTests"
        :loading-lab-tests="loadingLabTests"
        :imaging-types="imagingTypes"
        :loading-imaging-types="loadingImagingTypes"
        :hospitalization-professionals="hospitalizationProfessionals"
        :available-wards="availableWards"
        :wards-loading="wardsLoading"
        :free-kennels-for-detail-ward="freeKennelsForDetailWard"
        :grouped-surgery-types="groupedSurgeryTypes"
        :surgery-professionals="surgeryProfessionals"
        :loading-professionals="loadingProfessionals"
        :loading-surgery-types="loadingSurgeryTypes"
        :format-date="formatDate"
        :status-label="statusLabel"
        :pet-emoji="petEmoji"
        @close="closeDetail"
        @submit-lab="submitDetailLabOrder"
        @submit-imaging="submitDetailImagingOrder"
        @submit-hospitalization="submitDetailHospitalization"
        @submit-surgery="submitDetailSurgery"
      />
    </Transition>

    <!-- Modal nueva evolución -->
    <Transition name="modal">
      <div v-if="showModal" class="modal-backdrop" @click.self="closeModal()">
        <div class="modal">
          <div class="modal__header">
            <h3>📋 {{ t('evolutions.newModalTitle') }}</h3>
            <button type="button" class="modal__close" @click="closeModal()">✕</button>
          </div>

          <!-- Tabs -->
          <div class="tabs">
            <button v-for="(t, i) in tabs" :key="i" class="tab-btn" :class="{ 'tab-btn--active': activeTab === i }" @click="activeTab = i" type="button">
              {{ t.icon }} {{ t.label }}
            </button>
          </div>

          <form @submit.prevent="handleCreate" novalidate>
            <div class="form-body">
              <div v-if="orderCatalogError" class="alert alert--error" style="margin-bottom:12px">{{ orderCatalogError }}</div>

              <EvolutionIntakeTab
                :active="activeTab"
                :errors="fe"
                :form="form"
                :loading-history="loadingHistory"
                :patient-results="patientResults"
                :patient-search="patientSearch"
                :patient-searching="patientSearching"
                :patient-search-error="patientSearchError"
                :patient-searched="patientSearched"
                :saving="saving"
                :selected-patient-label="selectedPatientLabel"
                @search-patients="handleSearchPatients"
                @select-patient="handleSelectPatient"
              />

              <!-- TAB 2: Examen físico -->
              <div v-show="activeTab === 2">
                <div class="section-title">{{ t('evolutions.physicalExam') }}</div>
                <div class="form-grid">
                  <div class="field">
                    <label for="pe-mucous">{{ t('evolutions.mucousMembranes') }}</label>
                    <select id="pe-mucous" name="pe-mucous" v-model="form.mucousMembranes" :disabled="saving">
                      <option value="">{{ t('common.choose') }}</option>
                      <option value="rosadas humidas">Rosadas y húmedas (normal)</option>
                      <option value="palidas">Pálidas</option>
                      <option value="cianoticas">Cianóticas</option>
                      <option value="ictericas">Ictéricas</option>
                      <option value="congestionadas">Congestionadas</option>
                      <option value="secas">Secas</option>
                    </select>
                  </div>
                  <div class="field">
                    <label for="pe-hydration">{{ t('evolutions.hydrationStatus') }}</label>
                    <select id="pe-hydration" name="pe-hydration" v-model="form.hydrationStatus" :disabled="saving">
                      <option value="">{{ t('common.choose') }}</option>
                      <option value="normal">Normal (&lt; 5%)</option>
                      <option value="deshidratacion leve 5%">Deshidratación leve 5%</option>
                      <option value="deshidratacion moderada 8%">Deshidratación moderada 8%</option>
                      <option value="deshidratacion severa 10%">Deshidratación severa ≥10%</option>
                    </select>
                  </div>
                  <div class="field field--full">
                    <label for="pe-lymph">Ganglios linfáticos</label>
                    <input id="pe-lymph" name="pe-lymph" v-model.trim="form.lymphNodes" type="text" placeholder="Tamaño, consistencia, sensibilidad…" :disabled="saving" />
                  </div>
                  <div class="field field--full">
                    <label for="pe-skin">{{ t('evolutions.skinCoat') }}</label>
                    <input id="pe-skin" name="pe-skin" v-model.trim="form.skinCoat" type="text" :placeholder="t('evolutions.skinCoat')" :disabled="saving" />
                  </div>
                  <div class="field">
                    <label for="pe-eyes">Ojos</label>
                    <input id="pe-eyes" name="pe-eyes" v-model.trim="form.eyes" type="text" placeholder="Secreción, opacidad, reflejo pupilar…" :disabled="saving" />
                  </div>
                  <div class="field">
                    <label for="pe-ears">Oídos</label>
                    <input id="pe-ears" name="pe-ears" v-model.trim="form.ears" type="text" placeholder="Secreción, eritema, olor…" :disabled="saving" />
                  </div>
                  <div class="field">
                    <label for="pe-nose">Nariz y faringe</label>
                    <input id="pe-nose" name="pe-nose" v-model.trim="form.noseThroat" type="text" placeholder="Secreción nasal, mucosas, faringe…" :disabled="saving" />
                  </div>
                  <div class="field">
                    <label for="pe-oral">Cavidad oral</label>
                    <input id="pe-oral" name="pe-oral" v-model.trim="form.oralCavity" type="text" placeholder="Dientes, encías, lengua, sarro…" :disabled="saving" />
                  </div>
                  <div class="field field--full">
                    <label for="pe-cardio">Cardiovascular</label>
                    <input id="pe-cardio" name="pe-cardio" v-model.trim="form.cardiovascular" type="text" placeholder="Ritmo cardíaco, soplos, calidad de pulso…" :disabled="saving" />
                  </div>
                  <div class="field field--full">
                    <label for="pe-resp">Respiratorio</label>
                    <input id="pe-resp" name="pe-resp" v-model.trim="form.respiratory" type="text" placeholder="Murmullo vesicular, crepitantes, sibilancias, patrón respiratorio…" :disabled="saving" />
                  </div>
                  <div class="field field--full">
                    <label for="pe-abdomen">Abdomen</label>
                    <input id="pe-abdomen" name="pe-abdomen" v-model.trim="form.abdomen" type="text" placeholder="Palpación, dolor, órganos palpables, masas, distensión…" :disabled="saving" />
                  </div>
                  <div class="field field--full">
                    <label for="pe-musculo">Sistema musculoesquelético</label>
                    <input id="pe-musculo" name="pe-musculo" v-model.trim="form.musculoskeletal" type="text" placeholder="Postura, masa muscular, movilidad articular, claudicación…" :disabled="saving" />
                  </div>
                  <div class="field field--full">
                    <label for="pe-neuro">Sistema neurológico</label>
                    <input id="pe-neuro" name="pe-neuro" v-model.trim="form.neurological" type="text" :placeholder="t('evolutions.neurological')" :disabled="saving" />
                  </div>
                  <div class="field field--full">
                    <label for="pe-urogenital">Sistema urogenital</label>
                    <input id="pe-urogenital" name="pe-urogenital" v-model.trim="form.urogenital" type="text" placeholder="Riñones, vejiga, genitales externos…" :disabled="saving" />
                  </div>
                  <div class="field field--full">
                    <label for="pe-pain">Evaluación del dolor</label>
                    <input id="pe-pain" name="pe-pain" v-model.trim="form.painAssessment" type="text" placeholder="Escala 0–10, localización, tipo de dolor…" :disabled="saving" />
                  </div>
                  <div class="field field--full">
                    <label for="pe-general">Observaciones generales del examen físico</label>
                    <textarea id="pe-general" name="pe-general" v-model.trim="form.generalObservations" rows="3" :placeholder="t('evolutions.generalObservations')" :disabled="saving" />
                  </div>
                </div>
              </div>

              <!-- TAB 3: Diagnóstico -->
              <div v-show="activeTab === 3">
                <div class="section-title">{{ t('evolutions.diagnosis') }}</div>
                <div class="form-grid">
                  <div class="field field--full">
                    <label for="dx-name">Nombre del diagnóstico</label>
                    <input id="dx-name" name="dx-name" v-model.trim="form.diagnosisName" type="text" :placeholder="t('evolutions.diagnosisNamePlaceholder')" :disabled="saving" />
                  </div>
                  <div class="field">
                    <label for="dx-type">{{ t('evolutions.diagnosisType') }}</label>
                    <select id="dx-type" name="dx-type" v-model="form.diagnosisType" :disabled="saving">
                      <option value="presumptive">{{ t('evolutions.diagnosisTypePresumptive') }}</option>
                      <option value="definitive">{{ t('evolutions.diagnosisTypeDefinitive') }}</option>
                      <option value="differential">{{ t('evolutions.diagnosisTypeDifferential') }}</option>
                      <option value="rule_out">{{ t('evolutions.diagnosisTypeRuleOut') }}</option>
                    </select>
                  </div>
                  <div class="field">
                    <label for="dx-code">{{ t('evolutions.diagnosisCode') }}</label>
                    <input id="dx-code" name="dx-code" v-model.trim="form.diagnosisCode" type="text" :placeholder="t('evolutions.diagnosisCodePlaceholder')" :disabled="saving" />
                  </div>
                  <div class="field">
                    <label for="dx-prognosis">{{ t('evolutions.prognosis') }}</label>
                    <select id="dx-prognosis" name="dx-prognosis" v-model="form.prognosis" :disabled="saving">
                      <option value="">{{ t('common.choose') }}</option>
                      <option value="excellent">{{ t('evolutions.prognosisExcellent') }}</option>
                      <option value="good">{{ t('evolutions.prognosisGood') }}</option>
                      <option value="fair">{{ t('evolutions.prognosisFair') }}</option>
                      <option value="guarded">{{ t('evolutions.prognosisGuarded') }}</option>
                      <option value="poor">{{ t('evolutions.prognosisPoor') }}</option>
                      <option value="grave">{{ t('evolutions.prognosisGrave') }}</option>
                    </select>
                  </div>
                  <div class="field field--full">
                    <label class="checkbox-label" style="flex-direction:row;align-items:center;gap:8px">
                      <input id="dx-primary" name="dx-primary" type="checkbox" v-model="form.isPrimary" :disabled="saving" />
                      {{ t('evolutions.primaryDiagnosis') }}
                    </label>
                  </div>
                  <div class="field field--full">
                    <label for="dx-notes">{{ t('evolutions.diagnosisNotes') }}</label>
                    <textarea id="dx-notes" name="dx-notes" v-model.trim="form.diagnosisNotes" rows="3" :placeholder="t('evolutions.diagnosisNotes')" :disabled="saving" />
                  </div>
                </div>
              </div>

              <!-- TAB 4: Tratamientos -->
              <div v-show="activeTab === 4">
                <div class="section-title">{{ t('evolutions.treatment') }}</div>
                <div class="form-grid">
                  <div class="field">
                    <label for="tx-type">{{ t('evolutions.treatmentType') }}</label>
                    <select id="tx-type" name="tx-type" v-model="form.treatment.treatmentType" :disabled="saving">
                      <option value="">{{ t('common.choose') }}</option>
                      <option value="medication">{{ t('evolutions.treatmentTypeMedication') }}</option>
                      <option value="procedure">{{ t('evolutions.treatmentTypeProcedure') }}</option>
                      <option value="surgery_ref">{{ t('evolutions.treatmentTypeSurgeryRef') }}</option>
                      <option value="specialist_ref">{{ t('evolutions.treatmentTypeSpecialistRef') }}</option>
                      <option value="diagnostic">{{ t('evolutions.treatmentTypeDiagnostic') }}</option>
                      <option value="nursing">{{ t('evolutions.treatmentTypeNursing') }}</option>
                      <option value="physical_therapy">{{ t('evolutions.treatmentTypePhysicalTherapy') }}</option>
                      <option value="other">{{ t('evolutions.other') }}</option>
                    </select>
                  </div>
                  <div class="field">
                    <label for="tx-start">{{ t('evolutions.treatmentStart') }}</label>
                    <input id="tx-start" name="tx-start" v-model="form.treatment.startDate" type="date" :disabled="saving" />
                  </div>
                  <div class="field field--full">
                    <label for="tx-desc">{{ t('evolutions.treatmentDescription') }}</label>
                    <textarea id="tx-desc" name="tx-desc" v-model.trim="form.treatment.description" rows="2" :placeholder="t('evolutions.treatmentDescription')" :disabled="saving" />
                  </div>
                  <div class="field">
                    <label for="tx-dose">{{ t('evolutions.dose') }}</label>
                    <input id="tx-dose" name="tx-dose" v-model.trim="form.treatment.dose" type="text" :placeholder="t('evolutions.dosePlaceholder')" :disabled="saving" />
                  </div>
                  <div class="field">
                    <label for="tx-dose-unit">{{ t('evolutions.doseUnit') }}</label>
                    <input id="tx-dose-unit" name="tx-dose-unit" v-model.trim="form.treatment.doseUnit" type="text" :placeholder="t('evolutions.doseUnitPlaceholder')" :disabled="saving" />
                  </div>
                  <div class="field">
                    <label for="tx-freq">{{ t('evolutions.frequency') }}</label>
                    <input id="tx-freq" name="tx-freq" v-model.trim="form.treatment.frequency" type="text" :placeholder="t('evolutions.frequencyPlaceholder')" :disabled="saving" />
                  </div>
                  <div class="field">
                    <label for="tx-route">{{ t('evolutions.route') }}</label>
                    <select id="tx-route" name="tx-route" v-model="form.treatment.route" :disabled="saving">
                      <option value="">{{ t('common.choose') }}</option>
                      <option value="oral">{{ t('evolutions.routeOral') }}</option>
                      <option value="iv">{{ t('evolutions.routeIv') }}</option>
                      <option value="im">{{ t('evolutions.routeIm') }}</option>
                      <option value="sc">{{ t('evolutions.routeSc') }}</option>
                      <option value="topical">{{ t('evolutions.routeTopical') }}</option>
                      <option value="inhalation">{{ t('evolutions.routeInhalation') }}</option>
                      <option value="ophthalmic">{{ t('evolutions.routeOphthalmic') }}</option>
                      <option value="otic">{{ t('evolutions.routeOtic') }}</option>
                      <option value="rectal">{{ t('evolutions.routeRectal') }}</option>
                      <option value="other">{{ t('evolutions.routeOther') }}</option>
                    </select>
                  </div>
                  <div class="field">
                    <label for="tx-duration">{{ t('evolutions.durationDays') }}</label>
                    <input id="tx-duration" name="tx-duration" v-model.number="form.treatment.durationDays" type="number" min="1" placeholder="7" :disabled="saving" />
                  </div>
                  <div class="field field--full">
                    <label for="tx-notes">{{ t('evolutions.treatmentNotes') }}</label>
                    <textarea id="tx-notes" name="tx-notes" v-model.trim="form.treatment.notes" rows="2" :placeholder="t('evolutions.treatmentNotes')" :disabled="saving" />
                  </div>
                </div>
              </div>

              <EvolutionOrdersTab
                :active="activeTab === 5"
                :available-wards="availableWards"
                :form="form"
                :free-kennels-for-evolution-ward="freeKennelsForEvolutionWard"
                :grouped-lab-tests="groupedLabTests"
                :grouped-surgery-types="groupedSurgeryTypes"
                :hospitalization-professionals="hospitalizationProfessionals"
                :imaging-types="imagingTypes"
                :loading-imaging-types="loadingImagingTypes"
                :loading-lab-tests="loadingLabTests"
                :loading-professionals="loadingProfessionals"
                :loading-surgery-types="loadingSurgeryTypes"
                :saving="saving"
                :surgery-professionals="surgeryProfessionals"
                :wards-loading="wardsLoading"
              />

              <EvolutionPrescriptionTab
                :active="activeTab === 6"
                :form="form"
                :new-rx-item="newRxItem"
                :saving="saving"
                @add-item="addRxItem"
                @remove-item="removeRxItem"
              />

            </div>

            <div v-if="saveError" class="alert alert--error mx">{{ saveError }}</div>

            <div class="modal__actions">
              <div class="tab-nav-btns">
                <button type="button" class="btn-ghost btn-sm" @click="activeTab = Math.max(0, activeTab - 1)" :disabled="activeTab === 0">{{ t('evolutions.previous') }}</button>
                <button type="button" class="btn-ghost btn-sm" @click="activeTab = Math.min(tabs.length - 1, activeTab + 1)" :disabled="activeTab === tabs.length - 1">{{ t('evolutions.next') }}</button>
              </div>
              <div style="display:flex;gap:10px">
                <button type="button" class="btn-ghost" @click="closeModal()" :disabled="saving">{{ t('evolutions.cancel') }}</button>
                <button type="submit" class="btn-primary" :disabled="saving">
                  <span v-if="saving" class="spin spin--sm" />
                  <span v-else>💾 {{ t('evolutions.saveEvolution') }}</span>
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { computed, ref, reactive, onMounted, onUnmounted } from 'vue'
import { t } from '../i18n'
import { useAuthStore } from '../stores/auth'
import { extractDetailedErrorMessage, logError } from '../utils/errors'
import EvolutionOrdersTab from '../components/evolutions/EvolutionOrdersTab.vue'
import EvolutionPrescriptionTab from '../components/evolutions/EvolutionPrescriptionTab.vue'
import EvolutionDetailModal from '../components/evolutions/EvolutionDetailModal.vue'
import {
  addPrescriptionItem,
  createMedicalRecordWithAttachments as createMedicalRecordWithAttachmentsRequest,
  extractEvolutionError,
  getMedicalRecordDetail as getMedicalRecordDetailRequest,
  loadOrderCatalogs as loadOrderCatalogsRequest,
  loadPatientHistoryForEvolutions as loadPatientHistoryRequest,
  loadProfessionalsForEvolutions as loadProfessionalsRequest,
  loadRelatedOrders as loadRelatedOrdersRequest,
  listMedicalRecords as listMedicalRecordsRequest,
  makeDetailOrdersForm,
  makeEvolutionsForm,
  makePrescriptionItemDraft,
  preferredProfessionalId,
  prefillProfessionalFields,
  searchPatients as searchPatientsRequest,
  removePrescriptionItem,
  submitDetailHospitalization as submitDetailHospitalizationRequest,
  submitDetailImagingOrder as submitDetailImagingOrderRequest,
  submitDetailLabOrder as submitDetailLabOrderRequest,
  submitDetailSurgery as submitDetailSurgeryRequest,
  validateEvolutionsForm,
} from '../composables/evolutions/useEvolutionsDomain'

const items      = ref([])
const loading    = ref(false)
const error      = ref('')
const showDetail = ref(false)
const detailLoading = ref(false)
const detailError = ref('')
const detailRecord = ref(null)
const search     = ref('')
const dateFrom   = ref('')
const dateTo     = ref('')
const pagination = ref({ page: 1, totalPages: 1 })
const auth = useAuthStore()
const HOSPITALIZATION_ROLES = ['veterinarian', 'surgeon', 'tele_vet']
const SURGERY_ROLES = ['veterinarian', 'surgeon']

const tabs = [
  { label: t('evolutions.generalData'), icon: '📝' },
  { label: t('evolutions.history'), icon: '🗒️'  },
  { label: t('evolutions.physicalExam'), icon: '🔬' },
  { label: t('evolutions.diagnosis'), icon: '🩺' },
  { label: t('evolutions.treatment'), icon: '💊' },
  { label: 'Órdenes', icon: '🧪' },
  { label: t('evolutions.prescription'), icon: '📄' },
]
const activeTab = ref(0)
const labTests = ref([])
const imagingTypes = ref([])
const surgeryTypes = ref([])
const loadingLabTests = ref(false)
const loadingImagingTypes = ref(false)
const loadingSurgeryTypes = ref(false)
const availableWards = ref([])
const wardsLoading = ref(false)
const orderCatalogErrors = reactive({
  labTests: '',
  imagingTypes: '',
  surgeryTypes: '',
  wards: '',
})
const professionals = ref([])
const loadingProfessionals = ref(false)

const groupedLabTests = computed(() => {
  const groups = {}
  labTests.value.forEach((test) => {
    const category = test.category || 'General'
    if (!groups[category]) groups[category] = []
    groups[category].push(test)
  })
  return groups
})

const freeKennelsForEvolutionWard = computed(() => {
  if (!form.hospitalizationOrder.wardId) return []
  const ward = availableWards.value.find((entry) => entry.id === form.hospitalizationOrder.wardId)
  if (!ward || !ward.kennels) return []
  return ward.kennels.filter((kennel) => kennel.status === 'available' || kennel.status === 'free')
})

const groupedSurgeryTypes = computed(() => {
  const groups = {}
  surgeryTypes.value.forEach((type) => {
    const category = type.category || 'General'
    if (!groups[category]) groups[category] = []
    groups[category].push(type)
  })
  return groups
})

const orderCatalogError = computed(() => Object.values(orderCatalogErrors).filter(Boolean).join(' | '))

const hospitalizationProfessionals = computed(() =>
  professionals.value.filter((entry) => entry.roles.some((role) => HOSPITALIZATION_ROLES.includes(role)))
)

const surgeryProfessionals = computed(() =>
  professionals.value.filter((entry) => entry.roles.some((role) => SURGERY_ROLES.includes(role)))
)

const freeKennelsForDetailWard = computed(() => {
  if (!detailOrders.hospitalization.wardId) return []
  const ward = availableWards.value.find((entry) => entry.id === detailOrders.hospitalization.wardId)
  if (!ward || !ward.kennels) return []
  return ward.kennels.filter((kennel) => kennel.status === 'available' || kennel.status === 'free')
})

function petEmoji(s) {
  if (!s) return '🐾'
  const sl = s.toLowerCase()
  const m = { perro:'🐶', dog:'🐶', gato:'🐱', cat:'🐱', conejo:'🐰', rabbit:'🐰', loro:'🦜', bird:'🦜', pez:'🐟', fish:'🐟', tortuga:'🐢', reptile:'🦎', hamster:'🐹' }
  return m[sl] || '🐾'
}

function statusLabel(s) {
  const map = { open: 'Abierta', signed: 'Firmada', amended: 'Enmendada' }
  return map[s] || s || '—'
}

// Patient autocomplete
const patientSearch        = ref('')
const patientResults       = ref([])
const patientSearching     = ref(false)
const patientSearchError   = ref('')
const patientSearched      = ref(false)
const selectedPatientLabel = ref('')
const loadingHistory       = ref(false)
let patientTimer = null

async function searchPatients() {
  clearTimeout(patientTimer)
  form.patientId = ''
  selectedPatientLabel.value = ''
  patientSearchError.value = ''
  const q = patientSearch.value.trim()
  if (q.length < 2) { patientResults.value = []; patientSearched.value = false; patientSearching.value = false; return }
  patientSearching.value = true
  patientTimer = setTimeout(async () => {
    try {
      patientResults.value = await searchPatientsRequest(q)
      patientSearched.value = true
    } catch (error) {
      logError('evoluciones.searchPatients', error, { search: q })
      patientResults.value = []
      patientSearched.value = true
      patientSearchError.value = extractEvolutionError(error, 'No se pudo buscar pacientes. Reintentá en unos segundos.')
    } finally {
      patientSearching.value = false
    }
  }, 300)
}

function handleSearchPatients(value) {
  patientSearch.value = value
  searchPatients()
}

async function selectPatient(pt) {
  form.patientId = pt.id
  selectedPatientLabel.value = `${pt.name}${pt.hc_number ? ' · HC ' + pt.hc_number : ''}${pt.primary_owner ? ' — ' + pt.primary_owner : ''}`
  patientSearch.value = pt.name
  patientResults.value = []

  // TAB 0 (Datos generales) trae datos del paciente: peso y condición corporal actuales.
  if (pt.weight_kg != null && pt.weight_kg !== '') form.weightKg = Number(pt.weight_kg)
  if (pt.body_condition_score != null && pt.body_condition_score !== '') form.bodyConditionScore = Number(pt.body_condition_score)

  // TAB 1 (Anamnesis) trae el historial del paciente (vacunas, desparasitación, cirugías).
  // Son campos de texto: usar '' como fallback, no [].
  loadingHistory.value = true
  try {
    const history = await loadPatientHistoryRequest(pt.id)
    form.vaccinationHistory = history?.vaccinationHistory ?? ''
    form.dewormingHistory = history?.dewormingHistory ?? ''
    form.previousSurgeries = history?.previousSurgeries ?? ''
  } catch (error) {
    logError('evoluciones.loadHistory', error, { patientId: pt?.id })
  }
  finally { loadingHistory.value = false }
}

function handleSelectPatient(pt) {
  selectPatient(pt)
}

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

async function load(page = 1) {
  loading.value = true; error.value = ''
  try {
    const payload = await listMedicalRecordsRequest({ page, search: search.value, from: dateFrom.value, to: dateTo.value })
    let rows = payload.rows
    const needle = search.value.trim().toLowerCase()
    if (needle) {
      rows = rows.filter((row) => [row.patient_name, row.chief_complaint, row.vet_name]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)));
    }
    if (dateFrom.value || dateTo.value) {
      rows = rows.filter((row) => {
        const source = row.visit_date || row.opened_at;
        if (!source) return false;
        const day = new Date(source).toISOString().slice(0, 10);
        if (dateFrom.value && day < dateFrom.value) return false;
        if (dateTo.value && day > dateTo.value) return false;
        return true;
      });
    }
    items.value = rows
    pagination.value = payload.meta
  } catch (e) {
    logError('evoluciones.load', e)
    error.value = extractDetailedErrorMessage(e, 'No se pudieron cargar las evoluciones', { context: 'Carga de evoluciones' })
  } finally { loading.value = false }
}

async function openDetail(record) {
  showDetail.value = true
  detailLoading.value = true
  detailError.value = ''
  detailActionError.value = ''
  detailActionSuccess.value = ''
  relatedOrders.lab = []
  relatedOrders.imaging = []
  relatedOrders.surgeries = []
  relatedOrders.hospitalizations = []
  Object.assign(detailOrders, makeDetailOrdersForm())
  detailRecord.value = record
  try {
    await Promise.all([loadOrderCatalogs(), loadProfessionals()])
    detailRecord.value = await getMedicalRecordDetailRequest(record.id)
    detailOrders.lab.clinicalNotes = detailRecord.value?.chief_complaint || ''
    detailOrders.imaging.clinicalIndication = detailRecord.value?.chief_complaint || ''
    detailOrders.hospitalization.admissionDiagnosis = detailRecord.value?.chief_complaint || ''
    detailOrders.surgery.preoperativeDiagnosis = detailRecord.value?.chief_complaint || ''
    detailOrders.hospitalization.responsibleVetId = preferredProfessionalId(hospitalizationProfessionals.value, auth)
    detailOrders.surgery.leadSurgeonId = preferredProfessionalId(surgeryProfessionals.value, auth)
    detailOrders.surgery.scheduledDate = new Date().toISOString().slice(0, 10)
    const related = await loadRelatedOrdersRequest(detailRecord.value)
    relatedOrders.lab = related.lab
    relatedOrders.imaging = related.imaging
    relatedOrders.surgeries = related.surgeries
    relatedOrders.hospitalizations = related.hospitalizations
  } catch (e) {
    logError('evoluciones.openDetail', e, { recordId: record?.id })
    detailError.value = extractDetailedErrorMessage(e, 'No se pudo cargar el detalle de la ficha', { context: 'Detalle de evolucion' })
  } finally {
    detailLoading.value = false
  }
}

function closeDetail() {
  showDetail.value = false
  detailError.value = ''
  detailActionError.value = ''
  detailActionSuccess.value = ''
  detailRecord.value = null
  relatedOrders.lab = []
  relatedOrders.imaging = []
  relatedOrders.surgeries = []
  relatedOrders.hospitalizations = []
}

let timer = null
function debouncedLoad() { clearTimeout(timer); timer = setTimeout(load, 350) }

const showModal = ref(false)
const saving    = ref(false)
const saveError = ref('')

async function loadOrderCatalogs() {
  if (!labTests.value.length || !imagingTypes.value.length || !surgeryTypes.value.length || !availableWards.value.length) {
    loadingLabTests.value = !labTests.value.length
    loadingImagingTypes.value = !imagingTypes.value.length
    loadingSurgeryTypes.value = !surgeryTypes.value.length
    wardsLoading.value = !availableWards.value.length
    try {
      const catalogs = await loadOrderCatalogsRequest()
      if (!labTests.value.length) {
        orderCatalogErrors.labTests = ''
        labTests.value = catalogs.labTests
      }
      if (!imagingTypes.value.length) {
        orderCatalogErrors.imagingTypes = ''
        imagingTypes.value = catalogs.imagingTypes
      }
      if (!surgeryTypes.value.length) {
        orderCatalogErrors.surgeryTypes = ''
        surgeryTypes.value = catalogs.surgeryTypes
      }
      if (!availableWards.value.length) {
        orderCatalogErrors.wards = ''
        availableWards.value = catalogs.availableWards
      }
    } catch (error) {
      if (!labTests.value.length) orderCatalogErrors.labTests = `Laboratorio: ${extractEvolutionError(error, 'No se pudieron cargar las pruebas')}`
      if (!imagingTypes.value.length) orderCatalogErrors.imagingTypes = `Imágenes: ${extractEvolutionError(error, 'No se pudieron cargar los tipos de estudio')}`
      if (!surgeryTypes.value.length) orderCatalogErrors.surgeryTypes = `Cirugías: ${extractEvolutionError(error, 'No se pudieron cargar los tipos de cirugía')}`
      if (!availableWards.value.length) orderCatalogErrors.wards = `Internación: ${extractEvolutionError(error, 'No se pudieron cargar las salas y jaulas')}`
    } finally {
      loadingLabTests.value = false
      loadingImagingTypes.value = false
      loadingSurgeryTypes.value = false
      wardsLoading.value = false
    }
  }
}

async function loadProfessionals() {
  loadingProfessionals.value = true
  try {
    professionals.value = await loadProfessionalsRequest(auth)
  } catch (error) {
    logError('evoluciones.loadProfessionals', error)
    professionals.value = []
  } finally {
    loadingProfessionals.value = false
  }
}

const newRxItem = reactive(makePrescriptionItemDraft())
const detailOrders = reactive(makeDetailOrdersForm())
const detailActionSaving = ref(false)
const detailActionError = ref('')
const detailActionSuccess = ref('')
const relatedOrdersLoading = ref(false)
const relatedOrders = reactive({
  lab: [],
  imaging: [],
  hospitalizations: [],
  surgeries: [],
})
const fe = reactive({})
const form = reactive(makeEvolutionsForm())
const addRxItem = () => addPrescriptionItem(form, newRxItem)
const removeRxItem = (idx) => removePrescriptionItem(form, idx)

async function openModal() {
  Object.assign(form, makeEvolutionsForm())
  patientSearch.value        = ''
  patientResults.value       = []
  selectedPatientLabel.value = ''
  saveError.value            = ''
  Object.keys(fe).forEach(k => delete fe[k])
  activeTab.value = 0
  showModal.value = true
  await Promise.all([loadOrderCatalogs(), loadProfessionals()])
  prefillProfessionalFields(form, hospitalizationProfessionals.value, surgeryProfessionals.value, auth)
}
function closeModal() { showModal.value = false }

function validate() {
  const valid = validateEvolutionsForm(form, fe)
  if (!valid) activeTab.value = 0
  return valid
}

async function runDetailAction(action) {
  if (!detailRecord.value?.id || !detailRecord.value?.patient_id) return
  detailActionSaving.value = true
  detailActionError.value = ''
  detailActionSuccess.value = ''
  try {
    await action()
    detailActionSuccess.value = 'Acción clínica registrada'
    detailRecord.value = await getMedicalRecordDetailRequest(detailRecord.value.id)
    const related = await loadRelatedOrdersRequest(detailRecord.value)
    relatedOrders.lab = related.lab
    relatedOrders.imaging = related.imaging
    relatedOrders.surgeries = related.surgeries
    relatedOrders.hospitalizations = related.hospitalizations
  } catch (e) {
    detailActionError.value = extractEvolutionError(e, 'No se pudo registrar la acción clínica.')
  } finally {
    detailActionSaving.value = false
  }
}

async function submitDetailLabOrder() {
  await runDetailAction(async () => {
    await submitDetailLabOrderRequest(detailRecord.value, detailOrders)
    Object.assign(detailOrders.lab, { tests: [], priority: 'routine', clinicalNotes: detailRecord.value.chief_complaint || '' })
  })
}

async function submitDetailImagingOrder() {
  await runDetailAction(async () => {
    await submitDetailImagingOrderRequest(detailRecord.value, detailOrders)
    Object.assign(detailOrders.imaging, {
      imagingTypeId: '',
      priority: 'routine',
      clinicalIndication: detailRecord.value.chief_complaint || '',
      bodyRegion: '',
      sedationRequired: false,
    })
  })
}

async function submitDetailHospitalization() {
  await runDetailAction(async () => {
    await submitDetailHospitalizationRequest(detailRecord.value, detailOrders)
    Object.assign(detailOrders.hospitalization, {
      responsibleVetId: preferredProfessionalId(hospitalizationProfessionals.value, auth),
      wardId: '',
      kennelId: '',
      hospitalizationReason: '',
      admissionDiagnosis: detailRecord.value.chief_complaint || '',
      admissionWeight: '',
      estimatedDischargeDate: '',
      specialInstructions: '',
    })
  })
}

async function submitDetailSurgery() {
  await runDetailAction(async () => {
    await submitDetailSurgeryRequest(detailRecord.value, detailOrders)
    Object.assign(detailOrders.surgery, {
      surgeryTypeId: '',
      leadSurgeonId: preferredProfessionalId(surgeryProfessionals.value, auth),
      scheduledDate: new Date().toISOString().slice(0, 10),
      startTime: '',
      urgency: 'elective',
      preoperativeDiagnosis: detailRecord.value.chief_complaint || '',
      surgicalApproach: '',
      notes: '',
    })
  })
}

async function handleCreate() {
  if (!validate()) return
  saving.value = true; saveError.value = ''
  try {
    await createMedicalRecordWithAttachmentsRequest(form)

    closeModal()
    await load()
  } catch (e) {
    saveError.value = extractEvolutionError(e, 'No se pudo guardar la evolución.')
  } finally { saving.value = false }
}

onMounted(load)
onUnmounted(() => {
  clearTimeout(timer)
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

.filters { display: flex; gap: 10px; flex-wrap: wrap; }
.filter-input { padding: 9px 13px; border: 1.5px solid var(--border); border-radius: var(--radius); font-size: 0.87rem; background: var(--white); color: var(--text); outline: none; }
.filter-input:focus { border-color: var(--primary); }
.filter-input--grow { flex: 1; min-width: 200px; }

.evol-list { display: flex; flex-direction: column; gap: 12px; }
.evol-card { background: var(--white); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); overflow: hidden; display: grid; grid-template-columns: 130px 1fr; grid-template-rows: auto auto; transition: box-shadow var(--transition); }
.evol-card:hover { box-shadow: var(--shadow); }
.evol-card__aside { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 16px 12px; background: var(--surface-2); gap: 8px; border-right: 1px solid var(--border); grid-row: 1 / 3; }
.evol-card__emoji { font-size: 2.2rem; }
.evol-card__meta { text-align: center; }
.evol-card__meta strong { display: block; font-size: 0.9rem; color: var(--text); }
.evol-card__meta span   { font-size: 0.75rem; color: var(--text-3); }
.evol-card__body { padding: 14px 16px; display: flex; flex-direction: column; gap: 8px; }
.evol-card__section { display: flex; align-items: flex-start; gap: 8px; }
.evol-card__section p { font-size: 0.87rem; color: var(--text-2); line-height: 1.5; flex: 1; }
.evol-card__vitals { display: flex; gap: 8px; flex-wrap: wrap; }
.vital-chip { font-size: 0.78rem; background: var(--surface-2); border: 1px solid var(--border); border-radius: 20px; padding: 2px 10px; color: var(--text-2); }
.evol-card__vet { padding: 8px 16px; border-top: 1px solid var(--border); font-size: 0.78rem; color: var(--text-3); background: var(--surface); grid-column: 2; display: flex; align-items: center; justify-content: space-between; }
.evol-status { font-size: 0.72rem; text-transform: capitalize; background: var(--surface-2); padding: 2px 8px; border-radius: 20px; }
.status--open    { background: #D6F3EC; color: #1A9E7F; }
.status--signed  { background: #D6EEFF; color: #1A5FAA; }
.status--amended { background: #FFF3CC; color: #8A6200; }

.evol-tag { display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 0.7rem; font-weight: 700; white-space: nowrap; flex-shrink: 0; }
.evol-tag--blue { background: #D6EEFF; color: #1A5FAA; }

.pagination { display: flex; align-items: center; justify-content: center; gap: 16px; font-size: 0.85rem; color: var(--text-2); }
.pagination button { padding: 6px 14px; border: 1.5px solid var(--border); border-radius: var(--radius-sm); background: none; cursor: pointer; font-size: 0.82rem; color: var(--text-2); }
.pagination button:hover:not(:disabled) { background: var(--surface-2); }
.pagination button:disabled { opacity: 0.4; cursor: not-allowed; }

.btn-primary { padding: 10px 20px; background: linear-gradient(135deg, var(--primary) 0%, var(--accent-mint) 100%); color: white; border: none; border-radius: var(--radius); font-size: 0.9rem; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: opacity var(--transition), transform var(--transition); }
.btn-primary:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
.btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
.btn-ghost { padding: 10px 20px; background: none; border: 1.5px solid var(--border); border-radius: var(--radius); color: var(--text-2); font-size: 0.9rem; font-weight: 500; cursor: pointer; transition: background var(--transition); }
.btn-ghost:hover:not(:disabled) { background: var(--surface-2); }
.btn-sm { padding: 7px 14px; font-size: 0.82rem; }

.modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 16px; }
.modal { background: var(--white); border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); width: 100%; max-width: 860px; max-height: 92vh; overflow-y: auto; display: flex; flex-direction: column; }
.modal__header { display: flex; align-items: center; justify-content: space-between; padding: 20px 24px 14px; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: var(--white); z-index: 2; }
.modal__header h3 { font-size: 1.1rem; font-weight: 700; color: var(--text); }
.modal__close { background: none; border: none; cursor: pointer; font-size: 1rem; color: var(--text-3); padding: 4px 8px; border-radius: var(--radius-sm); }
.modal__close:hover { background: var(--surface-2); }

.tabs { display: flex; border-bottom: 2px solid var(--border); background: var(--white); position: sticky; top: 61px; z-index: 1; padding: 0 24px; overflow-x: auto; }
.tab-btn { padding: 10px 18px; background: none; border: none; border-bottom: 2px solid transparent; margin-bottom: -2px; cursor: pointer; font-size: 0.85rem; font-weight: 500; color: var(--text-3); transition: color 0.15s, border-color 0.15s; white-space: nowrap; }
.tab-btn:hover { color: var(--text); }
.tab-btn--active { color: var(--primary); border-bottom-color: var(--primary); font-weight: 700; }

.form-body { padding: 20px 24px 4px; flex: 1; }
.section-title { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-3); margin-bottom: 10px; padding-bottom: 4px; border-bottom: 1px solid var(--border); }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.field { display: flex; flex-direction: column; gap: 4px; }
.field label { font-size: 0.8rem; font-weight: 600; color: var(--text-2); }
.field input, .field select, .field textarea { padding: 8px 11px; border: 1.5px solid var(--border); border-radius: var(--radius); font-size: 0.88rem; color: var(--text); background: var(--surface); outline: none; transition: border-color var(--transition); }
.field input:focus, .field select:focus, .field textarea:focus { border-color: var(--primary); background: var(--white); }
.field textarea { resize: vertical; }
.field--full { grid-column: 1 / -1; }
.field-error { font-size: 0.73rem; color: var(--danger); }
.req { color: var(--danger); }

.checkbox-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.checkbox-label { display: flex; align-items: center; gap: 7px; font-size: 0.86rem; color: var(--text-2); cursor: pointer; padding: 6px 10px; border: 1.5px solid var(--border); border-radius: var(--radius); transition: background 0.12s; }
.checkbox-label:hover { background: var(--surface-2); }
.checkbox-label input[type="checkbox"] { width: 15px; height: 15px; cursor: pointer; }

.modal__actions { display: flex; align-items: center; justify-content: space-between; padding: 14px 24px 20px; border-top: 1px solid var(--border); gap: 12px; position: sticky; bottom: 0; background: var(--white); z-index: 1; }
.tab-nav-btns { display: flex; gap: 8px; }

.alert { padding: 10px 14px; border-radius: var(--radius-sm); font-size: 0.875rem; }
.alert--error { background: #FDEAEA; color: #c0392b; border-left: 3px solid var(--danger); }
.alert--success { background: #D6F3EC; color: #1A9E7F; border-left: 3px solid #1A9E7F; }
.mx { margin: 0 24px 8px; }
.loading-state, .empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 60px 20px; color: var(--text-3); font-size: 0.9rem; background: var(--white); border-radius: var(--radius-xl); box-shadow: var(--shadow-sm); }
.empty-state__emoji { font-size: 3rem; }
.spin { width: 20px; height: 20px; border: 2px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: spin 0.7s linear infinite; display: inline-block; }
.spin--sm { width: 14px; height: 14px; }
.spin--dark { border-color: rgba(0,0,0,0.1); border-top-color: var(--primary); }
@keyframes spin { to { transform: rotate(360deg); } }
.modal-enter-active, .modal-leave-active { transition: opacity 0.2s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
.autocomplete { position: absolute; z-index: 100; background: var(--white); border: 1.5px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); width: 100%; max-height: 200px; overflow-y: auto; top: 100%; left: 0; }
.autocomplete__item { padding: 9px 13px; cursor: pointer; font-size: 0.88rem; }
.autocomplete__item:hover { background: var(--surface-2); }
.autocomplete__owner { font-size: 0.78rem; color: var(--text-3); }
.selected-patient { margin-top: 5px; font-size: 0.82rem; color: var(--primary); font-weight: 500; }
.history-loading { margin-left: 8px; font-size: 0.75rem; color: var(--text-3); font-weight: 400; }
.history-empty   { margin-left: 8px; font-size: 0.75rem; color: var(--text-3); font-style: italic; font-weight: 400; }
.tests-catalog { display: flex; flex-direction: column; gap: 10px; }
.test-category { background: var(--surface); border: 1.5px solid var(--border); border-radius: var(--radius); padding: 10px 12px; }
.test-category__title { font-size: 0.76rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-3); margin-bottom: 8px; }
.test-category__items { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.test-checkbox-label { display: flex; align-items: flex-start; gap: 8px; background: var(--white); border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 10px; cursor: pointer; }
.test-info { display: flex; flex-direction: column; gap: 2px; }
.detail-related-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.detail-related-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.detail-actions-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.detail-action-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; display: flex; flex-direction: column; gap: 10px; }

/* Receta */
.rx-add-item { background: var(--surface); border: 1.5px solid var(--border); border-radius: var(--radius-lg); padding: 14px 16px; }
.rx-item-list { display: flex; flex-direction: column; gap: 8px; }
.rx-item { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; background: var(--white); border: 1.5px solid var(--border); border-radius: var(--radius); padding: 10px 14px; }
.rx-item__info { display: flex; flex-direction: column; gap: 2px; flex: 1; }
.rx-item__info strong { font-size: 0.9rem; color: var(--text); }
.rx-item__info span { font-size: 0.8rem; color: var(--text-2); }
.rx-item__remove { background: none; border: none; cursor: pointer; font-size: 0.85rem; color: var(--text-3); padding: 4px 6px; border-radius: var(--radius-sm); flex-shrink: 0; }
.rx-item__remove:hover:not(:disabled) { background: #FDEAEA; color: #c0392b; }

@media (max-width: 700px) {
  .evol-card { grid-template-columns: 1fr; }
  .evol-card__aside { grid-row: auto; flex-direction: row; border-right: none; border-bottom: 1px solid var(--border); }
  .evol-card__vet { grid-column: 1; }
  .form-grid { grid-template-columns: 1fr; }
  .checkbox-grid { grid-template-columns: 1fr 1fr; }
  .test-category__items { grid-template-columns: 1fr; }
  .detail-related-grid { grid-template-columns: 1fr; }
  .detail-actions-grid { grid-template-columns: 1fr; }
  .modal { max-width: 100%; max-height: 100vh; border-radius: 0; }
}
</style>
