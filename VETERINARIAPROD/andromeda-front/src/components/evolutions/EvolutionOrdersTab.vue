<template>
  <div v-show="active">
    <div class="orders-intro">
      <strong>Órdenes vinculadas a esta evolución</strong>
      <span>Todo pedido diagnóstico creado acá queda unido a la ficha clínica que estás guardando.</span>
    </div>

    <div class="section-title">Laboratorio</div>
    <div class="form-grid">
      <div class="field">
        <label>Prioridad</label>
        <select v-model="form.labOrder.priority" :disabled="saving">
          <option value="routine">Rutina</option>
          <option value="urgent">Urgente</option>
          <option value="emergency">Emergencia</option>
        </select>
      </div>
      <div class="field field--full">
        <label>Notas clínicas para laboratorio</label>
        <textarea v-model.trim="form.labOrder.clinicalNotes" rows="2" placeholder="Motivo del pedido, sospecha diagnóstica, observaciones..." :disabled="saving" />
      </div>
    </div>
    <div v-if="loadingLabTests" class="loading-state" style="padding:20px 0">
      <span class="spin spin--dark" /> Cargando pruebas de laboratorio...
    </div>
    <div v-else class="tests-catalog">
      <div v-for="(tests, category) in groupedLabTests" :key="category" class="test-category">
        <div class="test-category__title">{{ category }}</div>
        <div class="test-category__items">
          <label v-for="test in tests" :key="test.id" class="test-checkbox-label">
            <input v-model="form.labOrder.tests" type="checkbox" :value="test.id" :disabled="saving" />
            <div class="test-info">
              <strong>{{ test.name }}</strong>
              <span v-if="test.code" class="sub">{{ test.code }}</span>
            </div>
          </label>
        </div>
      </div>
    </div>

    <div class="section-title" style="margin-top:18px">Imágenes</div>
    <div class="form-grid">
      <div class="field">
        <label>Tipo de estudio</label>
        <select v-model="form.imagingOrder.imagingTypeId" :disabled="saving || loadingImagingTypes">
          <option value="">{{ loadingImagingTypes ? 'Cargando tipos...' : 'Seleccionar estudio' }}</option>
          <option v-for="type in imagingTypes" :key="type.id" :value="type.id">
            {{ type.name }}{{ type.modality ? ' | ' + type.modality : '' }}
          </option>
        </select>
      </div>
      <div class="field">
        <label>Prioridad</label>
        <select v-model="form.imagingOrder.priority" :disabled="saving">
          <option value="routine">Rutina</option>
          <option value="urgent">Urgente</option>
          <option value="emergency">Emergencia</option>
        </select>
      </div>
      <div class="field">
        <label>Región anatómica</label>
        <input v-model.trim="form.imagingOrder.bodyRegion" type="text" placeholder="Tórax, abdomen, miembro posterior..." :disabled="saving" />
      </div>
      <label class="checkbox-label">
        <input v-model="form.imagingOrder.sedationRequired" type="checkbox" :disabled="saving" />
        Requiere sedación
      </label>
      <div class="field field--full">
        <label>Indicación clínica</label>
        <textarea v-model.trim="form.imagingOrder.clinicalIndication" rows="3" placeholder="Sospecha clínica, hallazgos del examen, objetivo del estudio..." :disabled="saving" />
      </div>
    </div>

    <div class="section-title" style="margin-top:18px">Internación</div>
    <div class="form-grid">
      <div class="field">
        <label>Veterinario responsable</label>
        <select v-model="form.hospitalizationOrder.responsibleVetId" :disabled="saving || loadingProfessionals">
          <option value="">{{ loadingProfessionals ? 'Cargando profesionales...' : 'Seleccionar veterinario' }}</option>
          <option v-for="professional in hospitalizationProfessionals" :key="professional.id" :value="String(professional.id)">
            {{ professional.label }}
          </option>
        </select>
      </div>
      <div class="field">
        <label>Sala</label>
        <select v-model="form.hospitalizationOrder.wardId" :disabled="saving || wardsLoading" @change="form.hospitalizationOrder.kennelId = ''">
          <option value="">{{ wardsLoading ? 'Cargando salas...' : 'Seleccionar sala' }}</option>
          <option v-for="ward in availableWards" :key="ward.id" :value="ward.id">
            {{ ward.name }}{{ ward.available_kennels != null ? ' (' + ward.available_kennels + ' libres)' : '' }}
          </option>
        </select>
      </div>
      <div class="field">
        <label>Jaula</label>
        <select v-model="form.hospitalizationOrder.kennelId" :disabled="saving || !form.hospitalizationOrder.wardId">
          <option value="">Sin jaula asignada</option>
          <option v-for="kennel in freeKennelsForEvolutionWard" :key="kennel.id" :value="kennel.id">
            Jaula {{ kennel.number }}{{ kennel.kennel_type ? ' (' + kennel.kennel_type + ')' : '' }}
          </option>
        </select>
      </div>
      <div class="field">
        <label>Peso ingreso</label>
        <input v-model.number="form.hospitalizationOrder.admissionWeight" type="number" min="0" step="0.01" placeholder="Ej: 12.4" :disabled="saving" />
      </div>
      <div class="field">
        <label>Alta estimada</label>
        <input v-model="form.hospitalizationOrder.estimatedDischargeDate" type="date" :disabled="saving" />
      </div>
      <div class="field field--full">
        <label>Motivo de internación</label>
        <textarea v-model.trim="form.hospitalizationOrder.hospitalizationReason" rows="2" placeholder="Razón clínica para internar al paciente..." :disabled="saving" />
      </div>
      <div class="field field--full">
        <label>Diagnóstico de ingreso</label>
        <textarea v-model.trim="form.hospitalizationOrder.admissionDiagnosis" rows="2" placeholder="Diagnóstico inicial o presuntivo..." :disabled="saving" />
      </div>
      <div class="field field--full">
        <label>Indicaciones especiales</label>
        <textarea v-model.trim="form.hospitalizationOrder.specialInstructions" rows="2" placeholder="Aislamiento, monitoreo, cuidados, dieta..." :disabled="saving" />
      </div>
    </div>

    <div class="section-title" style="margin-top:18px">Cirugía</div>
    <div class="form-grid">
      <div class="field">
        <label>Tipo de cirugía</label>
        <select v-model="form.surgeryOrder.surgeryTypeId" :disabled="saving || loadingSurgeryTypes">
          <option value="">{{ loadingSurgeryTypes ? 'Cargando tipos...' : 'Seleccionar cirugía' }}</option>
          <optgroup v-for="(types, category) in groupedSurgeryTypes" :key="category" :label="category">
            <option v-for="type in types" :key="type.id" :value="type.id">
              {{ type.name }}{{ type.estimated_duration_minutes ? ' | ' + type.estimated_duration_minutes + ' min est.' : '' }}
            </option>
          </optgroup>
        </select>
      </div>
      <div class="field">
        <label>Cirujano responsable</label>
        <select v-model="form.surgeryOrder.leadSurgeonId" :disabled="saving || loadingProfessionals">
          <option value="">{{ loadingProfessionals ? 'Cargando profesionales...' : 'Seleccionar cirujano' }}</option>
          <option v-for="professional in surgeryProfessionals" :key="professional.id" :value="String(professional.id)">
            {{ professional.label }}
          </option>
        </select>
      </div>
      <div class="field">
        <label>Fecha programada</label>
        <input v-model="form.surgeryOrder.scheduledDate" type="date" :disabled="saving" />
      </div>
      <div class="field">
        <label>Hora estimada</label>
        <input v-model="form.surgeryOrder.startTime" type="time" :disabled="saving" />
      </div>
      <div class="field">
        <label>Urgencia</label>
        <select v-model="form.surgeryOrder.urgency" :disabled="saving">
          <option value="elective">Electiva</option>
          <option value="urgent">Urgente</option>
          <option value="emergency">Emergencia</option>
        </select>
      </div>
      <div class="field field--full">
        <label>Diagnóstico preoperatorio</label>
        <textarea v-model.trim="form.surgeryOrder.preoperativeDiagnosis" rows="2" placeholder="Indicación clínica, diagnóstico presuntivo o definitivo..." :disabled="saving" />
      </div>
      <div class="field field--full">
        <label>Abordaje quirúrgico</label>
        <input v-model.trim="form.surgeryOrder.surgicalApproach" type="text" placeholder="Línea media, lateral, artrotomía, etc." :disabled="saving" />
      </div>
      <div class="field field--full">
        <label>Notas quirúrgicas</label>
        <textarea v-model.trim="form.surgeryOrder.notes" rows="2" placeholder="Preparación, consideraciones anestésicas, materiales, observaciones..." :disabled="saving" />
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  active: Boolean,
  availableWards: { type: Array, required: true },
  form: { type: Object, required: true },
  freeKennelsForEvolutionWard: { type: Array, required: true },
  groupedLabTests: { type: Object, required: true },
  groupedSurgeryTypes: { type: Object, required: true },
  hospitalizationProfessionals: { type: Array, required: true },
  imagingTypes: { type: Array, required: true },
  loadingImagingTypes: Boolean,
  loadingLabTests: Boolean,
  loadingProfessionals: Boolean,
  loadingSurgeryTypes: Boolean,
  saving: Boolean,
  surgeryProfessionals: { type: Array, required: true },
  wardsLoading: Boolean,
})
</script>

<style scoped>
.orders-intro {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  margin-bottom: 14px;
  border: 1px solid #bfdbfe;
  border-radius: var(--radius);
  background: #eff6ff;
}

.orders-intro strong {
  color: #1e3a8a;
  font-size: 0.9rem;
}

.orders-intro span {
  color: var(--text-2);
  font-size: 0.84rem;
  line-height: 1.45;
}
</style>
