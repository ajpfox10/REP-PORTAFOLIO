<template>
  <div class="page">

    <div class="page-header">
      <div class="page-header__left">
        <span class="page-emoji">&#x1F43E;</span>
        <div>
          <h2 class="page-title">{{ t('pathology.title') }}</h2>
          <p class="page-sub">{{ t('pathology.subtitle') }}</p>
        </div>
      </div>
      <button type="button" class="btn-primary" @click="openOrderModal()">{{ t('pathology.newOrder') }}</button>
    </div>

    <!-- KPIs -->
    <div class="kpi-row">
      <div class="kpi" style="--c:#FFF3CC;--ct:#8A6200">
        <span>&#x2713;</span><div><strong>{{ kpis.pending }}</strong><span>{{ t('pathology.pending') }}</span></div>
      </div>
      <div class="kpi" style="--c:#E8D6FF;--ct:#6A1AAA">
        <span>&#x1F43E;</span><div><strong>{{ kpis.processing }}</strong><span>{{ t('pathology.processing') }}</span></div>
      </div>
      <div class="kpi" style="--c:#D6F3EC;--ct:#1A9E7F">
        <span>&#x1F43E;</span><div><strong>{{ kpis.reported }}</strong><span>{{ t('pathology.reported') }}</span></div>
      </div>
    </div>

    <!-- Filtros -->
    <div class="filters">
      <label for="path-status" class="sr-only">{{ t('common.allStatuses') }}</label>
      <select id="path-status" name="path-status" v-model="statusFilter" class="filter-select" @change="load()">
        <option value="">{{ t('common.allStatuses') }}</option>
        <option value="pending">{{ t('common.pending') }}</option>
        <option value="processing">{{ t('pathology.processing') }}</option>
        <option value="reported">{{ t('pathology.reported') }}</option>
      </select>
      <label for="path-search" class="sr-only">{{ t('pathology.searchPlaceholder') }}</label>
      <input id="path-search" name="path-search" v-model.trim="search" type="search" :placeholder="t('pathology.searchPlaceholder')" class="filter-input filter-input--grow" @input="debouncedLoad()" />
    </div>

    <div v-if="loading" class="loading-state"><span class="spin spin--dark" /> {{ t('pathology.loading') }}</div>
    <div v-else-if="error" class="alert alert--error">{{ error }}</div>
    <div v-else-if="items.length === 0" class="empty-state">
      <span class="empty-state__emoji">&#x1F43E;</span>
      <p>{{ t('pathology.empty') }}</p>
    </div>

    <div v-else class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>N° Orden</th>
            <th>{{ t('pathology.tablePatient') }}</th>
            <th>{{ t('pathology.tableType') }}</th>
            <th>{{ t('pathology.tableSamples') }}</th>
            <th>{{ t('pathology.tableDate') }}</th>
            <th>{{ t('pathology.tableStatus') }}</th>
            <th>{{ t('pathology.tableActions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="o in items" :key="o.id">
            <td><code class="order-num">{{ o.order_number }}</code></td>
            <td>
              <div class="patient-cell">
                <span class="patient-name">{{ o.patient_name }}</span>
                <span class="patient-species">{{ o.species }}</span>
              </div>
            </td>
            <td>{{ o.pathology_type }}</td>
            <td class="center">{{ o.sample_count }}</td>
            <td>{{ formatDate(o.ordered_at) }}</td>
            <td><span class="badge" :class="`status--${o.status}`">{{ STATUS[o.status] || o.status }}</span></td>
            <td>
              <div class="action-btns">
                <button class="btn-xs btn-xs--blue" @click="viewOrder(o)">{{ t('common.viewAll') }}</button>
                <button v-if="o.status !== 'reported'" class="btn-xs btn-xs--purple" @click="openResultModal(o)">{{ t('pathology.loadReport') }}</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Modal nueva orden -->
    <Transition name="modal">
      <div v-if="showOrderModal" class="modal-backdrop" @click.self="closeOrderModal()">
        <div class="modal modal--lg">
          <div class="modal__header">
            <h3>{{ t('pathology.newModalTitle') }}</h3>
            <button type="button" class="modal__close" @click="closeOrderModal()">&times;</button>
          </div>
          <form @submit.prevent="handleCreate" novalidate>
            <div class="form-body">
              <div class="form-grid">
                <div class="field field--full">
                  <label for="path-m-patient">{{ t('pathology.patientLabel') }} <span class="req">*</span></label>
                  <input id="path-m-patient" name="path-m-patient" v-model.trim="patientSearch" type="search" :placeholder="t('pathology.patientPlaceholder')" :disabled="saving" @input="searchPatients" autocomplete="off" />
                  <div v-if="patientResults.length" class="autocomplete">
                    <div v-for="pt in patientResults" :key="pt.id" class="autocomplete__item" @click="selectPatient(pt)">
                      &#x1F43E; <b>{{ pt.name }}</b>
                      <span class="autocomplete__owner">— {{ pt.primary_owner || '' }}</span>
                    </div>
                  </div>
                  <div v-if="orderForm.patientId" class="selected-patient">&#x2713; {{ selectedPatientLabel }}</div>
                  <span v-if="fe.patientId" class="field-error">{{ fe.patientId }}</span>
                </div>
                <div class="field field--full">
                  <label for="path-m-type">{{ t('pathology.typeLabel') }} <span class="req">*</span></label>
                  <select id="path-m-type" name="path-m-type" v-model="orderForm.pathologyTypeId" :disabled="saving" required>
                    <option value="">{{ t('pathology.typePlaceholder') }}</option>
                    <option v-for="t in pathologyTypes" :key="t.id" :value="t.id">{{ t.name }}</option>
                  </select>
                  <span v-if="fe.pathologyTypeId" class="field-error">{{ fe.pathologyTypeId }}</span>
                </div>
                <div class="field field--full">
                  <label for="path-m-history">{{ t('pathology.historyLabel') }}</label>
                  <textarea id="path-m-history" name="path-m-history" v-model.trim="orderForm.clinicalHistory" rows="3" :placeholder="t('pathology.historyPlaceholder')" :disabled="saving" />
                </div>

                <!-- Muestras -->
                <div class="field field--full">
                  <div class="section-header">
                    <label>{{ t('pathology.samplesLabel') }}</label>
                    <button type="button" class="btn-xs btn-xs--blue" @click="addSample()">+ {{ t('pathology.addSample') }}</button>
                  </div>
                  <div v-for="(s, i) in orderForm.samples" :key="i" class="sample-row">
                    <div class="sample-row__header">
                      <span class="sample-num">{{ t('pathology.samplesLabel') }} {{ i + 1 }}</span>
                      <button type="button" class="btn-xs btn-xs--red" @click="removeSample(i)" :disabled="saving">&times;</button>
                    </div>
                    <div class="sample-grid">
                      <div class="field">
                        <label :for="`path-s-type-${i}`">{{ t('pathology.sampleType') }}</label>
                        <select :id="`path-s-type-${i}`" :name="`path-s-type-${i}`" v-model="s.sampleType" :disabled="saving">
                          <option value="">{{ t('common.none') }}</option>
                          <option value="biopsy">{{ t('pathology.sampleBiopsy') }}</option>
                          <option value="cytology">{{ t('pathology.sampleCytology') }}</option>
                          <option value="fine_needle">{{ t('pathology.sampleFineNeedle') }}</option>
                          <option value="surgical">{{ t('pathology.sampleSurgical') }}</option>
                          <option value="necropsy">{{ t('pathology.sampleNecropsy') }}</option>
                          <option value="other">Otro</option>
                        </select>
                      </div>
                      <div class="field">
                        <label :for="`path-s-loc-${i}`">{{ t('pathology.anatomicalLocation') }}</label>
                        <input :id="`path-s-loc-${i}`" :name="`path-s-loc-${i}`" v-model.trim="s.anatomicalLocation" type="text" :placeholder="t('pathology.anatomicalLocation')" :disabled="saving" />
                      </div>
                      <div class="field">
                        <label :for="`path-s-date-${i}`">{{ t('pathology.collectionDate') }}</label>
                        <input :id="`path-s-date-${i}`" :name="`path-s-date-${i}`" v-model="s.collectionDate" type="date" :disabled="saving" />
                      </div>
                      <div class="field">
                        <label :for="`path-s-fix-${i}`">{{ t('pathology.fixationMethod') }}</label>
                        <select :id="`path-s-fix-${i}`" :name="`path-s-fix-${i}`" v-model="s.fixationMethod" :disabled="saving">
                          <option value="">{{ t('common.none') }}</option>
                          <option value="formalin_10">{{ t('pathology.fixationFormalin10') }}</option>
                          <option value="fresh">{{ t('pathology.fixationFresh') }}</option>
                          <option value="alcohol">{{ t('pathology.fixationAlcohol') }}</option>
                          <option value="other">Otro</option>
                        </select>
                      </div>
                      <div class="field field--full-sample">
                        <label :for="`path-s-macro-${i}`">{{ t('pathology.macroscopicDescription') }}</label>
                        <textarea :id="`path-s-macro-${i}`" :name="`path-s-macro-${i}`" v-model.trim="s.macroscopicDescription" rows="2" :placeholder="t('pathology.macroscopicDescription')" :disabled="saving" />
                      </div>
                    </div>
                  </div>
                  <div v-if="orderForm.samples.length === 0" class="no-samples">{{ t('pathology.noSamples') }}</div>
                </div>
              </div>
            </div>
            <div v-if="saveError" class="alert alert--error mx">{{ saveError }}</div>
            <div class="modal__actions">
              <button type="button" class="btn-ghost" @click="closeOrderModal()" :disabled="saving">{{ t('common.cancel') }}</button>
              <button type="submit" class="btn-primary" :disabled="saving">
                <span v-if="saving" class="spin spin--sm" /> <span v-else>{{ t('pathology.createOrder') }}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </Transition>

    <!-- Modal ver detalle -->
    <Transition name="modal">
      <div v-if="showDetailModal && detailOrder" class="modal-backdrop" @click.self="showDetailModal = false">
        <div class="modal modal--lg">
          <div class="modal__header">
            <h3>&#x1F43E; {{ detailOrder.order_number }} — {{ detailOrder.patient_name }}</h3>
            <button type="button" class="modal__close" @click="showDetailModal = false">&times;</button>
          </div>
          <div class="form-body detail-body">
            <div class="detail-section">
              <h4>{{ t('pathology.detailGeneral') }}</h4>
              <div class="detail-grid">
                <div><span class="detail-label">{{ t('pathology.detailType') }}</span><span>{{ detailOrder.type_name }}</span></div>
                <div><span class="detail-label">{{ t('pathology.status') }}</span><span class="badge" :class="`status--${detailOrder.status}`">{{ STATUS[detailOrder.status] }}</span></div>
                <div><span class="detail-label">{{ t('pathology.detailRequested') }}</span><span>{{ formatDate(detailOrder.ordered_at) }}</span></div>
                <div><span class="detail-label">{{ t('pathology.detailSpecies') }}</span><span>{{ detailOrder.species }}</span></div>
              </div>
              <div v-if="detailOrder.clinical_history" class="detail-text">
                <span class="detail-label">{{ t('pathology.detailClinicalHistory') }}</span>
                <p>{{ detailOrder.clinical_history }}</p>
              </div>
            </div>

            <div v-if="detailOrder.samples?.length" class="detail-section">
              <h4>{{ t('pathology.detailSamples') }} ({{ detailOrder.samples.length }})</h4>
              <div v-for="s in detailOrder.samples" :key="s.id" class="sample-detail">
                <div class="sample-detail__header">{{ t('pathology.detailSamples') }} {{ s.sample_number }} — {{ s.sample_type }}</div>
                <div class="detail-grid">
                  <div v-if="s.anatomical_location"><span class="detail-label">{{ t('pathology.anatomicalLocation') }}</span><span>{{ s.anatomical_location }}</span></div>
                  <div v-if="s.collection_date"><span class="detail-label">{{ t('pathology.collectionDate') }}</span><span>{{ formatDate(s.collection_date) }}</span></div>
                  <div v-if="s.fixation_method"><span class="detail-label">{{ t('pathology.fixationMethod') }}</span><span>{{ s.fixation_method }}</span></div>
                </div>
                <div v-if="s.macroscopic_description" class="detail-text">
                  <span class="detail-label">{{ t('pathology.macroscopicDescription') }}</span>
                  <p>{{ s.macroscopic_description }}</p>
                </div>
              </div>
            </div>

            <div v-if="detailOrder.result" class="detail-section result-section">
              <h4>&#x1F43E; {{ t('pathology.resultTitle') }}</h4>
              <div class="detail-grid">
                <div><span class="detail-label">{{ t('pathology.detailPathologist') }}</span><span>{{ detailOrder.result.pathologist_name }}</span></div>
                <div><span class="detail-label">{{ t('pathology.reportDate') }}</span><span>{{ formatDate(detailOrder.result.reported_at) }}</span></div>
                <div v-if="detailOrder.result.behavior"><span class="detail-label">{{ t('pathology.detailBehavior') }}</span><span class="badge" :class="behaviorClass(detailOrder.result.behavior)">{{ BEHAVIOR[detailOrder.result.behavior] || detailOrder.result.behavior }}</span></div>
              </div>
              <div v-if="detailOrder.result.tnm_stage" class="tnm-row">
                <span class="detail-label">{{ t('pathology.detailTNM') }}</span>
                <span>T{{ detailOrder.result.tnm_t }} N{{ detailOrder.result.tnm_n }} M{{ detailOrder.result.tnm_m }} — Estadio {{ detailOrder.result.tnm_stage }}</span>
              </div>
              <div class="detail-text"><span class="detail-label">{{ t('pathology.detailMicroscopic') }}</span><p>{{ detailOrder.result.microscopic_description }}</p></div>
              <div class="detail-text"><span class="detail-label">{{ t('pathology.detailDiagnosis') }}</span><p><strong>{{ detailOrder.result.diagnosis }}</strong></p></div>
              <div v-if="detailOrder.result.differential_diagnosis" class="detail-text"><span class="detail-label">{{ t('pathology.detailDifferential') }}</span><p>{{ detailOrder.result.differential_diagnosis }}</p></div>
              <div v-if="detailOrder.result.prognostic_notes" class="detail-text"><span class="detail-label">{{ t('pathology.detailPrognostic') }}</span><p>{{ detailOrder.result.prognostic_notes }}</p></div>
              <div v-if="detailOrder.result.ihc_results" class="detail-text"><span class="detail-label">{{ t('pathology.detailIHC') }}</span><p>{{ detailOrder.result.ihc_results }}</p></div>
              <div v-if="detailOrder.result.special_stains" class="detail-text"><span class="detail-label">{{ t('pathology.detailSpecialStains') }}</span><p>{{ detailOrder.result.special_stains }}</p></div>
              <div v-if="detailOrder.result.recommendations" class="detail-text"><span class="detail-label">{{ t('pathology.detailRecommendations') }}</span><p>{{ detailOrder.result.recommendations }}</p></div>
            </div>
            <div v-else class="no-result-note">{{ t('pathology.noReport') }}</div>
          </div>
          <div class="modal__actions">
            <button type="button" class="btn-ghost" @click="showDetailModal = false">{{ t('common.close') }}</button>
            <button v-if="detailOrder.status !== 'reported'" type="button" class="btn-primary" @click="showDetailModal = false; openResultModal(detailOrder)">&#x1F43E; {{ t('pathology.loadReport') }}</button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Modal cargar informe -->
    <Transition name="modal">
      <div v-if="showResultModal" class="modal-backdrop" @click.self="closeResultModal()">
        <div class="modal modal--lg">
          <div class="modal__header">
            <h3>&#x1F43E; {{ t('pathology.resultTitle') }} — {{ resultOrderNum }}</h3>
            <button type="button" class="modal__close" @click="closeResultModal()">&times;</button>
          </div>
          <form @submit.prevent="handleResult" novalidate>
            <div class="form-body">
              <div class="form-grid">
                <div class="field field--full">
                  <label for="path-r-micro">{{ t('pathology.microscopicDescription') }} <span class="req">*</span></label>
                  <textarea id="path-r-micro" name="path-r-micro" v-model.trim="resultForm.microscopicDescription" rows="4" :placeholder="t('pathology.microscopicDescription')" :disabled="resultSaving" required />
                  <span v-if="rfe.microscopicDescription" class="field-error">{{ rfe.microscopicDescription }}</span>
                </div>
                <div class="field field--full">
                  <label for="path-r-diag">{{ t('pathology.diagnosis') }} <span class="req">*</span></label>
                  <textarea id="path-r-diag" name="path-r-diag" v-model.trim="resultForm.diagnosis" rows="3" :placeholder="t('pathology.diagnosis')" :disabled="resultSaving" required />
                  <span v-if="rfe.diagnosis" class="field-error">{{ rfe.diagnosis }}</span>
                </div>
                <div class="field">
                  <label for="path-r-behav">{{ t('pathology.behavior') }}</label>
                  <select id="path-r-behav" name="path-r-behav" v-model="resultForm.behavior" :disabled="resultSaving">
                    <option value="">{{ t('common.none') }}</option>
                    <option value="benign">{{ t('pathology.resultBenign') }}</option>
                    <option value="malignant">{{ t('pathology.resultMalignant') }}</option>
                    <option value="borderline">{{ t('pathology.resultBorderline') }}</option>
                    <option value="inflammatory">{{ t('pathology.resultInflammatory') }}</option>
                    <option value="reactive">{{ t('pathology.resultReactive') }}</option>
                    <option value="normal">{{ t('pathology.resultNormal') }}</option>
                  </select>
                </div>
                <div class="field">
                  <label for="path-r-tnm">{{ t('pathology.detailTNM') }}</label>
                  <input id="path-r-tnm" name="path-r-tnm" v-model.trim="resultForm.tnmStage" type="text" placeholder="Ej: III" :disabled="resultSaving" />
                </div>
                <div class="field">
                  <label for="path-r-tnmt">{{ t('pathology.tLabel') }}</label>
                  <input id="path-r-tnmt" name="path-r-tnmt" v-model.trim="resultForm.tnmT" type="text" placeholder="T0, T1…" :disabled="resultSaving" />
                </div>
                <div class="field">
                  <label for="path-r-tnmn">{{ t('pathology.nLabel') }}</label>
                  <input id="path-r-tnmn" name="path-r-tnmn" v-model.trim="resultForm.tnmN" type="text" placeholder="N0, N1…" :disabled="resultSaving" />
                </div>
                <div class="field field--full">
                  <label for="path-r-tnmm">{{ t('pathology.mLabel') }}</label>
                  <input id="path-r-tnmm" name="path-r-tnmm" v-model.trim="resultForm.tnmM" type="text" placeholder="M0, M1…" :disabled="resultSaving" />
                </div>
                <div class="field field--full">
                  <label for="path-r-diff">{{ t('pathology.differentialDiagnosis') }}</label>
                  <textarea id="path-r-diff" name="path-r-diff" v-model.trim="resultForm.differentialDiagnosis" rows="2" :disabled="resultSaving" />
                </div>
                <div class="field field--full">
                  <label for="path-r-prog">{{ t('pathology.detailPrognostic') }}</label>
                  <textarea id="path-r-prog" name="path-r-prog" v-model.trim="resultForm.prognosticNotes" rows="2" :disabled="resultSaving" />
                </div>
                <div class="field field--full">
                  <label for="path-r-ihc">{{ t('pathology.detailIHC') }}</label>
                  <textarea id="path-r-ihc" name="path-r-ihc" v-model.trim="resultForm.ihcResults" rows="2" :placeholder="t('pathology.ihcPlaceholder')" :disabled="resultSaving" />
                </div>
                <div class="field field--full">
                  <label for="path-r-stains">{{ t('pathology.detailSpecialStains') }}</label>
                  <textarea id="path-r-stains" name="path-r-stains" v-model.trim="resultForm.specialStains" rows="2" :disabled="resultSaving" />
                </div>
                <div class="field field--full">
                  <label for="path-r-recs">{{ t('pathology.detailRecommendations') }}</label>
                  <textarea id="path-r-recs" name="path-r-recs" v-model.trim="resultForm.recommendations" rows="2" :disabled="resultSaving" />
                </div>
              </div>
            </div>
            <div v-if="resultError" class="alert alert--error mx">{{ resultError }}</div>
            <div class="modal__actions">
              <button type="button" class="btn-ghost" @click="closeResultModal()" :disabled="resultSaving">{{ t('common.cancel') }}</button>
              <button type="submit" class="btn-primary" :disabled="resultSaving">
                <span v-if="resultSaving" class="spin spin--sm" /> <span v-else>{{ t('pathology.saveReport') }}</span>
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
import { labApi, patientsApi } from '../api'
import { t } from '../i18n'
import { extractDetailedErrorMessage, logError } from '../utils/errors'
import { useUiFeedback } from '../composables/useUiFeedback'

const { notifyError } = useUiFeedback()

function asArray(value) {
  if (Array.isArray(value)) return value
  if (value == null) return []
  return [value]
}

function normalizePatient(row) {
  if (!row || typeof row !== 'object') return null
  return {
    ...row,
    id: row.id ?? row.patient_id ?? row.patientId ?? null,
    name: row.name ?? row.full_name ?? row.fullName ?? '',
    primary_owner: row.primary_owner ?? row.owner_name ?? row.ownerName ?? '',
  }
}

function normalizePathologyOrder(row) {
  if (!row || typeof row !== 'object') return null
  return {
    ...row,
    id: row.id ?? row.order_id ?? row.orderId ?? null,
    order_number: row.order_number ?? row.orderNumber ?? '',
    patient_name: row.patient_name ?? row.patient?.name ?? row.patientName ?? '',
    pathology_type: row.pathology_type ?? row.pathologyType ?? '',
    ordered_by: row.ordered_by ?? row.orderedBy ?? '',
    status: row.status ?? '',
    samples: asArray(row.samples),
    result: row.result ?? null,
  }
}

function normalizePathologyType(row) {
  if (!row || typeof row !== 'object') return null
  return {
    ...row,
    id: row.id ?? row.type_id ?? row.typeId ?? null,
    name: row.name ?? row.type_name ?? row.typeName ?? '',
    category_name: row.category_name ?? row.categoryName ?? 'General',
  }
}

const items = ref([])
const loading = ref(false)
const error   = ref('')
const search  = ref('')
const statusFilter = ref('')
const kpis = ref({ pending: 0, processing: 0, reported: 0 })

const STATUS   = { pending: 'Pendiente', processing: 'En proceso', reported: 'Informado' }
const BEHAVIOR = {
  benign: t('pathology.resultBenign'),
  malignant: t('pathology.resultMalignant'),
  borderline: t('pathology.resultBorderline'),
  inflammatory: t('pathology.resultInflammatory'),
  reactive: t('pathology.resultReactive'),
  normal: t('pathology.resultNormal'),
}

function behaviorClass(b) {
  return { benign: 'beh--benign', malignant: 'beh--malignant', borderline: 'beh--borderline' }[b] || ''
}

function formatDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

async function load() {
  loading.value = true; error.value = ''
  try {
    const params = {}
    if (statusFilter.value) params.status = statusFilter.value
    const { data } = await labApi.pathology.list(params)
    const rows = asArray(data?.data || data).map(normalizePathologyOrder).filter(Boolean)
    const needle = search.value.trim().toLowerCase()
    items.value = needle
      ? rows.filter((row) => [row.order_number, row.patient_name, row.pathology_type, row.ordered_by]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle)))
      : rows
    kpis.value.pending    = items.value.filter(o => o.status === 'pending').length
    kpis.value.processing = items.value.filter(o => o.status === 'processing').length
    kpis.value.reported   = items.value.filter(o => o.status === 'reported').length
  } catch (e) {
    logError('patologia.load', e)
    error.value = extractDetailedErrorMessage(e, 'No se pudieron cargar las ordenes', { context: 'Carga de ordenes de patologia' })
  } finally { loading.value = false }
}

let timer = null
function debouncedLoad() { clearTimeout(timer); timer = setTimeout(load, 350) }

// Pathology types
const pathologyTypes = ref([])
async function loadTypes() {
  try {
    const { data } = await labApi.pathology.types()
    pathologyTypes.value = asArray(data?.data || data).map(normalizePathologyType).filter(Boolean)
  } catch (error) { logError('patologia.loadTypes', error); pathologyTypes.value = [] }
}

// Patient autocomplete
const patientSearch = ref('')
const patientResults = ref([])
const selectedPatientLabel = ref('')
let patientTimer = null
async function searchPatients() {
  clearTimeout(patientTimer)
  orderForm.patientId = ''
  selectedPatientLabel.value = ''
  if (patientSearch.value.length < 2) { patientResults.value = []; return }
  patientTimer = setTimeout(async () => {
    try {
      const { data } = await patientsApi.list({ search: patientSearch.value, limit: 8 })
      patientResults.value = asArray(data?.data || data?.patients || data).map(normalizePatient).filter(Boolean)
    } catch (error) { logError('patologia.searchPatients', error, { search: patientSearch.value }); patientResults.value = [] }
  }, 300)
}
function selectPatient(pt) {
  orderForm.patientId = pt.id
  selectedPatientLabel.value = `${pt.name} (${pt.primary_owner || ''})`
  patientSearch.value = pt.name
  patientResults.value = []
}

// New order form
const showOrderModal = ref(false)
const saving    = ref(false)
const saveError = ref('')
const fe        = reactive({})
const orderForm = reactive({
  patientId: '', pathologyTypeId: '', clinicalHistory: '',
  samples: [],
})

function openOrderModal() {
  Object.assign(orderForm, { patientId: '', pathologyTypeId: '', clinicalHistory: '', samples: [] })
  patientSearch.value = ''; patientResults.value = []; selectedPatientLabel.value = ''
  saveError.value = ''; Object.keys(fe).forEach(k => delete fe[k])
  showOrderModal.value = true
}
function closeOrderModal() { showOrderModal.value = false }

function addSample() {
  orderForm.samples.push({ sampleType: '', anatomicalLocation: '', collectionDate: '', fixationMethod: '', macroscopicDescription: '' })
}
function removeSample(i) { orderForm.samples.splice(i, 1) }

function validateOrder() {
  Object.keys(fe).forEach(k => delete fe[k])
  if (!orderForm.patientId)       fe.patientId       = 'Requerido'
  if (!orderForm.pathologyTypeId) fe.pathologyTypeId = 'Requerido'
  return Object.keys(fe).length === 0
}

async function handleCreate() {
  if (!validateOrder()) return
  saving.value = true; saveError.value = ''
  try {
    await labApi.pathology.create({
      patientId:       parseInt(orderForm.patientId, 10),
      pathologyTypeId: parseInt(orderForm.pathologyTypeId, 10),
      clinicalHistory: orderForm.clinicalHistory || undefined,
      samples:         orderForm.samples.length ? orderForm.samples : undefined,
    })
    closeOrderModal(); await load()
  } catch (e) {
    saveError.value = extractDetailedErrorMessage(e, 'No se pudo crear la orden', { context: 'Creacion de orden de patologia' })
  } finally { saving.value = false }
}

// View order detail
const showDetailModal = ref(false)
const detailOrder     = ref(null)
async function viewOrder(o) {
  try {
    const { data } = await labApi.pathology.get(o.id)
    detailOrder.value = data.data || data
    showDetailModal.value = true
  } catch (e) {
    notifyError('patologia.viewOrder', e, 'No se pudo cargar el detalle', { context: 'Detalle de patologia' })
  }
}

// Result form
const showResultModal = ref(false)
const resultSaving    = ref(false)
const resultError     = ref('')
const resultOrderId   = ref(null)
const resultOrderNum  = ref('')
const rfe             = reactive({})
const resultForm = reactive({
  microscopicDescription: '', diagnosis: '', behavior: '',
  differentialDiagnosis: '', prognosticNotes: '',
  tnmT: '', tnmN: '', tnmM: '', tnmStage: '',
  ihcResults: '', specialStains: '', recommendations: '',
})

function openResultModal(o) {
  resultOrderId.value  = o.id
  resultOrderNum.value = o.order_number
  Object.assign(resultForm, {
    microscopicDescription: '', diagnosis: '', behavior: '',
    differentialDiagnosis: '', prognosticNotes: '',
    tnmT: '', tnmN: '', tnmM: '', tnmStage: '',
    ihcResults: '', specialStains: '', recommendations: '',
  })
  resultError.value = ''; Object.keys(rfe).forEach(k => delete rfe[k])
  showResultModal.value = true
}
function closeResultModal() { showResultModal.value = false }

function validateResult() {
  Object.keys(rfe).forEach(k => delete rfe[k])
  if (!resultForm.microscopicDescription) rfe.microscopicDescription = 'Requerido'
  if (!resultForm.diagnosis)              rfe.diagnosis              = 'Requerido'
  return Object.keys(rfe).length === 0
}

async function handleResult() {
  if (!validateResult()) return
  resultSaving.value = true; resultError.value = ''
  try {
    const payload = { microscopicDescription: resultForm.microscopicDescription, diagnosis: resultForm.diagnosis }
    if (resultForm.behavior)              payload.behavior              = resultForm.behavior
    if (resultForm.differentialDiagnosis) payload.differentialDiagnosis = resultForm.differentialDiagnosis
    if (resultForm.prognosticNotes)       payload.prognosticNotes       = resultForm.prognosticNotes
    if (resultForm.tnmT)                  payload.tnmT                  = resultForm.tnmT
    if (resultForm.tnmN)                  payload.tnmN                  = resultForm.tnmN
    if (resultForm.tnmM)                  payload.tnmM                  = resultForm.tnmM
    if (resultForm.tnmStage)              payload.tnmStage              = resultForm.tnmStage
    if (resultForm.ihcResults)            payload.ihcResults            = resultForm.ihcResults
    if (resultForm.specialStains)         payload.specialStains         = resultForm.specialStains
    if (resultForm.recommendations)       payload.recommendations       = resultForm.recommendations
    await labApi.pathology.result(resultOrderId.value, payload)
    closeResultModal(); await load()
  } catch (e) {
    resultError.value = extractDetailedErrorMessage(e, 'No se pudo guardar el informe', { context: 'Informe de patologia' })
  } finally { resultSaving.value = false }
}

onMounted(() => { load(); loadTypes() })
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

.table-wrap { background: var(--white); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); overflow-x: auto; }
.data-table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
.data-table th { padding: 11px 14px; text-align: left; font-size: 0.78rem; font-weight: 600; color: var(--text-2); background: var(--surface); border-bottom: 1.5px solid var(--border); white-space: nowrap; }
.data-table td { padding: 11px 14px; border-bottom: 1px solid var(--border); vertical-align: middle; }
.data-table tr:last-child td { border-bottom: none; }
.data-table tr:hover td { background: var(--surface); }
.center { text-align: center; }

.order-num { background: var(--surface-2); padding: 2px 7px; border-radius: 5px; font-size: 0.82rem; font-family: monospace; }
.patient-cell { display: flex; flex-direction: column; }
.patient-name { font-weight: 600; color: var(--text); }
.patient-species { font-size: 0.75rem; color: var(--text-3); }
.action-btns { display: flex; gap: 6px; }

.badge { display: inline-block; padding: 3px 9px; border-radius: 20px; font-size: 0.72rem; font-weight: 600; }
.status--pending    { background: #FFF3CC; color: #8A6200; }
.status--processing { background: #E8D6FF; color: #6A1AAA; }
.status--reported   { background: #D6F3EC; color: #1A9E7F; }
.beh--benign    { background: #D6F3EC; color: #1A9E7F; }
.beh--malignant { background: #FDEAEA; color: #c0392b; }
.beh--borderline { background: #FFF3CC; color: #8A6200; }

.btn-xs { padding: 4px 10px; border: none; border-radius: 6px; font-size: 0.75rem; font-weight: 600; cursor: pointer; transition: opacity 0.15s; }
.btn-xs:hover { opacity: 0.8; }
.btn-xs--blue   { background: #D6EEFF; color: #1A5FAA; }
.btn-xs--purple { background: #E8D6FF; color: #6A1AAA; }
.btn-xs--red    { background: #FDEAEA; color: #c0392b; }

.btn-primary { padding: 10px 20px; background: linear-gradient(135deg, var(--primary) 0%, var(--accent-mint) 100%); color: white; border: none; border-radius: var(--radius); font-size: 0.9rem; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: opacity 0.15s, transform 0.15s; }
.btn-primary:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
.btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
.btn-ghost { padding: 10px 20px; background: none; border: 1.5px solid var(--border); border-radius: var(--radius); color: var(--text-2); font-size: 0.9rem; font-weight: 500; cursor: pointer; }
.btn-ghost:hover:not(:disabled) { background: var(--surface-2); }

.modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 16px; }
.modal { background: var(--white); border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); width: 100%; max-width: 540px; max-height: 92vh; overflow-y: auto; }
.modal--lg { max-width: 700px; }
.modal__header { display: flex; align-items: center; justify-content: space-between; padding: 20px 24px 16px; border-bottom: 1px solid var(--border); }
.modal__header h3 { font-size: 1.05rem; font-weight: 700; color: var(--text); }
.modal__close { background: none; border: none; cursor: pointer; font-size: 1rem; color: var(--text-3); padding: 4px 8px; border-radius: var(--radius-sm); }
.modal__close:hover { background: var(--surface-2); }
.form-body { padding: 20px 24px 0; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.field { display: flex; flex-direction: column; gap: 5px; position: relative; }
.field label { font-size: 0.82rem; font-weight: 600; color: var(--text-2); }
.field input, .field select, .field textarea { padding: 9px 12px; border: 1.5px solid var(--border); border-radius: var(--radius); font-size: 0.9rem; color: var(--text); background: var(--surface); outline: none; transition: border-color 0.15s; }
.field input:focus, .field select:focus, .field textarea:focus { border-color: var(--primary); }
.field textarea { resize: vertical; }
.field--full { grid-column: 1 / -1; }
.field-error { font-size: 0.75rem; color: var(--danger); }
.req { color: var(--danger); }

.section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.section-header label { font-size: 0.82rem; font-weight: 600; color: var(--text-2); }

.sample-row { border: 1.5px solid var(--border); border-radius: var(--radius); padding: 12px; margin-bottom: 10px; background: var(--surface); }
.sample-row__header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.sample-num { font-size: 0.82rem; font-weight: 600; color: var(--primary); }
.sample-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.field--full-sample { grid-column: 1 / -1; }
.no-samples { font-size: 0.82rem; color: var(--text-3); padding: 12px 0; }

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
@media (max-width: 600px) { .form-grid { grid-template-columns: 1fr; } .sample-grid { grid-template-columns: 1fr; } }

.autocomplete { position: absolute; z-index: 100; background: var(--white); border: 1.5px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); width: 100%; max-height: 200px; overflow-y: auto; top: calc(100% + 2px); }
.autocomplete__item { padding: 9px 13px; cursor: pointer; font-size: 0.88rem; }
.autocomplete__item:hover { background: var(--surface-2); }
.autocomplete__owner { font-size: 0.78rem; color: var(--text-3); }
.selected-patient { margin-top: 6px; font-size: 0.82rem; color: var(--primary); font-weight: 500; }

.detail-body { padding-bottom: 8px; }
.detail-section { margin-bottom: 20px; }
.detail-section h4 { font-size: 0.88rem; font-weight: 700; color: var(--text); margin-bottom: 10px; padding-bottom: 6px; border-bottom: 1px solid var(--border); }
.detail-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; margin-bottom: 10px; }
.detail-grid > div { display: flex; flex-direction: column; gap: 2px; }
.detail-label { font-size: 0.73rem; font-weight: 600; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.03em; }
.detail-text { margin-top: 8px; }
.detail-text p { font-size: 0.88rem; color: var(--text); margin-top: 4px; white-space: pre-wrap; }
.tnm-row { display: flex; gap: 8px; align-items: center; margin: 8px 0; font-size: 0.88rem; }
.sample-detail { background: var(--surface); border-radius: var(--radius); padding: 10px 12px; margin-bottom: 8px; }
.sample-detail__header { font-size: 0.82rem; font-weight: 700; color: var(--primary); margin-bottom: 8px; }
.result-section { background: #F0FFF8; border-radius: var(--radius); padding: 14px; border: 1px solid #b2e4d0; }
.no-result-note { font-size: 0.85rem; color: var(--text-3); padding: 12px 0; font-style: italic; }
</style>
