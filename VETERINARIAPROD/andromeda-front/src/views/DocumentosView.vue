<template>
  <div class="documents">
    <section class="hero">
      <div>
        <h2 class="hero__title">Documentos por mail</h2>
        <p class="hero__subtitle">Casillas configuradas, bandeja documental y asociación manual a pacientes.</p>
      </div>
      <div class="hero__actions">
        <BaseButton variant="ghost" :disabled="loading" @click="loadAll">Actualizar</BaseButton>
        <BaseButton :disabled="savingAccount || Boolean(providersError)" @click="openAccountModal">Nueva cuenta</BaseButton>
        <BaseButton :disabled="savingImport" @click="openImportModal">Importación manual</BaseButton>
      </div>
    </section>

    <div class="kpis">
      <article class="kpi-card">
        <span class="kpi-card__label">Cuentas</span>
        <strong>{{ accounts.length }}</strong>
      </article>
      <article class="kpi-card">
        <span class="kpi-card__label">Documentos</span>
        <strong>{{ inboxRows.length }}</strong>
      </article>
      <article class="kpi-card">
        <span class="kpi-card__label">Sin asociar</span>
        <strong>{{ unassociatedCount }}</strong>
      </article>
      <article class="kpi-card">
        <span class="kpi-card__label">Proveedores</span>
        <strong>{{ providers.length }}</strong>
      </article>
    </div>

    <div v-if="globalError" class="alert alert--error" role="alert">{{ globalError }}</div>
    <div v-if="providersError" class="alert alert--warning" role="alert">{{ providersError }}</div>

    <section class="panel panel--filters">
      <div class="filter-grid">
        <label class="field">
          <span>Cuenta</span>
          <select id="doc-f-account" name="doc-f-account" v-model="filters.accountId" @change="loadInbox">
            <option value="">Todas</option>
            <option v-for="account in accounts" :key="account.id" :value="String(account.id)">
              {{ account.email_address }}
            </option>
          </select>
        </label>

        <label class="field">
          <span>Estado</span>
          <select id="doc-f-status" name="doc-f-status" v-model="filters.associationStatus" @change="loadInbox">
            <option value="">Todos</option>
            <option value="unassociated">Sin asociar</option>
            <option value="associated">Asociados</option>
            <option value="needs_review">Revisar</option>
          </select>
        </label>

        <label class="field">
          <span>Paciente</span>
          <input id="doc-f-patient-search" name="doc-f-patient-search" v-model.trim="patientSearch" type="text" placeholder="Buscar paciente..." @input="handlePatientSearch" />
        </label>

        <label class="field">
          <span>Coincidencia</span>
          <select id="doc-f-patient" name="doc-f-patient" v-model="filters.patientId" @change="loadInbox">
            <option value="">Cualquiera</option>
            <option v-for="patient in patientOptions" :key="patient.id" :value="String(patient.id)">
              {{ patient.name }}
            </option>
          </select>
        </label>
      </div>
    </section>

    <section class="panel panel--stacked">
      <header class="section-head">
        <div>
          <h3>Cuentas de correo</h3>
          <p>Solo las cuentas manuales sincronizan por carga interna en esta etapa.</p>
        </div>
      </header>

      <div v-if="accountsError" class="alert alert--error" role="alert">{{ accountsError }}</div>
      <div v-if="loadingAccounts" class="empty-state">Cargando cuentas...</div>
      <div v-else-if="!accounts.length" class="empty-state">No hay cuentas configuradas.</div>
      <div v-else class="account-grid">
        <article v-for="account in accounts" :key="account.id" class="account-card">
          <div class="account-card__head">
            <div>
              <strong>{{ account.display_name || account.email_address }}</strong>
              <p>{{ account.provider }} · carpeta {{ account.folder_name }}</p>
            </div>
            <span class="badge" :class="account.is_active ? 'badge--active' : 'badge--inactive'">
              {{ account.is_active ? 'Activa' : 'Inactiva' }}
            </span>
          </div>
          <div class="account-card__meta">
            <span>{{ account.email_address }}</span>
            <span v-if="account.last_synced_at">Última sync: {{ formatDate(account.last_synced_at) }}</span>
            <span v-else>Sin sincronización</span>
          </div>
          <p v-if="account.last_error" class="account-card__error">{{ account.last_error }}</p>
          <div class="account-card__actions">
            <BaseButton size="sm" variant="ghost" :disabled="syncingAccountId === account.id" @click="syncAccount(account)">
              {{ syncingAccountId === account.id ? 'Sincronizando...' : 'Sync' }}
            </BaseButton>
            <BaseButton size="sm" variant="ghost" @click="editAccount(account)">Editar</BaseButton>
          </div>
        </article>
      </div>
    </section>

    <section class="panel panel--stacked">
      <header class="section-head">
        <div>
          <h3>Bandeja documental</h3>
          <p>Adjuntos indexados desde correo o carga manual.</p>
        </div>
      </header>

      <div v-if="inboxError" class="alert alert--error" role="alert">{{ inboxError }}</div>
      <div v-if="loadingInbox" class="empty-state">Cargando documentos...</div>
      <div v-else-if="!inboxRows.length" class="empty-state">No hay documentos en la bandeja.</div>
      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Origen</th>
              <th>Archivo</th>
              <th>Paciente</th>
              <th>Categoría</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in inboxRows" :key="row.id">
              <td>{{ formatDate(row.received_at) }}</td>
              <td>
                <div class="cell-stack">
                  <strong>{{ row.from_email }}</strong>
                  <span>{{ row.subject || 'Sin asunto' }}</span>
                </div>
              </td>
              <td>
                <div class="cell-stack">
                  <strong>{{ row.filename }}</strong>
                  <span>{{ row.mime_type }} · {{ formatBytes(row.file_size) }}</span>
                </div>
              </td>
              <td>{{ row.patient_name || 'Sin asociar' }}</td>
              <td>{{ row.document_category || 'external_lab' }}</td>
              <td>
                <div class="cell-stack">
                  <span class="badge" :class="badgeClass(row.association_status)">{{ row.association_status }}</span>
                  <span>{{ row.ingestion_status }}</span>
                </div>
              </td>
              <td>
                <div class="row-actions">
                  <BaseButton size="sm" variant="ghost" @click="viewRow(row)">Ver</BaseButton>
                  <BaseButton size="sm" variant="ghost" @click="downloadRow(row)">Descargar</BaseButton>
                  <BaseButton
                    size="sm"
                    variant="ghost"
                    :disabled="processingRowId === row.id || !canIngest(row)"
                    @click="ingestRow(row)"
                  >
                    {{ processingRowId === row.id ? 'Procesando...' : 'Procesar' }}
                  </BaseButton>
                  <BaseButton size="sm" variant="ghost" @click="openAssociateModal(row)">Asociar</BaseButton>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <BaseModal v-model="showAccountModal" label="Cuenta de correo" labelledby="documents-account-title">
      <div class="modal__header">
        <h3 id="documents-account-title">{{ accountForm.id ? 'Editar cuenta' : 'Nueva cuenta' }}</h3>
        <button class="modal__close" type="button" @click="showAccountModal = false">Cerrar</button>
      </div>

      <div v-if="accountModalError" class="alert alert--error" role="alert">{{ accountModalError }}</div>

      <form class="form" @submit.prevent="submitAccount">
        <label class="field">
          <span>Proveedor</span>
          <select v-model="accountForm.provider" :disabled="Boolean(accountForm.id)">
            <option v-for="provider in providers" :key="provider.key" :value="provider.key">
              {{ provider.label }}
            </option>
          </select>
        </label>

        <label class="field">
          <span>Email</span>
          <input v-model.trim="accountForm.emailAddress" type="email" placeholder="lab@proveedor.com" :disabled="Boolean(accountForm.id)" />
        </label>

        <label class="field">
          <span>Nombre visible</span>
          <input v-model.trim="accountForm.displayName" type="text" placeholder="Laboratorio externo" />
        </label>

        <label class="field">
          <span>Carpeta</span>
          <input v-model.trim="accountForm.folderName" type="text" placeholder="INBOX" />
        </label>

        <label class="toggle">
          <input v-model="accountForm.isActive" type="checkbox" />
          <span>Cuenta activa</span>
        </label>

        <label class="field">
          <span>Settings JSON</span>
          <textarea
            v-model="accountForm.settingsJson"
            rows="8"
            placeholder='{"host":"imap.gmail.com","username":"lab@clinic.com"}'
          />
        </label>

        <div class="modal__actions">
          <BaseButton type="button" variant="ghost" @click="showAccountModal = false">Cancelar</BaseButton>
          <BaseButton type="submit" :disabled="savingAccount">{{ savingAccount ? 'Guardando...' : 'Guardar' }}</BaseButton>
        </div>
      </form>
    </BaseModal>

    <BaseModal v-model="showImportModal" label="Importación manual" labelledby="documents-import-title">
      <div class="modal__header">
        <h3 id="documents-import-title">Importación manual</h3>
        <button class="modal__close" type="button" @click="showImportModal = false">Cerrar</button>
      </div>

      <div v-if="importModalError" class="alert alert--error" role="alert">{{ importModalError }}</div>

      <form class="form" @submit.prevent="submitImport">
        <label class="field">
          <span>Cuenta</span>
          <select v-model="importForm.accountId">
            <option value="">Sin cuenta</option>
            <option v-for="account in accounts" :key="account.id" :value="String(account.id)">
              {{ account.email_address }}
            </option>
          </select>
        </label>

        <label class="field">
          <span>Email de origen</span>
          <input v-model.trim="importForm.fromEmail" type="email" placeholder="resultados@laboratorio.com" />
        </label>

        <label class="field">
          <span>Asunto</span>
          <input v-model.trim="importForm.subject" type="text" placeholder="Resultados PDF" />
        </label>

        <label class="field">
          <span>Archivo</span>
          <input ref="fileInput" type="file" accept="application/pdf,.pdf" multiple @change="handleFilesSelected" />
          <span class="field-hint">{{ selectedFilesLabel }}</span>
        </label>

        <label class="field">
          <span>Categoría</span>
          <select v-model="importForm.documentCategory">
            <option value="external_lab">external_lab</option>
            <option value="imaging">imaging</option>
            <option value="pathology">pathology</option>
            <option value="other">other</option>
          </select>
        </label>

        <label class="field">
          <span>Paciente</span>
          <select v-model="importForm.patientId">
            <option value="">Sin asociar</option>
            <option v-for="patient in patientOptions" :key="patient.id" :value="String(patient.id)">
              {{ patient.name }}
            </option>
          </select>
        </label>

        <div class="modal__actions">
          <BaseButton type="button" variant="ghost" @click="showImportModal = false">Cancelar</BaseButton>
          <BaseButton type="submit" :disabled="savingImport">{{ savingImport ? 'Importando...' : 'Importar' }}</BaseButton>
        </div>
      </form>
    </BaseModal>

    <BaseModal v-model="showAssociateModal" label="Asociar documento" labelledby="documents-associate-title">
      <div class="modal__header">
        <h3 id="documents-associate-title">Asociar documento</h3>
        <button class="modal__close" type="button" @click="showAssociateModal = false">Cerrar</button>
      </div>

      <div v-if="selectedRow" class="detail-card">
        <strong>{{ selectedRow.filename }}</strong>
        <span>{{ selectedRow.from_email }} · {{ selectedRow.subject || 'Sin asunto' }}</span>
      </div>

      <div v-if="associateModalError" class="alert alert--error" role="alert">{{ associateModalError }}</div>

      <form class="form" @submit.prevent="submitAssociation">
        <label class="field">
          <span>Buscar paciente</span>
          <input v-model.trim="associateSearch" type="text" placeholder="Nombre del paciente" @input="handleAssociateSearch" />
        </label>

        <label class="field">
          <span>Paciente</span>
          <select v-model="associateForm.patientId">
            <option value="">Seleccionar</option>
            <option v-for="patient in associateOptions" :key="patient.id" :value="String(patient.id)">
              {{ patient.name }}
            </option>
          </select>
        </label>

        <label class="field">
          <span>Categoría</span>
          <select v-model="associateForm.documentCategory">
            <option value="external_lab">external_lab</option>
            <option value="imaging">imaging</option>
            <option value="pathology">pathology</option>
            <option value="other">other</option>
          </select>
        </label>

        <div class="modal__actions">
          <BaseButton type="button" variant="ghost" @click="showAssociateModal = false">Cancelar</BaseButton>
          <BaseButton type="submit" :disabled="savingAssociation">{{ savingAssociation ? 'Asociando...' : 'Asociar' }}</BaseButton>
        </div>
      </form>
    </BaseModal>

    <BaseModal v-model="showDetailModal" label="Detalle del documento" labelledby="documents-detail-title">
      <div class="modal__header">
        <h3 id="documents-detail-title">Detalle del documento</h3>
        <button class="modal__close" type="button" @click="showDetailModal = false">Cerrar</button>
      </div>

      <div v-if="detailRow" class="detail-grid">
        <div class="detail-item"><span>ID</span><strong>{{ detailRow.id }}</strong></div>
        <div class="detail-item"><span>Paciente</span><strong>{{ detailRow.patient_name || 'Sin asociar' }}</strong></div>
        <div class="detail-item"><span>Origen</span><strong>{{ detailRow.from_email }}</strong></div>
        <div class="detail-item"><span>Asunto</span><strong>{{ detailRow.subject || 'Sin asunto' }}</strong></div>
        <div class="detail-item"><span>Archivo</span><strong>{{ detailRow.filename }}</strong></div>
        <div class="detail-item"><span>Storage</span><strong>{{ detailRow.storage_path || 'Pendiente' }}</strong></div>
        <div class="detail-item"><span>Categoría</span><strong>{{ detailRow.document_category }}</strong></div>
        <div class="detail-item"><span>Estado</span><strong>{{ detailRow.association_status }} / {{ detailRow.ingestion_status }}</strong></div>
      </div>
    </BaseModal>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import BaseButton from '../components/base/BaseButton.vue'
import BaseModal from '../components/base/BaseModal.vue'
import {
  associateDocument,
  badgeClassForAssociation,
  canIngestDocument,
  extractDocumentsError,
  formatDocumentsBytes,
  formatDocumentsDate,
  getDocumentDetail,
  getDocumentDownloadUrl,
  ingestDocument,
  loadDocumentProviders,
  loadDocumentsInbox,
  loadMailAccounts,
  saveMailAccount,
  searchDocumentPatients,
  syncMailAccount,
  uploadManualDocuments,
} from '../composables/documents/useDocumentsDomain'
import { logError } from '../utils/errors'

const loading = ref(false)
const globalError = ref('')

const providers = ref([])
const accounts = ref([])
const inboxRows = ref([])
const patientOptions = ref([])
const associateOptions = ref([])

const loadingAccounts = ref(false)
const loadingInbox = ref(false)
const accountsError = ref('')
const inboxError = ref('')
const providersError = ref('')

const syncingAccountId = ref(null)
const savingAccount = ref(false)
const savingImport = ref(false)
const savingAssociation = ref(false)
const processingRowId = ref(null)

const showAccountModal = ref(false)
const showImportModal = ref(false)
const showAssociateModal = ref(false)
const showDetailModal = ref(false)

const accountModalError = ref('')
const importModalError = ref('')
const associateModalError = ref('')

const patientSearch = ref('')
const associateSearch = ref('')
const selectedRow = ref(null)
const detailRow = ref(null)

const filters = reactive({
  accountId: '',
  associationStatus: '',
  patientId: '',
})

const accountForm = reactive({
  id: null,
  provider: 'manual',
  emailAddress: '',
  displayName: '',
  folderName: 'INBOX',
  isActive: true,
  settingsJson: '{}',
})

const importForm = reactive({
  accountId: '',
  fromEmail: '',
  subject: '',
  documentCategory: 'external_lab',
  patientId: '',
})

const associateForm = reactive({
  patientId: '',
  documentCategory: 'external_lab',
})

const fileInput = ref(null)
const selectedFiles = ref([])

const unassociatedCount = computed(() =>
  inboxRows.value.filter((row) => row.association_status === 'unassociated').length
)
const selectedFilesLabel = computed(() =>
  selectedFiles.value.length
    ? selectedFiles.value.map((file) => file.name).join(', ')
    : 'Seleccionar uno o más PDFs'
)

function formatDate(value) {
  return formatDocumentsDate(value)
}

function formatBytes(value) {
  return formatDocumentsBytes(value)
}

function badgeClass(status) {
  return badgeClassForAssociation(status)
}

function canIngest(row) {
  return canIngestDocument(row)
}

function apiErrorMessage(error, fallback) {
  return extractDocumentsError(error, fallback)
}

async function loadProviders() {
  providersError.value = ''
  try {
    providers.value = await loadDocumentProviders()
  } catch (error) {
    providers.value = []
    providersError.value = apiErrorMessage(error, 'No se pudieron cargar los proveedores. No se pueden crear cuentas hasta resolverlo.')
  }
}

async function loadAccounts() {
  loadingAccounts.value = true
  accountsError.value = ''
  try {
    accounts.value = await loadMailAccounts()
  } catch (error) {
    accountsError.value = apiErrorMessage(error, 'No se pudieron cargar las cuentas.')
  } finally {
    loadingAccounts.value = false
  }
}

async function loadInbox() {
  loadingInbox.value = true
  inboxError.value = ''
  try {
    inboxRows.value = await loadDocumentsInbox(filters)
  } catch (error) {
    inboxError.value = apiErrorMessage(error, 'No se pudo cargar la bandeja documental.')
  } finally {
    loadingInbox.value = false
  }
}

async function searchPatients(query, targetRef) {
  try {
    targetRef.value = await searchDocumentPatients(query)
  } catch (error) {
    logError('documentos.searchPatients', error, { search: query })
    targetRef.value = []
  }
}

async function handlePatientSearch() {
  await searchPatients(patientSearch.value, patientOptions)
}

async function handleAssociateSearch() {
  await searchPatients(associateSearch.value, associateOptions)
}

async function loadAll() {
  loading.value = true
  globalError.value = ''
  try {
    await Promise.allSettled([loadProviders(), loadAccounts(), loadInbox(), searchPatients('', patientOptions)])
  } catch (error) {
    globalError.value = error.message || 'No se pudieron cargar los documentos.'
  } finally {
    loading.value = false
  }
}

function resetAccountForm() {
  accountForm.id = null
  accountForm.provider = 'manual'
  accountForm.emailAddress = ''
  accountForm.displayName = ''
  accountForm.folderName = 'INBOX'
  accountForm.isActive = true
  accountForm.settingsJson = '{}'
  accountModalError.value = ''
}

function openAccountModal() {
  if (providersError.value) {
    globalError.value = providersError.value
    return
  }
  resetAccountForm()
  showAccountModal.value = true
}

function validateAccountForm() {
  if (!accountForm.provider) return 'Seleccioná un proveedor.'
  if (!accountForm.emailAddress) return 'Ingresá el email de la cuenta.'
  if (!accountForm.folderName) return 'Ingresá la carpeta de lectura.'
  try {
    JSON.parse(accountForm.settingsJson.trim() || '{}')
  } catch {
    return 'Settings JSON inválido.'
  }
  return ''
}

function editAccount(account) {
  accountForm.id = account.id
  accountForm.provider = account.provider
  accountForm.emailAddress = account.email_address
  accountForm.displayName = account.display_name || ''
  accountForm.folderName = account.folder_name || 'INBOX'
  accountForm.isActive = Boolean(account.is_active)
  accountForm.settingsJson = JSON.stringify(account.settings || {}, null, 2)
  accountModalError.value = ''
  showAccountModal.value = true
}

async function submitAccount() {
  accountModalError.value = ''
  const validationError = validateAccountForm()
  if (validationError) {
    accountModalError.value = validationError
    return
  }
  savingAccount.value = true
  try {
    try {
      await saveMailAccount(accountForm)
    } catch (error) {
      if (error instanceof SyntaxError) {
        logError('documentos.parseAccountSettings', error, { settingsJson: accountForm.settingsJson })
        accountModalError.value = 'Settings JSON inválido.'
        savingAccount.value = false
        return
      }
      throw error
    }
    showAccountModal.value = false
    await loadAccounts()
  } catch (error) {
    accountModalError.value = extractDocumentsError(error, 'No se pudo guardar la cuenta.')
  } finally {
    savingAccount.value = false
  }
}

function resetImportForm() {
  importForm.accountId = ''
  importForm.fromEmail = ''
  importForm.subject = ''
  importForm.documentCategory = 'external_lab'
  importForm.patientId = ''
  selectedFiles.value = []
  if (fileInput.value) fileInput.value.value = ''
  importModalError.value = ''
}

function openImportModal() {
  resetImportForm()
  showImportModal.value = true
}

function handleFilesSelected(event) {
  importModalError.value = ''
  const files = Array.from(event.target.files || [])
  const invalid = files.filter((file) => file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf'))
  if (invalid.length) {
    selectedFiles.value = []
    if (fileInput.value) fileInput.value.value = ''
    importModalError.value = 'Solo se permiten archivos PDF.'
    return
  }
  selectedFiles.value = files
}

async function submitImport() {
  importModalError.value = ''
  savingImport.value = true
  try {
    if (!selectedFiles.value.length) {
      importModalError.value = 'Seleccioná al menos un PDF.'
      savingImport.value = false
      return
    }

    await uploadManualDocuments(importForm, selectedFiles.value)
    showImportModal.value = false
    await loadInbox()
  } catch (error) {
    importModalError.value = extractDocumentsError(error, 'No se pudo importar el documento.')
  } finally {
    savingImport.value = false
  }
}

function openAssociateModal(row) {
  selectedRow.value = row
  associateForm.patientId = row.patient_id ? String(row.patient_id) : ''
  associateForm.documentCategory = row.document_category || 'external_lab'
  associateSearch.value = row.patient_name || ''
  associateOptions.value = row.patient_id && row.patient_name
    ? [{ id: row.patient_id, name: row.patient_name }]
    : patientOptions.value.slice(0, 20)
  associateModalError.value = ''
  showAssociateModal.value = true
}

async function submitAssociation() {
  if (!selectedRow.value) return
  associateModalError.value = ''
  if (!associateForm.patientId) {
    associateModalError.value = 'Seleccioná un paciente para asociar el documento.'
    return
  }
  savingAssociation.value = true
  try {
    await associateDocument(selectedRow.value.id, associateForm)
    showAssociateModal.value = false
    await loadInbox()
  } catch (error) {
    associateModalError.value = extractDocumentsError(error, 'No se pudo asociar el documento.')
  } finally {
    savingAssociation.value = false
  }
}

async function syncAccount(account) {
  syncingAccountId.value = account.id
  accountsError.value = ''
  try {
    await syncMailAccount(account.id)
    await loadAccounts()
  } catch (error) {
    accountsError.value = extractDocumentsError(error, 'No se pudo disparar la sincronización.')
  } finally {
    syncingAccountId.value = null
  }
}

async function viewRow(row) {
  detailRow.value = row
  showDetailModal.value = true
  try {
    detailRow.value = await getDocumentDetail(row.id) || row
  } catch (error) {
    logError('documentos.openDetail', error, { inboxId: row?.id })
    detailRow.value = row
  }
}

async function downloadRow(row) {
  try {
    const url = await getDocumentDownloadUrl(row.id)
    if (url) {
      window.open(url, '_blank', 'noopener')
      return
    }
    inboxError.value = 'El backend no devolvió un enlace de descarga.'
  } catch (error) {
    inboxError.value = extractDocumentsError(error, 'No se pudo generar el enlace de descarga.')
  }
}

async function ingestRow(row) {
  processingRowId.value = row.id
  inboxError.value = ''
  try {
    await ingestDocument(row.id)
    await loadInbox()
  } catch (error) {
    inboxError.value = extractDocumentsError(error, 'No se pudo procesar el PDF.')
  } finally {
    processingRowId.value = null
  }
}

onMounted(loadAll)
</script>

<style scoped>
.documents {
  display: grid;
  gap: 24px;
}

.hero,
.hero__actions,
.section-head,
.modal__header,
.modal__actions,
.row-actions,
.account-card__head,
.account-card__actions {
  display: flex;
  align-items: center;
}

.hero,
.section-head,
.account-card__head {
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.hero__title {
  margin: 0 0 6px;
  font-size: 1.45rem;
  font-weight: 700;
}

.hero__subtitle,
.section-head p,
.account-card__head p,
.account-card__meta,
.cell-stack span,
.detail-card span {
  margin: 0;
  color: var(--text-3);
  font-size: 0.86rem;
}

.hero__actions,
.modal__actions,
.row-actions,
.account-card__actions {
  gap: 10px;
  flex-wrap: wrap;
}

.kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 14px;
}

.kpi-card,
.panel {
  background: var(--white);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-sm);
}

.kpi-card {
  padding: 18px;
  border: 1px solid var(--border);
}

.kpi-card__label {
  display: block;
  margin-bottom: 6px;
  color: var(--text-3);
  font-size: 0.82rem;
}

.kpi-card strong {
  font-size: 1.6rem;
}

.panel {
  padding: 20px;
}

.panel--stacked {
  display: grid;
  gap: 16px;
}

.filter-grid,
.form,
.detail-grid {
  display: grid;
  gap: 14px;
}

.filter-grid {
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
}

.field {
  display: grid;
  gap: 8px;
}

.field span {
  font-size: 0.85rem;
  font-weight: 600;
}

.field input,
.field select,
.field textarea {
  min-height: 42px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--white);
  color: var(--text);
}

.field textarea {
  min-height: 160px;
  resize: vertical;
  font-family: monospace;
}

.field-hint {
  color: var(--text-3);
  font-size: 0.78rem;
}

.toggle {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-weight: 600;
}

.alert,
.empty-state,
.detail-card {
  padding: 14px 16px;
  border-radius: var(--radius);
}

.alert--error {
  background: #fff4f4;
  color: #b94034;
}

.alert--warning {
  background: #fff8e6;
  color: #8a6200;
  border: 1px solid #f2d58d;
}

.empty-state {
  background: var(--surface);
  color: var(--text-3);
}

.account-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 14px;
}

.account-card {
  display: grid;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: linear-gradient(180deg, #ffffff 0%, #f9fbfb 100%);
}

.account-card__meta,
.cell-stack {
  display: grid;
  gap: 4px;
}

.account-card__error {
  margin: 0;
  color: #b94034;
  font-size: 0.83rem;
}

.table-wrap {
  overflow-x: auto;
}

.table {
  width: 100%;
  border-collapse: collapse;
}

.table th,
.table td {
  padding: 12px 10px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  font-size: 0.88rem;
  vertical-align: top;
}

.table th {
  color: var(--text-3);
  text-transform: uppercase;
  font-size: 0.76rem;
  letter-spacing: 0.04em;
}

.badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 0.74rem;
  font-weight: 700;
}

.badge--active {
  background: #eafaf3;
  color: #1e8449;
}

.badge--inactive {
  background: #fdf3f3;
  color: #c0392b;
}

.badge--warning {
  background: #fff7df;
  color: #9c6a00;
}

.modal__header {
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 18px;
}

.modal__header h3 {
  margin: 0;
  font-size: 1.05rem;
}

.modal__close {
  border: none;
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
}

.modal__actions {
  justify-content: flex-end;
  margin-top: 6px;
}

.detail-card {
  display: grid;
  gap: 4px;
  margin-bottom: 16px;
  background: var(--surface);
}

.detail-grid {
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}

.detail-item {
  display: grid;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.detail-item span {
  color: var(--text-3);
  font-size: 0.8rem;
}

@media (max-width: 768px) {
  .hero,
  .hero__actions,
  .section-head,
  .account-card__head,
  .modal__actions {
    align-items: stretch;
    flex-direction: column;
  }

  .table {
    min-width: 920px;
  }
}
</style>
