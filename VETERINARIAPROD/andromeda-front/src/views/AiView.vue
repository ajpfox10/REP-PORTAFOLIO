<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h2 class="page-title">Inteligencia artificial</h2>
        <p class="page-sub">Diagnóstico asistido, evaluación de riesgo y chatbot clínico.</p>
      </div>
      <div class="header-actions">
        <BaseButton variant="ghost" @click="loadPatients" :disabled="loadingPatients">Actualizar pacientes</BaseButton>
      </div>
    </div>

    <div v-if="error" class="alert alert--error">{{ error }}</div>
    <div v-if="featureWarning" class="alert alert--warning">{{ featureWarning }}</div>

    <div class="grid">
      <section class="card">
        <h3>Diagnóstico asistido</h3>
        <div class="field">
          <label for="diag-patient">Paciente</label>
          <select id="diag-patient" name="diag-patient" v-model="diagnosisForm.patientId">
            <option value="">Seleccionar</option>
            <option v-for="p in patients" :key="p.id" :value="String(p.id)">{{ p.name }}</option>
          </select>
        </div>
        <div class="field">
          <label for="diag-symptoms">Síntomas</label>
          <input id="diag-symptoms" name="diag-symptoms" v-model.trim="diagnosisForm.symptoms" type="text" placeholder="vómitos, diarrea, letargo" maxlength="2000" />
        </div>
        <div class="field">
          <label for="diag-anamnesis">Anamnesis</label>
          <textarea id="diag-anamnesis" name="diag-anamnesis" v-model.trim="diagnosisForm.anamnesis" rows="4" placeholder="Contexto clínico adicional" maxlength="5000" />
        </div>
        <BaseButton @click="runDiagnosis" :disabled="loadingDiagnosis || loadingAiFeatures || !aiFeatures.diagnosis">Analizar</BaseButton>

        <div v-if="diagnosisResult" class="result">
          <div class="result-head">
            <strong>Urgencia: {{ diagnosisResult.urgency || 'routine' }}</strong>
            <span>{{ diagnosisResult.patient?.name }}</span>
          </div>
          <div v-if="diagnosisResult.diagnoses?.length" class="stack">
            <article v-for="(item, index) in diagnosisResult.diagnoses" :key="index" class="result-item">
              <strong>{{ item.name }}</strong>
              <span>Probabilidad: {{ pct(item.probability) }}</span>
              <p>{{ item.reasoning }}</p>
            </article>
          </div>
          <p v-else class="muted">Sin diagnósticos devueltos por el servicio.</p>
        </div>
      </section>

      <section class="card">
        <h3>Riesgo del paciente</h3>
        <div class="field">
          <label for="risk-patient">Paciente</label>
          <select id="risk-patient" name="risk-patient" v-model="riskPatientId">
            <option value="">Seleccionar</option>
            <option v-for="p in patients" :key="p.id" :value="String(p.id)">{{ p.name }}</option>
          </select>
        </div>
        <BaseButton @click="loadRisk" :disabled="loadingRisk || loadingAiFeatures || !aiFeatures.risk">Evaluar riesgo</BaseButton>

        <div v-if="riskResult" class="result">
          <div class="result-head">
            <strong>Nivel general: {{ riskResult.overallLevel || riskResult.overall_level || '-' }}</strong>
            <span>{{ riskResult.patient?.name }}</span>
          </div>
          <ul v-if="riskResult.recommendations?.length" class="bullet-list">
            <li v-for="(item, index) in riskResult.recommendations" :key="index">{{ item }}</li>
          </ul>
          <div v-if="riskHistory.length" class="history">
            <strong>Historial reciente</strong>
            <div class="history-list">
              <span v-for="row in riskHistory" :key="row.id" class="history-chip">
                {{ row.overall_level }} · {{ shortDate(row.computed_at) }}
              </span>
            </div>
          </div>
        </div>
      </section>
    </div>

    <section class="card">
      <h3>Chat clínico</h3>
      <div class="chat-toolbar">
        <div class="field field--grow">
          <label for="chat-patient">Paciente opcional</label>
          <select id="chat-patient" name="chat-patient" v-model="chatPatientId">
            <option value="">Sin contexto</option>
            <option v-for="p in patients" :key="p.id" :value="String(p.id)">{{ p.name }}</option>
          </select>
        </div>
        <BaseButton variant="ghost" @click="resetChat">Nueva sesión</BaseButton>
      </div>
      <div class="chat-box">
        <article v-for="(msg, index) in chatMessages" :key="index" class="chat-msg" :class="`chat-msg--${msg.role}`">
          <strong>{{ msg.role === 'assistant' ? 'IA' : 'Usuario' }}</strong>
          <p>{{ msg.content }}</p>
        </article>
        <div v-if="!chatMessages.length" class="empty-state">Todavía no hay mensajes.</div>
      </div>
      <div class="chat-input">
        <label for="chat-input" class="sr-only">Mensaje del chat clínico</label>
        <textarea id="chat-input" name="chat-input" v-model.trim="chatInput" rows="3" placeholder="Escribí una consulta clínica..." maxlength="3000" />
        <BaseButton @click="sendChat" :disabled="loadingChat || loadingAiFeatures || !aiFeatures.chat || !chatInput">Enviar</BaseButton>
      </div>
    </section>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import BaseButton from '../components/base/BaseButton.vue'
import { aiApi, patientsApi } from '../api'
import { adminUsersApi } from '../api/adminUsers'
import { useAuthStore } from '../stores/auth'
import { extractDetailedErrorMessage } from '../utils/errors'

const auth = useAuthStore()
const error = ref('')
const loadingPatients = ref(false)
const loadingAiFeatures = ref(false)
const loadingDiagnosis = ref(false)
const loadingRisk = ref(false)
const loadingChat = ref(false)
const aiFeatures = ref({ diagnosis: true, risk: true, chat: true })
const featureWarning = ref('')

const patients = ref([])
const diagnosisResult = ref(null)
const riskResult = ref(null)
const riskHistory = ref([])
const chatMessages = ref([])
const chatSessionId = ref(null)
const chatInput = ref('')
const chatPatientId = ref('')
const riskPatientId = ref('')
const diagnosisForm = ref({
  patientId: '',
  symptoms: '',
  anamnesis: '',
})

function asArray(value) {
  return Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : []
}

function pct(value) {
  const num = Number(value || 0)
  return `${Math.round(num * 100)}%`
}

function isFeatureOn(value) {
  return value === true || value === 1 || value === '1' || value === 'true'
}

function shortDate(value) {
  if (!value) return '-'
  return new Date(value).toLocaleDateString('es-AR')
}

async function loadPatients() {
  loadingPatients.value = true
  error.value = ''
  try {
    const { data } = await patientsApi.list({ limit: 100 })
    patients.value = asArray(data?.data || data).map((row) => ({
      id: row.id,
      name: row.name || row.patient_name || `Paciente ${row.id}`,
    }))
  } catch (e) {
    error.value = extractDetailedErrorMessage(e, 'No se pudieron cargar los pacientes.', { context: 'Carga de pacientes para IA' })
  } finally {
    loadingPatients.value = false
  }
}

async function loadAiFeatureFlags() {
  if (!auth.orgId) return
  loadingAiFeatures.value = true
  featureWarning.value = ''
  try {
    const { data } = await adminUsersApi.getFeatureFlags(auth.orgId)
    const flags = data?.data?.flags || data?.flags || {}
    aiFeatures.value = {
      diagnosis: isFeatureOn(flags.ai_diagnosis),
      risk: isFeatureOn(flags.ai_risk_assessment),
      chat: isFeatureOn(flags.ai_chatbot),
    }
  } catch (e) {
    aiFeatures.value = { diagnosis: false, risk: false, chat: false }
    featureWarning.value = extractDetailedErrorMessage(e, 'No se pudo cargar la configuración de IA. Las funciones quedan bloqueadas hasta reintentar.', { context: 'Feature flags de IA' })
  } finally {
    loadingAiFeatures.value = false
  }
}

async function runDiagnosis() {
  if (!aiFeatures.value.diagnosis) return
  if (!diagnosisForm.value.patientId || !diagnosisForm.value.symptoms) {
    error.value = 'Seleccioná un paciente y cargá al menos un síntoma para ejecutar el diagnóstico asistido.'
    return
  }
  loadingDiagnosis.value = true
  error.value = ''
  try {
    const payload = {
      patientId: Number(diagnosisForm.value.patientId),
      symptoms: diagnosisForm.value.symptoms.split(',').map((item) => item.trim()).filter(Boolean),
      anamnesis: diagnosisForm.value.anamnesis || undefined,
    }
    const { data } = await aiApi.diagnosis(payload)
    diagnosisResult.value = data?.data || null
  } catch (e) {
    error.value = extractDetailedErrorMessage(e, 'No se pudo ejecutar el diagnóstico asistido.', { context: 'Diagnóstico asistido IA' })
  } finally {
    loadingDiagnosis.value = false
  }
}

async function loadRisk() {
  if (!aiFeatures.value.risk) return
  if (!riskPatientId.value) {
    error.value = 'Seleccioná un paciente para evaluar el riesgo.'
    return
  }
  loadingRisk.value = true
  error.value = ''
  try {
    const [riskResultResponse, historyResultResponse] = await Promise.allSettled([
      aiApi.risk(riskPatientId.value),
      aiApi.riskHistory(riskPatientId.value),
    ])
    if (riskResultResponse.status === 'rejected') throw riskResultResponse.reason
    const risk = riskResultResponse.value?.data
    riskResult.value = risk?.data || null
    if (historyResultResponse.status === 'fulfilled') {
      riskHistory.value = asArray(historyResultResponse.value?.data?.data)
    } else {
      riskHistory.value = []
      featureWarning.value = extractDetailedErrorMessage(historyResultResponse.reason, 'No se pudo cargar el historial de riesgo.', { context: 'Historial de riesgo IA' })
    }
  } catch (e) {
    error.value = extractDetailedErrorMessage(e, 'No se pudo calcular el riesgo del paciente.', { context: 'Evaluación de riesgo IA' })
  } finally {
    loadingRisk.value = false
  }
}

function resetChat() {
  chatSessionId.value = null
  chatMessages.value = []
  chatInput.value = ''
}

async function sendChat() {
  if (!aiFeatures.value.chat) return
  if (!chatInput.value) {
    error.value = 'Escribí una consulta para enviar al chat clínico.'
    return
  }
  loadingChat.value = true
  error.value = ''
  const userMessage = chatInput.value
  chatMessages.value.push({ role: 'user', content: userMessage })
  chatInput.value = ''
  try {
    if (!chatSessionId.value) {
      const { data } = await aiApi.chatStart({
        message: userMessage,
        patientId: chatPatientId.value ? Number(chatPatientId.value) : undefined,
      })
      const payload = data?.data || {}
      chatSessionId.value = payload.sessionId || null
      chatMessages.value.push({ role: 'assistant', content: payload.response || 'Sin respuesta.' })
    } else {
      const { data } = await aiApi.chatReply(chatSessionId.value, { message: userMessage })
      chatMessages.value.push({ role: 'assistant', content: data?.data?.response || 'Sin respuesta.' })
    }
  } catch (e) {
    chatMessages.value.pop()
    error.value = extractDetailedErrorMessage(e, 'No se pudo completar la conversación.', { context: 'Chat clínico IA' })
  } finally {
    loadingChat.value = false
  }
}

onMounted(() => {
  loadPatients()
  loadAiFeatureFlags()
})
</script>

<style scoped>
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
.page { display: flex; flex-direction: column; gap: 18px; }
.page-header, .header-actions, .chat-toolbar, .chat-input, .result-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.page-title { font-size: 1.4rem; font-weight: 700; color: var(--text); }
.page-sub { color: var(--text-3); margin-top: 4px; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
.card { background: var(--white); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); padding: 20px; }
.card h3 { margin-bottom: 14px; font-size: 1rem; color: var(--text); }
.field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
.field--grow { flex: 1; margin-bottom: 0; }
.field label { font-size: 0.82rem; color: var(--text-3); font-weight: 600; }
.field select, .field input, .field textarea, .chat-input textarea { border: 1px solid var(--border); border-radius: var(--radius); padding: 10px 12px; font: inherit; background: var(--white); }
.result { margin-top: 16px; padding: 14px; border-radius: var(--radius); background: var(--bg); border: 1px solid var(--border); }
.stack { display: flex; flex-direction: column; gap: 10px; margin-top: 10px; }
.result-item { padding: 12px; border-radius: var(--radius); background: var(--white); border: 1px solid var(--border); }
.result-item strong, .history strong { display: block; margin-bottom: 4px; color: var(--text); }
.result-item span, .muted { color: var(--text-3); font-size: 0.84rem; }
.result-item p { margin-top: 8px; line-height: 1.45; color: var(--text-2); }
.bullet-list { margin: 12px 0 0; padding-left: 18px; color: var(--text-2); line-height: 1.7; }
.history { margin-top: 14px; }
.history-list { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.history-chip { padding: 6px 10px; border-radius: 999px; background: var(--white); border: 1px solid var(--border); font-size: 0.78rem; color: var(--text-2); }
.chat-box { min-height: 220px; max-height: 420px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding: 14px; border-radius: var(--radius); background: var(--bg); border: 1px solid var(--border); }
.chat-msg { max-width: 86%; padding: 12px 14px; border-radius: 16px; line-height: 1.45; }
.chat-msg strong { display: block; margin-bottom: 6px; font-size: 0.8rem; }
.chat-msg p { white-space: pre-wrap; }
.chat-msg--user { align-self: flex-end; background: var(--primary); color: var(--white); }
.chat-msg--assistant { align-self: flex-start; background: var(--white); border: 1px solid var(--border); color: var(--text); }
.chat-input { margin-top: 14px; align-items: flex-end; }
.chat-input textarea { flex: 1; min-height: 88px; }
.empty-state, .alert { padding: 18px; border-radius: var(--radius-lg); background: var(--white); box-shadow: var(--shadow-sm); }
.alert--error { color: var(--danger); }
.alert--warning { color: #8a5a00; background: #fff8e6; border: 1px solid #f0d38a; box-shadow: none; }
@media (max-width: 768px) {
  .page-header, .chat-toolbar, .chat-input, .result-head { align-items: stretch; flex-direction: column; }
  .chat-msg { max-width: 100%; }
}
</style>
