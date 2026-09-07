import { labApi, patientsApi } from '../../api'

export function asArray(value) {
  if (Array.isArray(value)) return value
  if (value == null) return []
  return [value]
}

export function normalizeSurgery(row) {
  if (!row || typeof row !== 'object') return null
  return {
    ...row,
    id: row.id ?? row.surgery_id ?? row.surgeryId ?? null,
    patient_name: row.patient_name ?? row.patient?.name ?? row.patientName ?? '',
    species: row.species ?? row.species_name ?? row.speciesName ?? '',
    surgery_type_name: row.surgery_type_name ?? row.surgeryTypeName ?? '',
    category_name: row.category_name ?? row.surgery_category ?? row.categoryName ?? '',
    surgeon_name: row.surgeon_name ?? row.lead_surgeon ?? row.surgeonName ?? '',
    scheduled_date: row.scheduled_date ?? row.scheduledDate ?? null,
    status: row.status ?? '',
  }
}

export function normalizeSurgeryType(row) {
  if (!row || typeof row !== 'object') return null
  return {
    ...row,
    id: row.id ?? row.type_id ?? row.typeId ?? null,
    name: row.name ?? row.type_name ?? row.typeName ?? '',
    category_name: row.category_name ?? row.categoryName ?? 'General',
    risk_level: row.risk_level ?? row.riskLevel ?? '',
    estimated_duration_minutes: row.estimated_duration_minutes ?? row.estimatedDurationMinutes ?? null,
  }
}

export function normalizePatient(row) {
  if (!row || typeof row !== 'object') return null
  return {
    ...row,
    id: row.id ?? row.patient_id ?? row.patientId ?? null,
    name: row.name ?? row.full_name ?? row.fullName ?? '',
    primary_owner: row.primary_owner ?? row.owner_name ?? row.ownerName ?? '',
    species: row.species ?? row.species_name ?? row.speciesName ?? '',
    hc_number: row.hc_number ?? row.hcNumber ?? '',
  }
}

export function buildNewSurgeryPayload(form) {
  const payload = {
    patientId: form.patientId,
    surgeryTypeId: form.surgeryTypeId,
    scheduledDate: form.scheduledDate,
  }
  if (form.estimatedDurationMinutes) payload.estimatedDurationMinutes = form.estimatedDurationMinutes
  if (form.urgency) payload.urgency = form.urgency
  if (form.preOpNotes) payload.preOpNotes = form.preOpNotes
  return payload
}

export function buildAnesthesiaPayload(form) {
  const payload = {
    anesthesiaType: form.anesthesiaType,
    anestheticAgents: form.anestheticAgents,
    complications: form.complications,
  }
  if (form.inductionTime) payload.inductionTime = form.inductionTime
  if (form.recoveryTime) payload.recoveryTime = form.recoveryTime
  if (form.complicationNotes) payload.complicationNotes = form.complicationNotes
  if (form.monitoringNotes) payload.monitoringNotes = form.monitoringNotes
  if (form.totalDurationMinutes) payload.totalDurationMinutes = form.totalDurationMinutes
  return payload
}

export async function loadSurgeries(params = {}) {
  const query = {}
  if (params.status) query.status = params.status
  const { data } = await labApi.surgeries.list(query)
  return asArray(data?.data || data?.surgeries || data).map(normalizeSurgery).filter(Boolean)
}

export async function loadSurgeryTypes() {
  const { data } = await labApi.surgeries.types()
  return asArray(data?.data || data?.types || data).map(normalizeSurgeryType).filter(Boolean)
}

export async function searchPatients(query) {
  const { data } = await patientsApi.list({ search: query, limit: 8 })
  return asArray(data?.data || data?.patients || data).map(normalizePatient).filter(Boolean)
}

export async function createSurgery(form) {
  return labApi.surgeries.create(buildNewSurgeryPayload(form))
}

export async function addAnesthesiaRecord(surgeryId, form) {
  return labApi.surgeries.anesthesia(surgeryId, buildAnesthesiaPayload(form))
}

export async function updateSurgeryStatus(surgeryId, status) {
  return labApi.surgeries.status(surgeryId, { status })
}

export async function getSurgeryDetail(surgeryId) {
  const { data } = await labApi.surgeries.get(surgeryId)
  return data?.data || data
}

export default function useSurgeryDomain() {
  return {
    asArray,
    normalizeSurgery,
    normalizeSurgeryType,
    normalizePatient,
    buildNewSurgeryPayload,
    buildAnesthesiaPayload,
    loadSurgeries,
    loadSurgeryTypes,
    searchPatients,
    createSurgery,
    addAnesthesiaRecord,
    updateSurgeryStatus,
    getSurgeryDetail,
  }
}
