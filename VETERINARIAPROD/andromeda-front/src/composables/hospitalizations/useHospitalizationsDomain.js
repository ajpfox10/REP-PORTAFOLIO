import { labApi, patientsApi } from '../../api'

export function asArray(value) {
  if (Array.isArray(value)) return value
  if (value == null) return []
  return [value]
}

export function normalizeHospitalization(row) {
  if (!row || typeof row !== 'object') return null
  return {
    ...row,
    id: row.id ?? row.hospitalization_id ?? row.hospitalizationId ?? null,
    patient_name: row.patient_name ?? row.patient?.name ?? row.patientName ?? '',
    species: row.species ?? row.species_name ?? row.speciesName ?? '',
    responsible_vet: row.responsible_vet ?? row.attending_vet_name ?? row.attendingVetName ?? '',
    ward_name: row.ward_name ?? row.ward?.name ?? row.wardName ?? '',
    kennel_number: row.kennel_number ?? row.kennel?.number ?? row.kennelNumber ?? '',
    status: row.status ?? '',
    discharge_date: row.discharge_date ?? row.dischargeDate ?? null,
    days_hospitalized: row.days_hospitalized ?? row.daysHospitalized ?? null,
    estimated_discharge_date: row.estimated_discharge_date ?? row.estimatedDischargeDate ?? null,
    last_temp: row.last_temp ?? row.lastTemp ?? null,
    last_hr: row.last_hr ?? row.lastHr ?? null,
    medical_record_id: row.medical_record_id ?? row.medicalRecordId ?? null,
    admission_diagnosis: row.admission_diagnosis ?? row.admissionDiagnosis ?? '',
    admission_weight: row.admission_weight ?? row.admissionWeight ?? null,
    special_instructions: row.special_instructions ?? row.specialInstructions ?? '',
  }
}

export function normalizeWard(row) {
  if (!row || typeof row !== 'object') return null
  return {
    ...row,
    id: row.id ?? row.ward_id ?? row.wardId ?? null,
    name: row.name ?? row.ward_name ?? row.wardName ?? '',
    available_kennels: row.available_kennels ?? row.availableKennels ?? 0,
    kennels: asArray(row.kennels).map((k) => ({
      ...k,
      id: k.id ?? k.kennel_id ?? k.kennelId ?? null,
      number: k.number ?? k.kennel_number ?? k.kennelNumber ?? '',
      status: k.status ?? '',
      kennel_type: k.kennel_type ?? k.kennelType ?? '',
    })),
  }
}

export function normalizePatient(row) {
  if (!row || typeof row !== 'object') return null
  return {
    ...row,
    id: row.id ?? row.patient_id ?? row.patientId ?? null,
    name: row.name ?? row.full_name ?? row.fullName ?? '',
    species: row.species ?? row.species_name ?? row.speciesName ?? '',
    primary_owner: row.primary_owner ?? row.owner_name ?? row.ownerName ?? '',
    hc_number: row.hc_number ?? row.hcNumber ?? '',
  }
}

export function buildAdmitPayload(form) {
  const payload = {
    patientId: form.patientId,
    wardId: form.wardId,
    responsibleVetId: form.attendingVetId,
    hospitalizationReason: form.admissionReason,
  }
  if (form.kennelId) payload.kennelId = form.kennelId
  if (form.admissionDiagnosis) payload.admissionDiagnosis = form.admissionDiagnosis
  if (form.admissionWeight) payload.admissionWeight = form.admissionWeight
  if (form.estimatedDischargeDate) payload.estimatedDischargeDate = form.estimatedDischargeDate
  if (form.specialInstructions) payload.specialInstructions = form.specialInstructions
  return payload
}

export function buildMonitoringPayload(form) {
  const payload = { recordedAt: new Date().toISOString() }
  if (form.heartRate) payload.heartRate = form.heartRate
  if (form.respiratoryRate) payload.respiratoryRate = form.respiratoryRate
  if (form.temperature) payload.temperature = form.temperature
  if (form.systolicBp) payload.systolicBp = form.systolicBp
  if (form.mucousMembranes) payload.mucousMembranes = form.mucousMembranes
  if (form.hydrationStatus) payload.hydration = form.hydrationStatus
  if (form.consciousnessLevel) payload.consciousness = form.consciousnessLevel
  if (form.notes) payload.notes = form.notes
  return payload
}

export function buildMedicationPayload(form) {
  const payload = {
    medicationName: form.medicationName,
    dose: form.dose,
    frequency: form.frequency,
    route: form.route,
    startDate: form.startDatetime,
  }
  if (form.doseUnit) payload.doseUnit = form.doseUnit
  if (form.durationHours) {
    const end = new Date(form.startDatetime)
    if (!Number.isNaN(end.getTime())) {
      end.setHours(end.getHours() + Number(form.durationHours))
      payload.endDate = end.toISOString()
    }
  }
  if (form.notes) payload.instructions = form.notes
  return payload
}

export function buildDischargePayload(form) {
  const payload = { dischargeDate: new Date().toISOString() }
  if (form.dischargeNotes) payload.dischargeInstructions = form.dischargeNotes
  if (form.followUpDate) payload.followUpDate = form.followUpDate
  return payload
}

export async function loadHospitalizations(params = {}) {
  const query = {}
  if (params.status) query.status = params.status
  const { data } = await labApi.hospitalizations.list(query)
  return asArray(data?.data || data?.hospitalizations || data).map(normalizeHospitalization).filter(Boolean)
}

export async function loadHospitalizationsBoard() {
  const { data } = await labApi.hospitalizations.board()
  return asArray(data?.data || data?.board || data).map(normalizeHospitalization).filter(Boolean)
}

export async function loadAvailableWards() {
  const { data } = await labApi.hospitalizations.wardsAvailability()
  return asArray(data?.data || data?.wards || data).map(normalizeWard).filter(Boolean)
}

export async function searchPatients(query) {
  const { data } = await patientsApi.list({ search: query, limit: 8 })
  return asArray(data?.data || data?.patients || data).map(normalizePatient).filter(Boolean)
}

export async function admitPatient(form) {
  return labApi.hospitalizations.create(buildAdmitPayload(form))
}

export async function getHospitalizationDetail(id) {
  const { data } = await labApi.hospitalizations.get(id)
  return data?.data || data
}

export async function addMonitoringRecord(hospitalizationId, form) {
  return labApi.hospitalizations.monitoring(hospitalizationId, buildMonitoringPayload(form))
}

export async function addMedication(hospitalizationId, form) {
  return labApi.hospitalizations.medications(hospitalizationId, buildMedicationPayload(form))
}

export async function dischargeHospitalization(hospitalizationId, form) {
  return labApi.hospitalizations.discharge(hospitalizationId, buildDischargePayload(form))
}

export default function useHospitalizationsDomain() {
  return {
    asArray,
    normalizeHospitalization,
    normalizeWard,
    normalizePatient,
    buildAdmitPayload,
    buildMonitoringPayload,
    buildMedicationPayload,
    buildDischargePayload,
    loadHospitalizations,
    loadHospitalizationsBoard,
    loadAvailableWards,
    searchPatients,
    admitPatient,
    getHospitalizationDetail,
    addMonitoringRecord,
    addMedication,
    dischargeHospitalization,
  }
}
