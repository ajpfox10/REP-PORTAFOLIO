<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h2 class="page-title">Notificaciones</h2>
        <p class="page-sub">Bandeja interna, recordatorios, mensajes y jobs pendientes.</p>
      </div>
      <div class="header-actions">
        <BaseButton variant="ghost" @click="loadAll" :disabled="loading">Actualizar</BaseButton>
        <BaseButton @click="markAllRead" :disabled="loading || !unreadCount">Marcar todo como leído</BaseButton>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card">
        <span class="kpi-label">No leídas</span>
        <strong>{{ unreadCount }}</strong>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">Recordatorios</span>
        <strong>{{ reminders.length }}</strong>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">Mensajes</span>
        <strong>{{ messages.length }}</strong>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">Reintentos</span>
        <strong>{{ retries.length }}</strong>
      </div>
    </div>

    <div class="toolbar">
      <div class="tabs">
        <button v-for="tab in tabs" :key="tab.id" type="button" class="tab-btn" :class="{ 'tab-btn--active': activeTab === tab.id }" @click="activeTab = tab.id">
          {{ tab.label }}
        </button>
      </div>
      <label class="toggle">
        <input id="notifications-unread-only" name="notifications-unread-only" v-model="unreadOnly" type="checkbox" @change="loadInbox" />
        <span>Solo no leídas</span>
      </label>
    </div>

    <div v-if="loading" class="loading-state">Cargando...</div>
    <div v-else-if="error" class="alert alert--error">{{ error }}</div>

    <section v-else-if="activeTab === 'inbox'" class="panel">
      <div v-if="!notifications.length" class="empty-state">No hay notificaciones para mostrar.</div>
      <div v-else class="stack">
        <article v-for="item in notifications" :key="item.id" class="notification-card" :class="{ 'notification-card--unread': !item.read_at }">
          <div class="notification-head">
            <div>
              <strong>{{ item.title || 'Sin título' }}</strong>
              <span class="badge" :class="`badge--${item.severity || 'info'}`">{{ item.severity || 'info' }}</span>
            </div>
            <span class="date">{{ formatDate(item.sent_at) }}</span>
          </div>
          <p class="message">{{ item.message || 'Sin contenido' }}</p>
          <div class="notification-meta">
            <span>{{ item.notification_type || 'general' }}</span>
            <a v-if="item.action_url && isSafeUrl(item.action_url)" :href="item.action_url" target="_blank" rel="noreferrer noopener">Abrir acción</a>
          </div>
          <div class="notification-actions">
            <BaseButton v-if="!item.read_at" size="sm" variant="ghost" @click="markRead(item.id)">Marcar leída</BaseButton>
            <span v-else class="read-ok">Leída</span>
          </div>
        </article>
      </div>
    </section>

    <section v-else-if="activeTab === 'reminders'" class="panel">
      <div v-if="!reminders.length" class="empty-state">No hay recordatorios pendientes.</div>
      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Paciente</th>
              <th>Dueño</th>
              <th>Fecha</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in reminders" :key="item.id">
              <td>{{ item.reminder_type }}</td>
              <td>{{ item.patient_name }}</td>
              <td>{{ item.owner_name }}</td>
              <td>{{ formatDate(item.due_date) }}</td>
              <td>{{ item.status }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-else-if="activeTab === 'messages'" class="panel">
      <div v-if="!messages.length" class="empty-state">No hay mensajes enviados.</div>
      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Canal</th>
              <th>Destino</th>
              <th>Plantilla</th>
              <th>Estado</th>
              <th>Fecha</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in messages" :key="item.id">
              <td>{{ item.channel }}</td>
              <td>{{ item.to_number }}</td>
              <td>{{ item.template_name || 'manual' }}</td>
              <td>{{ item.status }}</td>
              <td>{{ formatDate(item.sent_at) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-else class="panel">
      <div v-if="!retries.length" class="empty-state">No hay jobs en cola de reintento.</div>
      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Canal</th>
              <th>Estado</th>
              <th>Intentos</th>
              <th>Próximo intento</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in retries" :key="item.id">
              <td>{{ item.channel }}</td>
              <td>{{ item.status }}</td>
              <td>{{ item.attempt_count }} / {{ item.max_attempts }}</td>
              <td>{{ formatDate(item.next_attempt_at) }}</td>
              <td>{{ item.last_error || '-' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import BaseButton from '../components/base/BaseButton.vue'
import { notificationsApi } from '../api'
import { extractDetailedErrorMessage } from '../utils/errors'
import { useUiFeedback } from '../composables/useUiFeedback'

const { success } = useUiFeedback()

const tabs = [
  { id: 'inbox', label: 'Bandeja' },
  { id: 'reminders', label: 'Recordatorios' },
  { id: 'messages', label: 'Mensajes' },
  { id: 'retries', label: 'Reintentos' },
]

const activeTab = ref('inbox')
const loading = ref(false)
const error = ref('')
const unreadOnly = ref(false)
const unreadCount = ref(0)
const notifications = ref([])
const reminders = ref([])
const messages = ref([])
const retries = ref([])

function asArray(value) {
  return Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : []
}

function formatDate(value) {
  if (!value) return '-'
  return new Date(value).toLocaleString('es-AR')
}

function isSafeUrl(url) {
  if (typeof url === 'string' && url.startsWith('/')) return true
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:'
  } catch {
    return false
  }
}

async function loadInbox() {
  const { data } = await notificationsApi.inbox({ unreadOnly: unreadOnly.value, limit: 50 })
  notifications.value = asArray(data?.data)
  unreadCount.value = data?.meta?.unreadCount || 0
}

async function loadReminders() {
  const { data } = await notificationsApi.reminders({ limit: 20 })
  reminders.value = asArray(data?.data)
}

async function loadMessages() {
  const { data } = await notificationsApi.messages({ limit: 20 })
  messages.value = asArray(data?.data)
}

async function loadRetries() {
  const { data } = await notificationsApi.retries()
  retries.value = asArray(data?.data)
}

async function loadAll() {
  loading.value = true
  error.value = ''
  const sections = [
    ['bandeja', loadInbox],
    ['recordatorios', loadReminders],
    ['mensajes', loadMessages],
    ['reintentos', loadRetries],
  ]
  const results = await Promise.allSettled(sections.map(([, fn]) => fn()))
  const failed = results
    .map((result, index) => result.status === 'rejected'
      ? `${sections[index][0]}: ${extractDetailedErrorMessage(result.reason, 'falló la carga', { context: `Carga de ${sections[index][0]}` })}`
      : null)
    .filter(Boolean)
  if (failed.length) {
    error.value = `No se pudieron cargar todas las secciones. ${failed.join(' ')}`
  }
  loading.value = false
}

async function markRead(id) {
  try {
    await notificationsApi.markRead(id)
    await loadInbox()
    success('Notificación marcada como leída.')
  } catch (e) {
    error.value = extractDetailedErrorMessage(e, 'No se pudo marcar la notificación.', { context: 'Marcar notificación como leída' })
  }
}

async function markAllRead() {
  try {
    await notificationsApi.markAll()
    await loadInbox()
    success('Bandeja actualizada.')
  } catch (e) {
    error.value = extractDetailedErrorMessage(e, 'No se pudo actualizar la bandeja.', { context: 'Marcar todas las notificaciones como leídas' })
  }
}

onMounted(loadAll)
</script>

<style scoped>
.page { display: flex; flex-direction: column; gap: 18px; }
.page-header, .toolbar, .notification-head, .notification-meta, .notification-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.page-title { font-size: 1.4rem; font-weight: 700; color: var(--text); }
.page-sub { color: var(--text-3); margin-top: 4px; }
.header-actions, .tabs { display: flex; gap: 10px; flex-wrap: wrap; }
.kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 14px; }
.kpi-card, .panel { background: var(--white); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); }
.kpi-card { padding: 18px; border: 1px solid var(--border); }
.kpi-label { display: block; font-size: 0.8rem; color: var(--text-3); margin-bottom: 6px; }
.kpi-card strong { font-size: 1.5rem; color: var(--text); }
.toolbar { flex-wrap: wrap; }
.tab-btn { border: 1px solid var(--border); background: var(--white); padding: 9px 14px; border-radius: 999px; cursor: pointer; font-weight: 600; color: var(--text-2); }
.tab-btn--active { background: var(--primary-xlight); color: var(--primary); border-color: rgba(32, 134, 126, 0.25); }
.toggle { display: flex; align-items: center; gap: 8px; color: var(--text-2); }
.panel { padding: 18px; }
.stack { display: flex; flex-direction: column; gap: 12px; }
.notification-card { border: 1px solid var(--border); border-radius: var(--radius); padding: 14px; background: var(--bg); }
.notification-card--unread { border-color: rgba(32, 134, 126, 0.35); box-shadow: inset 3px 0 0 var(--primary); }
.badge { display: inline-flex; align-items: center; padding: 3px 8px; border-radius: 999px; font-size: 0.72rem; margin-left: 8px; text-transform: uppercase; }
.badge--info { background: #e8f1ff; color: #295b98; }
.badge--warning { background: #fff4db; color: #9a6b00; }
.badge--error { background: #ffe4e1; color: #bf3b2f; }
.badge--success { background: #e7f7ef; color: #1f8a5c; }
.message { color: var(--text); margin: 10px 0; line-height: 1.45; }
.date, .read-ok, .notification-meta { font-size: 0.82rem; color: var(--text-3); }
.table-wrap { overflow-x: auto; }
.table { width: 100%; border-collapse: collapse; }
.table th, .table td { text-align: left; padding: 10px 8px; border-bottom: 1px solid var(--border); font-size: 0.88rem; }
.table th { color: var(--text-3); font-weight: 600; }
.loading-state, .empty-state, .alert { background: var(--white); border-radius: var(--radius-lg); padding: 18px; box-shadow: var(--shadow-sm); }
.alert--error { color: var(--danger); }
@media (max-width: 768px) {
  .page-header, .toolbar, .notification-head, .notification-meta, .notification-actions { align-items: flex-start; flex-direction: column; }
}
</style>
