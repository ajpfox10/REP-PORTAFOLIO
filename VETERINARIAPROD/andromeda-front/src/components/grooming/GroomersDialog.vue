<template>
  <div class="modal-backdrop" @click.self="$emit('close')">
    <form class="modal" role="dialog" aria-modal="true" aria-labelledby="groomers-title" @submit.prevent="save">
      <div class="modal__header">
        <h3 id="groomers-title">Groomers de la sucursal</h3>
        <button type="button" class="modal__close" aria-label="Cerrar" @click="$emit('close')"><AppIcon name="close" :size="18" /></button>
      </div>
      <div class="form-body">
        <ul v-if="groomers.length" class="groomers">
          <li v-for="g in groomers" :key="g.id">
            <strong>{{ g.name }}</strong>
            <span>{{ commissionLabel(g) }}<template v-if="g.specializations"> · {{ g.specializations }}</template></span>
          </li>
        </ul>
        <p v-else class="groomers__empty">Todavía no hay groomers. Elegí a alguien del equipo para empezar a agendar sesiones.</p>

        <h4 class="groomers__subtitle">Sumar groomer</h4>
        <p v-if="!loadingCandidates && !candidates.length" class="groomers__empty">
          Todo el equipo ya es groomer. Para sumar a alguien nuevo, primero invitalo desde Administración.
        </p>
        <template v-else>
          <div class="field">
            <label for="gr-user">Persona del equipo</label>
            <select id="gr-user" v-model="form.userId" required :disabled="loadingCandidates">
              <option value="">{{ loadingCandidates ? 'Cargando…' : 'Elegí una persona…' }}</option>
              <option v-for="c in candidates" :key="c.id" :value="c.id">{{ c.name }} ({{ c.email }})</option>
            </select>
          </div>
          <div class="form-grid">
            <div class="field">
              <label for="gr-type">Comisión</label>
              <select id="gr-type" v-model="form.commissionType">
                <option value="percentage">Porcentaje</option>
                <option value="fixed">Monto fijo por sesión</option>
              </select>
            </div>
            <div class="field">
              <label for="gr-value">{{ form.commissionType === 'percentage' ? 'Porcentaje (%)' : 'Monto ($)' }}</label>
              <input id="gr-value" v-model.number="form.commissionValue" type="number" min="0" :max="form.commissionType === 'percentage' ? 100 : undefined" step="0.01" />
            </div>
          </div>
          <div class="field">
            <label for="gr-spec">Especialidades</label>
            <input id="gr-spec" v-model.trim="form.specializations" maxlength="255" placeholder="Corte de raza, baño sanitario…" />
          </div>
        </template>
        <p v-if="error" class="field-error">{{ error }}</p>
      </div>
      <div class="modal__actions">
        <button type="button" class="btn-ghost" @click="$emit('close')">Cerrar</button>
        <button v-if="candidates.length" type="submit" class="btn-primary" :disabled="saving || !form.userId">{{ saving ? 'Guardando…' : 'Agregar groomer' }}</button>
      </div>
    </form>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import AppIcon from '../AppIcon.vue'
import { groomingApi } from '../../api'
import { useUiFeedback } from '../../composables/useUiFeedback'
import { extractDetailedErrorMessage, logError } from '../../utils/errors'

defineProps({
  groomers: { type: Array, default: () => [] },
})
const emit = defineEmits(['close', 'changed'])
const { success } = useUiFeedback()

const candidates = ref([])
const loadingCandidates = ref(true)
const saving = ref(false)
const error = ref('')
const form = reactive({ userId: '', commissionType: 'percentage', commissionValue: 0, specializations: '' })

function commissionLabel(g) {
  const value = Number(g.commission_value) || 0
  if (g.commission_type === 'fixed') return `Comisión fija de $${value.toLocaleString('es-AR')}`
  return `Comisión del ${Math.round(value * 1000) / 10}%`
}

async function loadCandidates() {
  loadingCandidates.value = true
  try {
    const { data } = await groomingApi.groomerCandidates()
    candidates.value = data?.data || []
  } catch (err) {
    logError('grooming.groomerCandidates', err)
    candidates.value = []
  } finally {
    loadingCandidates.value = false
  }
}

async function save() {
  saving.value = true
  error.value = ''
  const value = Number(form.commissionValue) || 0
  try {
    await groomingApi.createGroomer({
      userId: Number(form.userId),
      commissionType: form.commissionType,
      commissionValue: form.commissionType === 'percentage' ? value / 100 : value,
      specializations: form.specializations || null,
    })
    success('Groomer agregado.')
    Object.assign(form, { userId: '', commissionValue: 0, specializations: '' })
    emit('changed')
    await loadCandidates()
  } catch (err) {
    error.value = extractDetailedErrorMessage(err, 'No pudimos agregar al groomer.', { context: 'Groomers' })
  } finally {
    saving.value = false
  }
}

onMounted(loadCandidates)
</script>

<style scoped>
.groomers {
  list-style: none;
  margin-bottom: 16px;
}

.groomers li {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 10px 0;
  font-size: 0.86rem;
  color: var(--text-2);
}

.groomers li + li {
  border-top: 1px solid var(--border);
}

.groomers li strong {
  color: var(--text);
}

.groomers__subtitle {
  margin: 4px 0 10px;
  font-size: 0.92rem;
}

.groomers__empty {
  margin-bottom: 12px;
  font-size: 0.86rem;
  color: var(--text-3);
}
</style>
