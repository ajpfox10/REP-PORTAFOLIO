<template>
  <div v-show="active === 0">
    <div class="section-title">{{ t('evolutions.generalData') }}</div>
    <div class="form-grid">
      <div class="field field--full" style="position:relative">
        <label>{{ t('evolutions.patientLabel') }} <span class="req">*</span></label>
        <input
          :value="patientSearch"
          type="search"
          :placeholder="t('evolutions.patientSearchPlaceholder')"
          :disabled="saving"
          @input="emit('search-patients', $event.target.value)"
          autocomplete="off"
        />
        <div v-if="patientSearching" class="autocomplete autocomplete--msg">&#x23F3; Buscando pacientes&#x2026;</div>
        <div v-else-if="patientSearchError" class="autocomplete autocomplete--msg autocomplete--error">&#x26A0; {{ patientSearchError }}</div>
        <div v-else-if="patientResults.length" class="autocomplete" role="listbox" :aria-label="t('common.searchResults')">
          <button
            v-for="pt in patientResults"
            :key="pt.id"
            type="button"
            class="autocomplete__item"
            role="option"
            :aria-label="t('common.selectPatient')"
            @click="emit('select-patient', pt)"
          >
            {{ petEmoji(pt.species) }} <b>{{ pt.name }}</b>
            <span v-if="pt.hc_number" class="autocomplete__owner"> | HC {{ pt.hc_number }}</span>
            <span class="autocomplete__owner">- {{ pt.primary_owner || '' }}</span>
          </button>
        </div>
        <div v-else-if="patientSearched && !form.patientId" class="autocomplete autocomplete--msg">Sin resultados para &#x201C;{{ patientSearch }}&#x201D;</div>
        <div v-if="form.patientId" class="selected-patient">&#x2705; {{ selectedPatientLabel }}</div>
        <span v-if="errors.patientId" class="field-error">{{ errors.patientId }}</span>
      </div>

      <div class="field field--full">
        <label>{{ t('evolutions.chiefComplaint') }} <span class="req">*</span></label>
        <textarea v-model.trim="form.chiefComplaint" rows="2" :placeholder="t('evolutions.chiefComplaint')" :disabled="saving" />
        <span v-if="errors.chiefComplaint" class="field-error">{{ errors.chiefComplaint }}</span>
      </div>

      <div class="field field--full">
        <label>{{ t('evolutions.reasonForVisit') }}</label>
        <input v-model.trim="form.reasonForVisit" type="text" :placeholder="t('evolutions.reasonForVisit')" :disabled="saving" />
      </div>

      <div class="field">
        <label>{{ t('evolutions.visitDate') }}</label>
        <input v-model="form.visitDate" type="date" :disabled="saving" />
      </div>

      <div class="field field--full">
        <label>{{ t('evolutions.notes') }}</label>
        <textarea v-model.trim="form.notes" rows="2" :placeholder="t('evolutions.notes')" :disabled="saving" />
      </div>
    </div>

    <div class="section-title" style="margin-top:18px">{{ t('evolutions.vitalSigns') }}</div>
    <div class="form-grid">
      <div class="field">
        <label>{{ t('evolutions.weight') }}</label>
        <input v-model.number="form.weightKg" type="number" step="0.01" min="0" placeholder="4.20" :disabled="saving" />
      </div>
      <div class="field">
        <label>{{ t('evolutions.temperature') }}</label>
        <input v-model.number="form.temperatureCelsius" type="number" step="0.1" placeholder="38.5" :disabled="saving" />
      </div>
      <div class="field">
        <label>{{ t('evolutions.heartRate') }}</label>
        <input v-model.number="form.heartRate" type="number" min="0" placeholder="80" :disabled="saving" />
      </div>
      <div class="field">
        <label>{{ t('evolutions.respiratoryRate') }}</label>
        <input v-model.number="form.respiratoryRate" type="number" min="0" placeholder="20" :disabled="saving" />
      </div>
      <div class="field">
        <label>{{ t('evolutions.systolicBp') }}</label>
        <input v-model.number="form.systolicBp" type="number" min="0" placeholder="120" :disabled="saving" />
      </div>
      <div class="field">
        <label>{{ t('evolutions.diastolicBp') }}</label>
        <input v-model.number="form.diastolicBp" type="number" min="0" placeholder="80" :disabled="saving" />
      </div>
      <div class="field">
        <label>{{ t('evolutions.spo2') }}</label>
        <input v-model.number="form.spo2Percent" type="number" min="0" max="100" step="0.1" placeholder="98.0" :disabled="saving" />
      </div>
      <div class="field">
        <label>{{ t('evolutions.bodyConditionScore') }}</label>
        <input v-model.number="form.bodyConditionScore" type="number" min="1" max="9" step="0.5" placeholder="5" :disabled="saving" />
      </div>
    </div>
  </div>

  <div v-show="active === 1">
    <div class="section-title">{{ t('evolutions.history') }}</div>
    <div class="form-grid">
      <div class="field field--full">
        <label>{{ t('evolutions.history') }}</label>
        <textarea v-model.trim="form.currentIllnessHistory" rows="3" :placeholder="t('evolutions.history')" :disabled="saving" />
      </div>
      <div class="field">
        <label>{{ t('evolutions.duration') }}</label>
        <input v-model.trim="form.illnessDuration" type="text" placeholder="Ej: 3 dias, 2 semanas" :disabled="saving" />
      </div>
      <div class="field">
        <label>{{ t('evolutions.onset') }}</label>
        <input v-model.trim="form.illnessOnset" type="text" placeholder="Ej: brusco, progresivo, intermitente" :disabled="saving" />
      </div>
      <div class="field">
        <label>{{ t('evolutions.appetite') }}</label>
        <select v-model="form.appetite" :disabled="saving">
          <option value="">{{ t('common.choose') }}</option>
          <option value="normal">Normal</option>
          <option value="increased">Aumentado (polifagia)</option>
          <option value="decreased">Disminuido (hiporexia)</option>
          <option value="absent">Ausente (anorexia)</option>
        </select>
      </div>
      <div class="field">
        <label>{{ t('evolutions.thirst') }}</label>
        <select v-model="form.thirst" :disabled="saving">
          <option value="">{{ t('common.choose') }}</option>
          <option value="normal">Normal</option>
          <option value="increased">Aumentada (polidipsia)</option>
          <option value="decreased">Disminuida</option>
          <option value="absent">Ausente</option>
        </select>
      </div>
      <div class="field">
        <label>{{ t('evolutions.urination') }}</label>
        <select v-model="form.urination" :disabled="saving">
          <option value="">{{ t('common.choose') }}</option>
          <option value="normal">Normal</option>
          <option value="increased">Aumentada (poliuria)</option>
          <option value="decreased">Disminuida (oliguria)</option>
          <option value="absent">Ausente (anuria)</option>
        </select>
      </div>
      <div class="field">
        <label>{{ t('evolutions.defecation') }}</label>
        <select v-model="form.defecation" :disabled="saving">
          <option value="">{{ t('common.choose') }}</option>
          <option value="normal">Normal</option>
          <option value="increased">Aumentada</option>
          <option value="decreased">Disminuida</option>
          <option value="absent">Ausente</option>
          <option value="diarrhea">Diarrea</option>
          <option value="constipation">Constipacion</option>
        </select>
      </div>
    </div>

    <div class="section-title" style="margin-top:16px">{{ t('evolutions.symptoms') }}</div>
    <div class="checkbox-grid">
      <label class="checkbox-label"><input type="checkbox" v-model="form.vomiting" :disabled="saving" /> {{ t('evolutions.vomiting') }}</label>
      <label class="checkbox-label"><input type="checkbox" v-model="form.coughing" :disabled="saving" /> {{ t('evolutions.coughing') }}</label>
      <label class="checkbox-label"><input type="checkbox" v-model="form.sneezing" :disabled="saving" /> {{ t('evolutions.sneezing') }}</label>
      <label class="checkbox-label"><input type="checkbox" v-model="form.pruritus" :disabled="saving" /> {{ t('evolutions.pruritus') }}</label>
      <label class="checkbox-label"><input type="checkbox" v-model="form.locomotionIssues" :disabled="saving" /> {{ t('evolutions.locomotionIssues') }}</label>
      <label class="checkbox-label"><input type="checkbox" v-model="form.contactWithAnimals" :disabled="saving" /> {{ t('evolutions.contactWithAnimals') }}</label>
    </div>
    <div class="form-grid" style="margin-top:10px">
      <div class="field field--full">
        <label>{{ t('evolutions.otherSigns') }}</label>
        <textarea v-model.trim="form.otherSigns" rows="2" :placeholder="t('evolutions.otherSigns')" :disabled="saving" />
      </div>
    </div>

    <div class="section-title" style="margin-top:16px">Antecedentes</div>
    <div class="form-grid">
      <div class="field">
        <label>{{ t('evolutions.feedingType') }}</label>
        <select v-model="form.feedingType" :disabled="saving">
          <option value="">{{ t('common.choose') }}</option>
          <option value="commercial">Balanceado comercial</option>
          <option value="homemade">Casero</option>
          <option value="mixed">Mixto</option>
          <option value="raw">BARF / Crudo</option>
        </select>
      </div>
      <div class="field">
        <label>Marca / alimento especifico</label>
        <input v-model.trim="form.feedingBrand" type="text" placeholder="Ej: Royal Canin Adult" :disabled="saving" />
      </div>
      <div class="field">
        <label>Ambiente</label>
        <select v-model="form.environment" :disabled="saving">
          <option value="">{{ t('common.choose') }}</option>
          <option value="indoor">Interior</option>
          <option value="outdoor">Exterior</option>
          <option value="both">Mixto (interior/exterior)</option>
        </select>
      </div>
      <div class="field">
        <label>Viajes recientes</label>
        <input v-model.trim="form.recentTravel" type="text" placeholder="Destino y fecha aproximada..." :disabled="saving" />
      </div>
      <div class="field field--full">
        <label>{{ t('evolutions.vaccinationHistory') }}
          <span v-if="loadingHistory" class="history-loading">&#x23F3; cargando...</span>
          <span v-else-if="form.patientId && !form.vaccinationHistory" class="history-empty">sin registros</span>
        </label>
        <textarea v-model.trim="form.vaccinationHistory" rows="3" placeholder="Vacunas aplicadas, fechas y laboratorio..." :disabled="saving" />
      </div>
      <div class="field field--full">
        <label>{{ t('evolutions.dewormingHistory') }}
          <span v-if="loadingHistory" class="history-loading">&#x23F3; cargando...</span>
          <span v-else-if="form.patientId && !form.dewormingHistory" class="history-empty">sin registros</span>
        </label>
        <textarea v-model.trim="form.dewormingHistory" rows="3" placeholder="Antiparasitarios internos/externos, productos y fechas..." :disabled="saving" />
      </div>
      <div class="field field--full">
        <label>{{ t('evolutions.previousIllnesses') }}</label>
        <textarea v-model.trim="form.previousIllnesses" rows="2" :placeholder="t('evolutions.previousIllnessesPlaceholder')" :disabled="saving" />
      </div>
      <div class="field field--full">
        <label>{{ t('evolutions.previousSurgeries') }}
          <span v-if="loadingHistory" class="history-loading">&#x23F3; cargando...</span>
          <span v-else-if="form.patientId && !form.previousSurgeries" class="history-empty">sin cirugias</span>
        </label>
        <textarea v-model.trim="form.previousSurgeries" rows="3" :placeholder="t('evolutions.previousProceduresPlaceholder')" :disabled="saving" />
      </div>
      <div class="field field--full">
        <label>{{ t('evolutions.currentMedications') }}</label>
        <textarea v-model.trim="form.currentMedications" rows="2" :placeholder="t('evolutions.currentMedicationsPlaceholder')" :disabled="saving" />
      </div>
      <div class="field field--full">
        <label>{{ t('evolutions.ownerObservations') }}</label>
        <textarea v-model.trim="form.ownerObservations" rows="2" :placeholder="t('evolutions.ownerObservationsPlaceholder')" :disabled="saving" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { t } from '../../i18n'

const props = defineProps({
  active: { type: Number, required: true },
  errors: { type: Object, required: true },
  form: { type: Object, required: true },
  loadingHistory: Boolean,
  patientResults: { type: Array, required: true },
  patientSearch: { type: String, required: true },
  patientSearching: { type: Boolean, default: false },
  patientSearchError: { type: String, default: '' },
  patientSearched: { type: Boolean, default: false },
  saving: Boolean,
  selectedPatientLabel: { type: String, required: true },
})

const emit = defineEmits(['search-patients', 'select-patient'])

function petEmoji(species) {
  if (!species) return '\u{1F43E}'
  const sl = String(species).toLowerCase()
  const map = { perro: '\u{1F436}', dog: '\u{1F436}', gato: '\u{1F431}', cat: '\u{1F431}', conejo: '\u{1F430}', rabbit: '\u{1F430}', loro: '\u{1F99C}', bird: '\u{1F99C}', pez: '\u{1F41F}', fish: '\u{1F41F}', tortuga: '\u{1F422}', reptile: '\u{1F98E}', hamster: '\u{1F439}' }
  return map[sl] || '\u{1F43E}'
}
</script>

<style scoped>
/* .autocomplete base (position/fondo/borde) viene de main.css global; acá solo el variante mensaje */
.autocomplete--msg {
  padding: 10px 13px;
  font-size: 0.85rem;
  color: var(--text-3);
}
.autocomplete--error {
  color: var(--danger);
}
</style>
