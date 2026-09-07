import { documentsApi, patientsApi } from '../../api'
import { extractErrorMessage } from '../../utils/errors'
import { getWithRetry, unwrapData } from '../../utils/requests'

export function formatDocumentsDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString('es-AR')
}

export function formatDocumentsBytes(value) {
  const size = Number(value || 0)
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

export function badgeClassForAssociation(status) {
  if (status === 'associated') return 'badge--active'
  if (status === 'needs_review') return 'badge--warning'
  return 'badge--inactive'
}

export function canIngestDocument(row) {
  return row.document_category === 'external_lab' && Boolean(row.patient_id)
}

export function extractDocumentsError(error, fallback) {
  return extractErrorMessage(error, fallback, { includeRequestId: true })
}

export function parseAccountSettings(settingsJson) {
  return settingsJson.trim() ? JSON.parse(settingsJson) : {}
}

export async function loadDocumentProviders() {
  const response = await getWithRetry(() => documentsApi.providers())
  return unwrapData(response?.data) || []
}

export async function loadMailAccounts(params) {
  const response = await getWithRetry(() => documentsApi.accounts.list(params))
  return unwrapData(response?.data) || []
}

export async function loadDocumentsInbox(filters = {}) {
  const params = { limit: 50 }
  if (filters.accountId) params.accountId = Number(filters.accountId)
  if (filters.associationStatus) params.associationStatus = filters.associationStatus
  if (filters.patientId) params.patientId = Number(filters.patientId)
  const response = await getWithRetry(() => documentsApi.inbox.list(params))
  return unwrapData(response?.data) || []
}

export async function searchDocumentPatients(query) {
  const response = await getWithRetry(() => patientsApi.list({ search: query || undefined, limit: 30 }))
  return unwrapData(response?.data) || []
}

export async function saveMailAccount(form) {
  const payload = {
    provider: form.provider,
    emailAddress: form.emailAddress,
    displayName: form.displayName || undefined,
    folderName: form.folderName || 'INBOX',
    isActive: Boolean(form.isActive),
    settings: parseAccountSettings(form.settingsJson),
  }

  if (form.id) {
    await documentsApi.accounts.update(form.id, payload)
    return
  }

  await documentsApi.accounts.create(payload)
}

export async function uploadManualDocuments(form, files) {
  const formData = new FormData()
  formData.append('fromEmail', form.fromEmail)
  if (form.subject) formData.append('subject', form.subject)
  if (form.accountId) formData.append('accountId', form.accountId)
  if (form.patientId) formData.append('patientId', form.patientId)
  if (form.documentCategory) formData.append('documentCategory', form.documentCategory)
  for (const file of files) formData.append('files', file)
  await documentsApi.inbox.upload(formData)
}

export async function associateDocument(rowId, payload) {
  return documentsApi.inbox.associate(rowId, {
    patientId: Number(payload.patientId),
    documentCategory: payload.documentCategory,
  })
}

export async function syncMailAccount(accountId) {
  return documentsApi.accounts.sync(accountId)
}

export async function getDocumentDetail(rowId) {
  const response = await documentsApi.inbox.get(rowId)
  return unwrapData(response?.data) || null
}

export async function getDocumentDownloadUrl(rowId) {
  const response = await documentsApi.inbox.downloadUrl(rowId)
  return unwrapData(response?.data)?.url || null
}

export async function ingestDocument(rowId) {
  return documentsApi.inbox.ingest(rowId)
}
