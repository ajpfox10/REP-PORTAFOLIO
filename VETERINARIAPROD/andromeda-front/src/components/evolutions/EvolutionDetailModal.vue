<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="modal modal--wide">
      <div class="modal__header">
        <h3>&#x1F4CB; Detalle evolucion</h3>
        <button type="button" class="modal__close" @click="emit('close')">&times;</button>
      </div>
      <div v-if="detailLoading" class="loading-state">
        <span class="spin spin--dark" /> {{ t('evolutions.loading') }}
      </div>
      <div v-else-if="detailError" class="alert alert--error">{{ detailError }}</div>
      <div v-else-if="detailRecord" class="form-body">
        <div class="detail-row"><b>Paciente:</b> {{ detailRecord.patient_name || '-' }}</div>
        <div class="detail-row"><b>Especie:</b> {{ detailRecord.species || '-' }}</div>
        <div class="detail-row"><b>Veterinario:</b> {{ detailRecord.vet_name || '-' }}</div>
        <div class="detail-row"><b>Motivo principal:</b> {{ detailRecord.chief_complaint || '-' }}</div>
        <div class="detail-row"><b>Fecha visita:</b> {{ formatDate(detailRecord.visit_date || detailRecord.opened_at) }}</div>
        <div class="detail-row"><b>Estado:</b> {{ statusLabel(detailRecord.status) }}</div>
        <div class="detail-row"><b>Firmada:</b> {{ detailRecord.signed_at ? formatDate(detailRecord.signed_at) : '-' }}</div>
        <div class="detail-row"><b>Peso:</b> {{ detailRecord.weight_kg ? detailRecord.weight_kg + ' kg' : '-' }}</div>
        <div class="detail-row"><b>Temperatura:</b> {{ detailRecord.temperature_celsius ? detailRecord.temperature_celsius + ' C' : '-' }}</div>
        <div class="detail-row" v-if="detailRecord.notes"><b>Notas:</b> {{ detailRecord.notes }}</div>

        <div v-if="detailRecord.anamnesisText" class="detail-block">
          <b>Anamnesis</b>
          <pre class="detail-pre">{{ detailRecord.anamnesisText }}</pre>
        </div>

        <div v-if="detailRecord.physicalExamText" class="detail-block">
          <b>Examen fisico</b>
          <pre class="detail-pre">{{ detailRecord.physicalExamText }}</pre>
        </div>

        <div v-if="detailRecord.diagnoses?.length" class="detail-block">
          <b>Diagnosticos</b>
          <ul class="detail-list">
            <li v-for="diag in detailRecord.diagnoses" :key="diag.id || diag.diagnosis_name">
              {{ diag.diagnosis_name || diag.name || '-' }}
              <span class="sub">{{ [diag.diagnosis_type, diag.diagnosis_code, diag.prognosis].filter(Boolean).join(' | ') || 'sin detalle' }}</span>
            </li>
          </ul>
        </div>

        <div v-if="detailRecord.treatments?.length" class="detail-block">
          <b>Tratamientos</b>
          <ul class="detail-list">
            <li v-for="tx in detailRecord.treatments" :key="tx.id || tx.treatment_name">
              {{ tx.treatment_name || tx.name || '-' }}
              <span class="sub">{{ [tx.route, tx.frequency, tx.duration_days ? tx.duration_days + ' dias' : ''].filter(Boolean).join(' | ') || 'sin detalle' }}</span>
            </li>
          </ul>
        </div>

        <div v-if="detailRecord.prescriptions?.length" class="detail-block">
          <b>Recetas</b>
          <ul class="detail-list">
            <li v-for="rx in detailRecord.prescriptions" :key="rx.id || rx.medication_name">
              {{ rx.medication_name || '-' }}
              <span class="sub">{{ [rx.dose, rx.frequency, rx.route].filter(Boolean).join(' | ') || 'sin detalle' }}</span>
            </li>
          </ul>
        </div>

        <div class="detail-block">
          <b>Ordenes derivadas</b>
          <div v-if="relatedOrdersLoading" class="loading-state" style="padding:20px 0">
            <span class="spin spin--dark" /> Cargando ordenes vinculadas...
          </div>
          <div v-else class="detail-related-grid">
            <div class="detail-related-card">
              <strong>Laboratorio</strong>
              <ul v-if="relatedOrders.lab.length" class="detail-list">
                <li v-for="order in relatedOrders.lab" :key="`lab-${order.id}`">
                  {{ order.order_number || ('#' + order.id) }}
                  <span class="sub">{{ [order.status, order.priority, order.test_count ? order.test_count + ' pruebas' : '', order.ordered_at ? formatDate(order.ordered_at) : ''].filter(Boolean).join(' | ') }}</span>
                </li>
              </ul>
              <span v-else class="sub">Sin ordenes de laboratorio vinculadas.</span>
            </div>
            <div class="detail-related-card">
              <strong>Imagenes</strong>
              <ul v-if="relatedOrders.imaging.length" class="detail-list">
                <li v-for="order in relatedOrders.imaging" :key="`img-${order.id}`">
                  {{ order.order_number || ('#' + order.id) }}
                  <span class="sub">{{ [order.imaging_type, order.status, order.body_region, order.ordered_at ? formatDate(order.ordered_at) : ''].filter(Boolean).join(' | ') }}</span>
                </li>
              </ul>
              <span v-else class="sub">Sin ordenes de imagenes vinculadas.</span>
            </div>
            <div class="detail-related-card">
              <strong>Internacion</strong>
              <ul v-if="relatedOrders.hospitalizations.length" class="detail-list">
                <li v-for="item in relatedOrders.hospitalizations" :key="`hos-${item.id}`">
                  Internacion #{{ item.id }}
                  <span class="sub">{{ [item.hospitalization_status, item.ward_name, item.kennel_number ? 'Jaula ' + item.kennel_number : '', item.admission_date ? formatDate(item.admission_date) : ''].filter(Boolean).join(' | ') }}</span>
                </li>
              </ul>
              <span v-else class="sub">Sin internaciones vinculadas.</span>
            </div>
            <div class="detail-related-card">
              <strong>Cirugia</strong>
              <ul v-if="relatedOrders.surgeries.length" class="detail-list">
                <li v-for="item in relatedOrders.surgeries" :key="`sur-${item.id}`">
                  {{ item.surgery_type || ('Cirugia #' + item.id) }}
                  <span class="sub">{{ [item.status, item.lead_surgeon, item.scheduled_date ? formatDate(item.scheduled_date) : ''].filter(Boolean).join(' | ') }}</span>
                </li>
              </ul>
              <span v-else class="sub">Sin cirugias vinculadas.</span>
            </div>
          </div>
        </div>

        <div class="detail-block">
          <b>Acciones clinicas</b>
          <div v-if="orderCatalogError" class="alert alert--error" style="margin-top:12px; margin-bottom:12px">{{ orderCatalogError }}</div>
          <div class="detail-actions-grid">
            <div class="detail-action-card">
              <strong>Laboratorio</strong>
              <div class="form-grid">
                <div class="field">
                  <label>Prioridad</label>
                  <select v-model="detailOrders.lab.priority" :disabled="detailActionSaving">
                    <option value="routine">Rutina</option>
                    <option value="urgent">Urgente</option>
                    <option value="emergency">Emergencia</option>
                  </select>
                </div>
                <div class="field field--full">
                  <label>Notas clinicas</label>
                  <textarea v-model.trim="detailOrders.lab.clinicalNotes" rows="2" :disabled="detailActionSaving" />
                </div>
              </div>
              <div v-if="loadingLabTests" class="loading-state" style="padding:12px 0">
                <span class="spin spin--dark" /> Cargando pruebas...
              </div>
              <div v-else class="tests-catalog">
                <div v-for="(tests, category) in groupedLabTests" :key="category" class="test-category">
                  <div class="test-category__title">{{ category }}</div>
                  <div class="test-category__items">
                    <label v-for="test in tests" :key="test.id" class="test-checkbox-label">
                      <input v-model="detailOrders.lab.tests" type="checkbox" :value="test.id" :disabled="detailActionSaving" />
                      <div class="test-info">
                        <strong>{{ test.name }}</strong>
                      </div>
                    </label>
                  </div>
                </div>
              </div>
              <button type="button" class="btn-primary btn-sm" :disabled="detailActionSaving || !detailOrders.lab.tests.length" @click="emit('submit-lab')">Crear orden de laboratorio</button>
            </div>

            <div class="detail-action-card">
              <strong>Imagenes</strong>
              <div class="form-grid">
                <div class="field">
                  <label>Tipo de estudio</label>
                  <select v-model="detailOrders.imaging.imagingTypeId" :disabled="detailActionSaving || loadingImagingTypes">
                    <option value="">{{ loadingImagingTypes ? 'Cargando tipos...' : 'Seleccionar estudio' }}</option>
                    <option v-for="type in imagingTypes" :key="type.id" :value="type.id">{{ type.name }}{{ type.modality ? ' | ' + type.modality : '' }}</option>
                  </select>
                </div>
                <div class="field">
                  <label>Prioridad</label>
                  <select v-model="detailOrders.imaging.priority" :disabled="detailActionSaving">
                    <option value="routine">Rutina</option>
                    <option value="urgent">Urgente</option>
                    <option value="emergency">Emergencia</option>
                  </select>
                </div>
                <div class="field">
                  <label>Region anatomica</label>
                  <input v-model.trim="detailOrders.imaging.bodyRegion" type="text" :disabled="detailActionSaving" />
                </div>
                <label class="checkbox-label">
                  <input v-model="detailOrders.imaging.sedationRequired" type="checkbox" :disabled="detailActionSaving" />
                  Requiere sedacion
                </label>
                <div class="field field--full">
                  <label>Indicacion clinica</label>
                  <textarea v-model.trim="detailOrders.imaging.clinicalIndication" rows="2" :disabled="detailActionSaving" />
                </div>
              </div>
              <button type="button" class="btn-primary btn-sm" :disabled="detailActionSaving || !detailOrders.imaging.imagingTypeId" @click="emit('submit-imaging')">Crear orden de imagenes</button>
            </div>

            <div class="detail-action-card">
              <strong>Internacion</strong>
              <div class="form-grid">
                <div class="field">
                  <label>Veterinario responsable</label>
                  <select v-model="detailOrders.hospitalization.responsibleVetId" :disabled="detailActionSaving || loadingProfessionals">
                    <option value="">{{ loadingProfessionals ? 'Cargando profesionales...' : 'Seleccionar veterinario' }}</option>
                    <option v-for="professional in hospitalizationProfessionals" :key="professional.id" :value="String(professional.id)">{{ professional.label }}</option>
                  </select>
                </div>
                <div class="field">
                  <label>Sala</label>
                  <select v-model="detailOrders.hospitalization.wardId" :disabled="detailActionSaving || wardsLoading" @change="detailOrders.hospitalization.kennelId = ''">
                    <option value="">{{ wardsLoading ? 'Cargando salas...' : 'Seleccionar sala' }}</option>
                    <option v-for="ward in availableWards" :key="ward.id" :value="ward.id">{{ ward.name }}{{ ward.available_kennels != null ? ' (' + ward.available_kennels + ' libres)' : '' }}</option>
                  </select>
                </div>
                <div class="field">
                  <label>Jaula</label>
                  <select v-model="detailOrders.hospitalization.kennelId" :disabled="detailActionSaving || !detailOrders.hospitalization.wardId">
                    <option value="">Sin jaula asignada</option>
                    <option v-for="kennel in freeKennelsForDetailWard" :key="kennel.id" :value="kennel.id">Jaula {{ kennel.number }}{{ kennel.kennel_type ? ' (' + kennel.kennel_type + ')' : '' }}</option>
                  </select>
                </div>
                <div class="field">
                  <label>Peso ingreso</label>
                  <input v-model.number="detailOrders.hospitalization.admissionWeight" type="number" min="0" step="0.01" :disabled="detailActionSaving" />
                </div>
                <div class="field">
                  <label>Alta estimada</label>
                  <input v-model="detailOrders.hospitalization.estimatedDischargeDate" type="date" :disabled="detailActionSaving" />
                </div>
                <div class="field field--full">
                  <label>Motivo de internacion</label>
                  <textarea v-model.trim="detailOrders.hospitalization.hospitalizationReason" rows="2" :disabled="detailActionSaving" />
                </div>
                <div class="field field--full">
                  <label>Diagnostico de ingreso</label>
                  <textarea v-model.trim="detailOrders.hospitalization.admissionDiagnosis" rows="2" :disabled="detailActionSaving" />
                </div>
                <div class="field field--full">
                  <label>Indicaciones especiales</label>
                  <textarea v-model.trim="detailOrders.hospitalization.specialInstructions" rows="2" :disabled="detailActionSaving" />
                </div>
              </div>
              <button type="button" class="btn-primary btn-sm" :disabled="detailActionSaving || !detailOrders.hospitalization.hospitalizationReason || !detailOrders.hospitalization.responsibleVetId" @click="emit('submit-hospitalization')">Crear internacion</button>
            </div>

            <div class="detail-action-card">
              <strong>Cirugia</strong>
              <div class="form-grid">
                <div class="field">
                  <label>Tipo de cirugia</label>
                  <select v-model="detailOrders.surgery.surgeryTypeId" :disabled="detailActionSaving || loadingSurgeryTypes">
                    <option value="">{{ loadingSurgeryTypes ? 'Cargando tipos...' : 'Seleccionar cirugia' }}</option>
                    <optgroup v-for="(types, category) in groupedSurgeryTypes" :key="category" :label="category">
                      <option v-for="type in types" :key="type.id" :value="type.id">{{ type.name }}{{ type.estimated_duration_minutes ? ' | ' + type.estimated_duration_minutes + ' min est.' : '' }}</option>
                    </optgroup>
                  </select>
                </div>
                <div class="field">
                  <label>Cirujano responsable</label>
                  <select v-model="detailOrders.surgery.leadSurgeonId" :disabled="detailActionSaving || loadingProfessionals">
                    <option value="">{{ loadingProfessionals ? 'Cargando profesionales...' : 'Seleccionar cirujano' }}</option>
                    <option v-for="professional in surgeryProfessionals" :key="professional.id" :value="String(professional.id)">{{ professional.label }}</option>
                  </select>
                </div>
                <div class="field">
                  <label>Fecha programada</label>
                  <input v-model="detailOrders.surgery.scheduledDate" type="date" :disabled="detailActionSaving" />
                </div>
                <div class="field">
                  <label>Hora estimada</label>
                  <input v-model="detailOrders.surgery.startTime" type="time" :disabled="detailActionSaving" />
                </div>
                <div class="field">
                  <label>Urgencia</label>
                  <select v-model="detailOrders.surgery.urgency" :disabled="detailActionSaving">
                    <option value="elective">Electiva</option>
                    <option value="urgent">Urgente</option>
                    <option value="emergency">Emergencia</option>
                  </select>
                </div>
                <div class="field field--full">
                  <label>Diagnostico preoperatorio</label>
                  <textarea v-model.trim="detailOrders.surgery.preoperativeDiagnosis" rows="2" :disabled="detailActionSaving" />
                </div>
                <div class="field field--full">
                  <label>Abordaje quirurgico</label>
                  <input v-model.trim="detailOrders.surgery.surgicalApproach" type="text" :disabled="detailActionSaving" />
                </div>
                <div class="field field--full">
                  <label>Notas quirurgicas</label>
                  <textarea v-model.trim="detailOrders.surgery.notes" rows="2" :disabled="detailActionSaving" />
                </div>
              </div>
              <button type="button" class="btn-primary btn-sm" :disabled="detailActionSaving || !detailOrders.surgery.surgeryTypeId || !detailOrders.surgery.leadSurgeonId || !detailOrders.surgery.scheduledDate" @click="emit('submit-surgery')">Crear cirugia</button>
            </div>
          </div>

          <div v-if="detailActionError" class="alert alert--error" style="margin-top:12px">{{ detailActionError }}</div>
          <div v-if="detailActionSuccess" class="alert alert--success" style="margin-top:12px">{{ detailActionSuccess }}</div>
        </div>
      </div>
      <div class="modal__actions">
        <button type="button" class="btn-ghost" @click="emit('close')">Cerrar</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { t } from '../../i18n'

const {
  detailLoading,
  detailError,
  detailRecord,
  relatedOrdersLoading,
  relatedOrders,
  orderCatalogError,
  detailOrders,
  detailActionSaving,
  detailActionError,
  detailActionSuccess,
  groupedLabTests,
  loadingLabTests,
  imagingTypes,
  loadingImagingTypes,
  hospitalizationProfessionals,
  availableWards,
  wardsLoading,
  freeKennelsForDetailWard,
  groupedSurgeryTypes,
  surgeryProfessionals,
  loadingProfessionals,
  loadingSurgeryTypes,
  formatDate,
  statusLabel,
  petEmoji,
} = defineProps({
  detailLoading: { type: Boolean, default: false },
  detailError: { type: String, default: '' },
  detailRecord: { type: Object, default: null },
  relatedOrdersLoading: { type: Boolean, default: false },
  relatedOrders: { type: Object, required: true },
  orderCatalogError: { type: String, default: '' },
  detailOrders: { type: Object, required: true },
  detailActionSaving: { type: Boolean, default: false },
  detailActionError: { type: String, default: '' },
  detailActionSuccess: { type: String, default: '' },
  groupedLabTests: { type: Object, required: true },
  loadingLabTests: { type: Boolean, default: false },
  imagingTypes: { type: Array, default: () => [] },
  loadingImagingTypes: { type: Boolean, default: false },
  hospitalizationProfessionals: { type: Array, default: () => [] },
  availableWards: { type: Array, default: () => [] },
  wardsLoading: { type: Boolean, default: false },
  freeKennelsForDetailWard: { type: Array, default: () => [] },
  groupedSurgeryTypes: { type: Object, required: true },
  surgeryProfessionals: { type: Array, default: () => [] },
  loadingProfessionals: { type: Boolean, default: false },
  loadingSurgeryTypes: { type: Boolean, default: false },
  formatDate: { type: Function, required: true },
  statusLabel: { type: Function, required: true },
  petEmoji: { type: Function, required: true },
})

const emit = defineEmits(['close', 'submit-lab', 'submit-imaging', 'submit-hospitalization', 'submit-surgery'])
</script>
