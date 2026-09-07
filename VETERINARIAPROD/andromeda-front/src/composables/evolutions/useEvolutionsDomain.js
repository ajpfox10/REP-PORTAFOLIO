import { labApi, medicalApi, patientsApi, vaccinationsApi } from '../../api'
import { adminUsersApi } from '../../api/adminUsers'
import { extractDetailedErrorMessage } from '../../utils/errors'

export function asArray(value) {
  if (Array.isArray(value)) return value
  if (value == null) return []
  return [value]
}

export function normalizeMedicalRecord(row) {
  if (!row || typeof row !== 'object') return null
  const anamnesis = row.anamnesis ?? row.history ?? null
  const physicalExam = row.physicalExam ?? row.physical_exam ?? null
  return {
    ...row,
    id: row.id ?? row.medical_record_id ?? row.medicalRecordId ?? null,
    patient_id: row.patient_id ?? row.patientId ?? null,
    patient_name: row.patient_name ?? row.patient?.name ?? row.patientName ?? '',
    species: row.species ?? row.species_name ?? row.speciesName ?? '',
    vet_name: row.vet_name ?? row.vet?.name ?? row.veterinarian_name ?? row.veterinarianName ?? '',
    status: row.status ?? '',
    opened_at: row.opened_at ?? row.openedAt ?? null,
    visit_date: row.visit_date ?? row.visitDate ?? null,
    chief_complaint: row.chief_complaint ?? row.chiefComplaint ?? '',
    weight_kg: row.weight_kg ?? row.weightKg ?? null,
    temperature_celsius: row.temperature_celsius ?? row.temperatureCelsius ?? null,
    anamnesisText: stringifyClinicalBlock(anamnesis),
    physicalExamText: stringifyClinicalBlock(physicalExam),
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

export function normalizeRelatedLabOrder(row) {
  if (!row || typeof row !== 'object') return null
  return {
    ...row,
    id: row.id ?? null,
    medical_record_id: row.medical_record_id ?? row.medicalRecordId ?? null,
    order_number: row.order_number ?? row.orderNumber ?? '',
    status: row.status ?? '',
    priority: row.priority ?? '',
    ordered_at: row.ordered_at ?? row.orderedAt ?? null,
    reported_at: row.reported_at ?? row.reportedAt ?? null,
    test_count: row.test_count ?? row.testCount ?? null,
  }
}

export function normalizeRelatedImagingOrder(row) {
  if (!row || typeof row !== 'object') return null
  return {
    ...row,
    id: row.id ?? null,
    medical_record_id: row.medical_record_id ?? row.medicalRecordId ?? null,
    order_number: row.order_number ?? row.orderNumber ?? '',
    status: row.status ?? '',
    priority: row.priority ?? '',
    ordered_at: row.ordered_at ?? row.orderedAt ?? null,
    imaging_type: row.imaging_type ?? row.imagingType ?? '',
    body_region: row.body_region ?? row.bodyRegion ?? '',
  }
}

export function normalizeRelatedSurgery(row) {
  if (!row || typeof row !== 'object') return null
  return {
    ...row,
    id: row.id ?? null,
    medical_record_id: row.medical_record_id ?? row.medicalRecordId ?? null,
    status: row.status ?? '',
    scheduled_date: row.scheduled_date ?? row.scheduledDate ?? null,
    surgery_type: row.surgery_type ?? row.surgeryType ?? '',
    lead_surgeon: row.lead_surgeon ?? row.leadSurgeon ?? '',
  }
}

export function normalizeRelatedHospitalization(row) {
  if (!row || typeof row !== 'object') return null
  return {
    ...row,
    id: row.id ?? null,
    medical_record_id: row.medical_record_id ?? row.medicalRecordId ?? null,
    admission_date: row.admission_date ?? row.admissionDate ?? null,
    discharge_date: row.discharge_date ?? row.dischargeDate ?? null,
    hospitalization_reason: row.hospitalization_reason ?? row.hospitalizationReason ?? '',
    hospitalization_status: row.hospitalization_status ?? row.hospitalizationStatus ?? row.status ?? '',
    ward_name: row.ward_name ?? row.wardName ?? '',
    kennel_number: row.kennel_number ?? row.kennelNumber ?? '',
  }
}

export function normalizeLabTest(row) {
  if (!row || typeof row !== 'object') return null
  return {
    ...row,
    id: row.id ?? row.test_id ?? row.testId ?? null,
    name: row.name ?? row.test_name ?? row.testName ?? '',
    category: row.category ?? row.group ?? 'General',
  }
}

export function normalizeImagingType(row) {
  if (!row || typeof row !== 'object') return null
  return {
    ...row,
    id: row.id ?? row.type_id ?? row.typeId ?? null,
    name: row.name ?? row.type_name ?? row.typeName ?? '',
    modality: row.modality ?? row.modality_code ?? row.modalityCode ?? '',
  }
}

export function normalizeSurgeryType(row) {
  if (!row || typeof row !== 'object') return null
  return {
    ...row,
    id: row.id ?? row.type_id ?? row.typeId ?? null,
    name: row.name ?? row.type_name ?? row.typeName ?? '',
    category: row.category ?? row.category_name ?? row.categoryName ?? 'General',
    estimated_duration_minutes: row.estimated_duration_minutes ?? row.estimatedDurationMinutes ?? null,
  }
}

export function normalizeWardAvailability(rows) {
  const grouped = new Map()
  asArray(rows).forEach((row) => {
    const wardId = row.ward_id ?? row.id ?? row.wardId
    if (!wardId) return
    if (!grouped.has(wardId)) {
      grouped.set(wardId, {
        id: wardId,
        name: row.ward_name ?? row.name ?? '',
        ward_type: row.ward_type ?? row.wardType ?? '',
        available_kennels: 0,
        kennels: [],
      })
    }
    const ward = grouped.get(wardId)
    const kennel = {
      id: row.kennel_id ?? row.id ?? row.kennelId ?? null,
      number: row.kennel_number ?? row.number ?? row.kennelNumber ?? '',
      status: row.status ?? '',
      kennel_type: row.kennel_type ?? row.kennelType ?? '',
    }
    if (kennel.id) ward.kennels.push(kennel)
    if (kennel.status === 'available' || kennel.status === 'free') ward.available_kennels += 1
  })
  return Array.from(grouped.values())
}

export function normalizeProfessional(row) {
  if (!row || typeof row !== 'object') return null
  const roles = normalizeRoleList(row.roles ?? row.role ?? row.permissions)
  return {
    ...row,
    id: row.id ?? row.user_id ?? row.userId ?? null,
    label: `${row.first_name || row.firstName || ''} ${row.last_name || row.lastName || ''}`.trim(),
    roles,
    isActive: row.is_active ?? row.isActive ?? true,
  }
}

export function normalizeRoleList(input) {
  if (Array.isArray(input)) {
    return input
      .flatMap((entry) => normalizeRoleList(entry))
      .filter(Boolean)
  }
  if (!input) return []
  if (typeof input === 'string') {
    return input.split(',').map((entry) => entry.trim()).filter(Boolean)
  }
  if (typeof input === 'object') {
    return normalizeRoleList(input.name || input.code || input.role || input.slug)
  }
  return []
}

export function currentUserProfessional(auth) {
  const currentUser = auth?.user || {}
  const roles = normalizeRoleList(auth?.roles)
  if (!roles.some((role) => ['veterinarian', 'surgeon', 'vet_technician', 'tele_vet'].includes(role))) return null
  return normalizeProfessional({
    id: currentUser.id || currentUser.userId || null,
    first_name: currentUser.first_name || currentUser.firstName || currentUser.name || '',
    last_name: currentUser.last_name || currentUser.lastName || '',
    email: currentUser.email || '',
    roles,
    is_active: true,
  })
}

export function preferredProfessionalId(list, auth) {
  const self = currentUserProfessional(auth)
  if (self && list.some((entry) => entry.id === self.id)) return String(self.id)
  if (list.length === 1) return String(list[0].id)
  return ''
}

function stringifyClinicalBlock(block) {
  if (!block) return ''
  if (typeof block === 'string') return block
  if (typeof block !== 'object') return ''
  return Object.entries(block)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${labelizeKey(key)}: ${Array.isArray(value) ? value.join(', ') : value}`)
    .join('\n')
}

function labelizeKey(key) {
  return String(key)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/^\w/, (m) => m.toUpperCase())
}

export function buildMedicalRecordPayload(form) {
  const payload = {
    patientId: parseInt(form.patientId, 10),
    chiefComplaint: form.chiefComplaint,
  }
  if (form.reasonForVisit) payload.reasonForVisit = form.reasonForVisit
  if (form.visitDate) payload.visitDate = form.visitDate
  if (form.notes) payload.notes = form.notes
  if (form.weightKg) payload.weightKg = parseFloat(form.weightKg)
  // El backend (POST /medical-records) espera 'temperatureC', no 'temperatureCelsius'
  if (form.temperatureCelsius) payload.temperatureC = parseFloat(form.temperatureCelsius)
  if (form.bodyConditionScore) payload.bodyConditionScore = parseFloat(form.bodyConditionScore)
  return payload
}

export function buildAnamnesisPayload(form) {
  const payload = {
    currentIllnessHistory: form.currentIllnessHistory || form.chiefComplaint,
    vomiting: form.vomiting ? 1 : 0,
    coughing: form.coughing ? 1 : 0,
    sneezing: form.sneezing ? 1 : 0,
    pruritus: form.pruritus ? 1 : 0,
    locomotionIssues: form.locomotionIssues ? 1 : 0,
    contactWithAnimals: form.contactWithAnimals ? 1 : 0,
  }
  const optional = [
    'illnessDuration', 'illnessOnset', 'appetite', 'thirst', 'urination', 'defecation',
    'otherSigns', 'feedingType', 'feedingBrand', 'environment', 'recentTravel',
    'vaccinationHistory', 'dewormingHistory', 'previousIllnesses', 'previousSurgeries',
    'currentMedications', 'ownerObservations',
  ]
  for (const key of optional) {
    if (form[key]) payload[key] = form[key]
  }
  return payload
}

export function buildPhysicalExamPayload(form) {
  const payload = {}
  const keys = {
    temperatureCelsius: 'temperatureCelsius',
    heartRate: 'heartRate',
    respiratoryRate: 'respiratoryRate',
    systolicBp: 'systolicBp',
    diastolicBp: 'diastolicBp',
    spo2Percent: 'spo2Percent',
    weightKg: 'weightKg',
    bodyConditionScore: 'bodyConditionScore',
    mucousMembranes: 'mucousMembranes',
    hydrationStatus: 'hydrationStatus',
    lymphNodes: 'lymphNodes',
    skinCoat: 'skinCoat',
    eyes: 'eyes',
    ears: 'ears',
    noseThroat: 'noseThroat',
    oralCavity: 'oralCavity',
    cardiovascular: 'cardiovascular',
    respiratory: 'respiratory',
    abdomen: 'abdomen',
    musculoskeletal: 'musculoskeletal',
    neurological: 'neurological',
    urogenital: 'urogenital',
    painAssessment: 'painAssessment',
    generalObservations: 'generalObservations',
  }
  for (const [src, dst] of Object.entries(keys)) {
    if (form[src] !== '' && form[src] !== null && form[src] !== undefined) payload[dst] = form[src]
  }
  return payload
}

export function buildDiagnosisPayload(form) {
  return {
    diagnosisName: form.diagnosisName,
    diagnosisType: form.diagnosisType,
    diagnosisCode: form.diagnosisCode || undefined,
    isPrimary: form.isPrimary,
    prognosis: form.prognosis || undefined,
    notes: form.diagnosisNotes || undefined,
  }
}

export function buildTreatmentPayload(form) {
  const tr = { treatmentType: form.treatment.treatmentType }
  if (form.treatment.description) tr.description = form.treatment.description
  if (form.treatment.dose) tr.dose = form.treatment.dose
  if (form.treatment.doseUnit) tr.doseUnit = form.treatment.doseUnit
  if (form.treatment.frequency) tr.frequency = form.treatment.frequency
  if (form.treatment.route) tr.route = form.treatment.route
  if (form.treatment.durationDays) tr.durationDays = parseInt(form.treatment.durationDays, 10)
  if (form.treatment.startDate) tr.startDate = form.treatment.startDate
  if (form.treatment.notes) tr.notes = form.treatment.notes
  return tr
}

export function buildLabOrderPayload(form, recordId) {
  return {
    patientId: parseInt(form.patientId, 10),
    medicalRecordId: recordId,
    priority: form.labOrder.priority,
    clinicalNotes: form.labOrder.clinicalNotes || form.chiefComplaint,
    tests: form.labOrder.tests.map((testId) => ({ testId })),
  }
}

export function buildImagingOrderPayload(form, recordId) {
  return {
    patientId: parseInt(form.patientId, 10),
    medicalRecordId: recordId,
    imagingTypeId: parseInt(form.imagingOrder.imagingTypeId, 10),
    priority: form.imagingOrder.priority,
    bodyRegion: form.imagingOrder.bodyRegion || undefined,
    clinicalIndication: form.imagingOrder.clinicalIndication || form.chiefComplaint,
    sedationRequired: !!form.imagingOrder.sedationRequired,
  }
}

export function buildHospitalizationOrderPayload(form, recordId) {
  return {
    patientId: parseInt(form.patientId, 10),
    medicalRecordId: recordId,
    responsibleVetId: parseInt(form.hospitalizationOrder.responsibleVetId, 10),
    wardId: form.hospitalizationOrder.wardId ? parseInt(form.hospitalizationOrder.wardId, 10) : undefined,
    kennelId: form.hospitalizationOrder.kennelId ? parseInt(form.hospitalizationOrder.kennelId, 10) : undefined,
    hospitalizationReason: form.hospitalizationOrder.hospitalizationReason,
    admissionDiagnosis: form.hospitalizationOrder.admissionDiagnosis || undefined,
    admissionWeight: form.hospitalizationOrder.admissionWeight || undefined,
    estimatedDischargeDate: form.hospitalizationOrder.estimatedDischargeDate || undefined,
    specialInstructions: form.hospitalizationOrder.specialInstructions || undefined,
  }
}

export function buildSurgeryOrderPayload(form, recordId) {
  const surgeryPayload = {
    patientId: parseInt(form.patientId, 10),
    medicalRecordId: recordId,
    surgeryTypeId: parseInt(form.surgeryOrder.surgeryTypeId, 10),
    leadSurgeonId: parseInt(form.surgeryOrder.leadSurgeonId, 10),
    scheduledDate: form.surgeryOrder.startTime
      ? `${form.surgeryOrder.scheduledDate}T${form.surgeryOrder.startTime}`
      : `${form.surgeryOrder.scheduledDate}T09:00`,
    urgency: form.surgeryOrder.urgency || 'elective',
  }
  if (form.surgeryOrder.startTime) surgeryPayload.startTime = form.surgeryOrder.startTime
  if (form.surgeryOrder.preoperativeDiagnosis) surgeryPayload.preoperativeDiagnosis = form.surgeryOrder.preoperativeDiagnosis
  if (form.surgeryOrder.surgicalApproach) surgeryPayload.surgicalApproach = form.surgeryOrder.surgicalApproach
  if (form.surgeryOrder.notes) surgeryPayload.notes = form.surgeryOrder.notes
  return surgeryPayload
}

export function buildPrescriptionPayload(form) {
  const rxPayload = {
    items: form.prescriptionItems.map((item) => {
      const i = { medicationName: item.medicationName, dose: item.dose, frequency: item.frequency }
      if (item.doseUnit) i.doseUnit = item.doseUnit
      if (item.route) i.route = item.route
      if (item.durationDays) i.durationDays = parseInt(item.durationDays, 10)
      if (item.quantity) i.quantity = parseFloat(item.quantity)
      if (item.instructions) i.instructions = item.instructions
      return i
    }),
  }
  if (form.prescriptionNotes) rxPayload.notes = form.prescriptionNotes
  if (form.prescriptionRefills !== '') {
    const refills = parseInt(form.prescriptionRefills, 10)
    if (!isNaN(refills)) rxPayload.refills = refills
  }
  return rxPayload
}

export function makeDetailOrdersForm() {
  return {
    lab: { tests: [], priority: 'routine', clinicalNotes: '' },
    imaging: {
      imagingTypeId: '',
      priority: 'routine',
      clinicalIndication: '',
      bodyRegion: '',
      sedationRequired: false,
    },
    hospitalization: {
      responsibleVetId: '',
      wardId: '',
      kennelId: '',
      hospitalizationReason: '',
      admissionDiagnosis: '',
      admissionWeight: '',
      estimatedDischargeDate: '',
      specialInstructions: '',
    },
    surgery: {
      surgeryTypeId: '',
      leadSurgeonId: '',
      scheduledDate: '',
      startTime: '',
      urgency: 'elective',
      preoperativeDiagnosis: '',
      surgicalApproach: '',
      notes: '',
    },
  }
}

export function makeEvolutionsForm() {
  return {
    patientId: '',
    chiefComplaint: '',
    reasonForVisit: '',
    visitDate: new Date().toISOString().split('T')[0],
    notes: '',
    weightKg: '',
    temperatureCelsius: '',
    heartRate: '',
    respiratoryRate: '',
    systolicBp: '',
    diastolicBp: '',
    spo2Percent: '',
    bodyConditionScore: '',
    currentIllnessHistory: '',
    illnessDuration: '',
    illnessOnset: '',
    appetite: '',
    thirst: '',
    urination: '',
    defecation: '',
    vomiting: false,
    coughing: false,
    sneezing: false,
    pruritus: false,
    locomotionIssues: false,
    contactWithAnimals: false,
    otherSigns: '',
    feedingType: '',
    feedingBrand: '',
    environment: '',
    recentTravel: '',
    vaccinationHistory: '',
    dewormingHistory: '',
    previousIllnesses: '',
    previousSurgeries: '',
    currentMedications: '',
    ownerObservations: '',
    mucousMembranes: '',
    hydrationStatus: '',
    lymphNodes: '',
    skinCoat: '',
    eyes: '',
    ears: '',
    noseThroat: '',
    oralCavity: '',
    cardiovascular: '',
    respiratory: '',
    abdomen: '',
    musculoskeletal: '',
    neurological: '',
    urogenital: '',
    painAssessment: '',
    generalObservations: '',
    diagnosisName: '',
    diagnosisType: 'presumptive',
    diagnosisCode: '',
    isPrimary: true,
    prognosis: '',
    diagnosisNotes: '',
    treatment: {
      treatmentType: '',
      description: '',
      dose: '',
      doseUnit: '',
      frequency: '',
      route: '',
      durationDays: '',
      startDate: '',
      notes: '',
    },
    labOrder: { tests: [], priority: 'routine', clinicalNotes: '' },
    imagingOrder: {
      imagingTypeId: '',
      priority: 'routine',
      clinicalIndication: '',
      bodyRegion: '',
      sedationRequired: false,
    },
    hospitalizationOrder: {
      responsibleVetId: '',
      wardId: '',
      kennelId: '',
      hospitalizationReason: '',
      admissionDiagnosis: '',
      admissionWeight: '',
      estimatedDischargeDate: '',
      specialInstructions: '',
    },
    surgeryOrder: {
      surgeryTypeId: '',
      leadSurgeonId: '',
      scheduledDate: '',
      startTime: '',
      urgency: 'elective',
      preoperativeDiagnosis: '',
      surgicalApproach: '',
      notes: '',
    },
    prescriptionItems: [],
    prescriptionNotes: '',
    prescriptionRefills: '',
  }
}

export function makePrescriptionItemDraft() {
  return {
    medicationName: '',
    dose: '',
    doseUnit: '',
    frequency: '',
    route: '',
    durationDays: '',
    quantity: '',
    instructions: '',
  }
}

export function addPrescriptionItem(form, item) {
  if (!item.medicationName || !item.dose || !item.frequency) return false
  form.prescriptionItems.push({ ...item })
  Object.assign(item, makePrescriptionItemDraft())
  return true
}

export function removePrescriptionItem(form, index) {
  form.prescriptionItems.splice(index, 1)
}

export function validateEvolutionsForm(form, errors) {
  Object.keys(errors).forEach((key) => delete errors[key])
  if (!form.patientId) errors.patientId = 'Requerido'
  if (!form.chiefComplaint) errors.chiefComplaint = 'Requerido'
  return Object.keys(errors).length === 0
}

export function hasAnamnesisData(form) {
  return !!(form.currentIllnessHistory || form.illnessDuration || form.illnessOnset ||
    form.appetite || form.thirst || form.urination || form.defecation ||
    form.vomiting || form.coughing || form.sneezing || form.pruritus ||
    form.locomotionIssues || form.contactWithAnimals || form.otherSigns ||
    form.feedingType || form.feedingBrand || form.environment || form.recentTravel ||
    form.vaccinationHistory || form.dewormingHistory || form.previousIllnesses ||
    form.previousSurgeries || form.currentMedications || form.ownerObservations)
}

export function hasPhysicalExamData(form) {
  return !!(form.mucousMembranes || form.hydrationStatus || form.lymphNodes || form.skinCoat ||
    form.eyes || form.ears || form.noseThroat || form.oralCavity ||
    form.cardiovascular || form.respiratory || form.abdomen || form.musculoskeletal ||
    form.neurological || form.urogenital || form.painAssessment || form.generalObservations ||
    form.heartRate || form.respiratoryRate || form.systolicBp || form.diastolicBp ||
    form.spo2Percent || form.temperatureCelsius)
}

export function hasDiagnosisData(form) {
  return !!form.diagnosisName
}

export function prefillProfessionalFields(form, hospitalizationProfessionals, surgeryProfessionals, auth, preferredProfessionalIdFn = preferredProfessionalId) {
  const preferredHospitalization = preferredProfessionalIdFn(hospitalizationProfessionals, auth)
  const preferredSurgery = preferredProfessionalIdFn(surgeryProfessionals, auth)
  if (!form.hospitalizationOrder.responsibleVetId && preferredHospitalization) {
    form.hospitalizationOrder.responsibleVetId = preferredHospitalization
  }
  if (!form.surgeryOrder.leadSurgeonId && preferredSurgery) {
    form.surgeryOrder.leadSurgeonId = preferredSurgery
  }
}

export async function listMedicalRecords(params = {}) {
  const query = {
    page: params.page || 1,
    limit: params.limit || 25,
  }
  if (params.search) query.search = params.search
  if (params.from) query.from = params.from
  if (params.to) query.to = params.to
  const { data } = await medicalApi.list(query)
  const meta = data?.meta || data?.pagination || {}
  return {
    rows: asArray(data?.data || data).map(normalizeMedicalRecord).filter(Boolean),
    meta: {
      page: meta.page || params.page || 1,
      totalPages: meta.totalPages || meta.total_pages || meta.pages || 1,
      total: meta.total || 0,
    },
  }
}

export async function getMedicalRecordDetail(recordId) {
  const { data } = await medicalApi.get(recordId)
  return normalizeMedicalRecord(data?.data || data)
}

export async function searchPatients(query) {
  const { data } = await patientsApi.list({ search: query, limit: 8 })
  return asArray(data?.data || data?.patients || data).map(normalizePatient).filter(Boolean)
}

export async function loadPatientHistoryForEvolutions(patientId) {
  const [vacRes, dewRes, surgRes] = await Promise.allSettled([
    vaccinationsApi.list({ patientId, limit: 50 }),
    vaccinationsApi.deworming.list({ patientId, limit: 50 }),
    labApi.surgeries.list({ patientId, limit: 20 }),
  ])

  const takeRows = (result) => (result.status === 'fulfilled' ? asArray(result.value?.data?.data || result.value?.data) : [])
  const formatDate = (value) => {
    if (!value) return ''
    return new Date(value).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  }

  const vaccines = takeRows(vacRes)
  const deworming = takeRows(dewRes)
  const surgeries = takeRows(surgRes)

  return {
    vaccinationHistory: vaccines.length
      ? vaccines
        .map((v) => `${formatDate(v.vaccination_date)} - ${v.vaccine_name}${v.disease_covered ? ` (${v.disease_covered})` : ''}${v.next_due_date ? ` | próximo: ${formatDate(v.next_due_date)}` : ''}`)
        .join('\n')
      : '',
    dewormingHistory: deworming.length
      ? deworming
        .map((d) => `${formatDate(d.deworming_date)} - ${d.product_name}${d.parasite_type ? ` (${d.parasite_type})` : ''}${d.next_due_date ? ` | próximo: ${formatDate(d.next_due_date)}` : ''}`)
        .join('\n')
      : '',
    previousSurgeries: surgeries.length
      ? surgeries
        .filter((s) => s.status === 'completed')
        .map((s) => `${formatDate(s.scheduled_date)} - ${s.surgery_type} (${s.surgery_category}) | ${s.lead_surgeon}`)
        .join('\n')
      : '',
  }
}

export async function loadOrderCatalogs() {
  const [labTestsRes, imagingTypesRes, surgeryTypesRes, wardsRes] = await Promise.allSettled([
    labApi.tests(),
    labApi.imaging.types(),
    labApi.surgeries.types(),
    labApi.hospitalizations.wardsAvailability(),
  ])
  const dataFrom = (result) => result.status === 'fulfilled' ? result.value?.data : null

  return {
    labTests: asArray(dataFrom(labTestsRes)?.data || dataFrom(labTestsRes)).map(normalizeLabTest).filter(Boolean),
    imagingTypes: asArray(dataFrom(imagingTypesRes)?.data || dataFrom(imagingTypesRes)).map(normalizeImagingType).filter(Boolean),
    surgeryTypes: asArray(dataFrom(surgeryTypesRes)?.data || dataFrom(surgeryTypesRes)).map(normalizeSurgeryType).filter(Boolean),
    availableWards: normalizeWardAvailability(dataFrom(wardsRes)?.data || dataFrom(wardsRes)?.wards || dataFrom(wardsRes)),
  }
}

export async function loadProfessionalsForEvolutions(auth) {
  const currentRoles = String(auth?.roles || '')
    .split(',')
    .map((role) => role.trim())
    .filter(Boolean)
  const isAdmin = currentRoles.includes('superadmin') || currentRoles.includes('org_admin')

  if (isAdmin) {
    const { data } = await adminUsersApi.list({ limit: 100 })
    return asArray(data?.data || data)
      .map(normalizeProfessional)
      .filter((entry) => entry && entry.isActive && entry.roles.some((role) => ['veterinarian', 'surgeon', 'vet_technician', 'tele_vet'].includes(role)))
  }

  const self = normalizeProfessional(auth?.user || null)
  return self ? [self] : []
}

export async function loadRelatedOrders(record) {
  if (!record?.id || !record?.patient_id) return { lab: [], imaging: [], surgeries: [], hospitalizations: [] }
  const patientId = record.patient_id
  const recordId = record.id
  const [labRes, imagingRes, surgeryRes, hospRes] = await Promise.allSettled([
    labApi.orders.list({ patientId, limit: 100 }),
    labApi.imaging.list({ patientId, limit: 100 }),
    labApi.surgeries.list({ patientId, limit: 100 }),
    labApi.hospitalizations.list({ limit: 100 }),
  ])

  const takeData = (result) => result.status === 'fulfilled' ? (result.value?.data?.data || result.value?.data?.orders || result.value?.data) : []
  return {
    lab: asArray(takeData(labRes)).map(normalizeRelatedLabOrder).filter((row) => row && String(row.medical_record_id) === String(recordId)),
    imaging: asArray(takeData(imagingRes)).map(normalizeRelatedImagingOrder).filter((row) => row && String(row.medical_record_id) === String(recordId)),
    surgeries: asArray(takeData(surgeryRes)).map(normalizeRelatedSurgery).filter((row) => row && String(row.medical_record_id) === String(recordId)),
    hospitalizations: asArray(takeData(hospRes)).map(normalizeRelatedHospitalization).filter((row) => row && String(row.medical_record_id) === String(recordId)),
  }
}

// B-8: lock multi-tab via localStorage para evitar doble-guardado desde distintas pestañas
const CREATING_KEY = 'vetapp_evolution_creating'
const CREATING_TIMEOUT_MS = 30_000

function _acquireCreateLock() {
  try {
    const existing = localStorage.getItem(CREATING_KEY)
    if (existing) {
      const ts = parseInt(existing, 10)
      if (Date.now() - ts < CREATING_TIMEOUT_MS) return false
    }
    localStorage.setItem(CREATING_KEY, String(Date.now()))
    return true
  } catch {
    return true // si localStorage no está disponible, permitir y confiar en el servidor
  }
}

function _releaseCreateLock() {
  try { localStorage.removeItem(CREATING_KEY) } catch { /* ignorar */ }
}

export async function createMedicalRecordWithAttachments(form) {
  if (!_acquireCreateLock()) throw new Error('Guardado en progreso en otra pestaña, por favor espere')
  try {
    return await _doCreateMedicalRecordWithAttachments(form)
  } finally {
    _releaseCreateLock()
  }
}

async function _doCreateMedicalRecordWithAttachments(form) {
  const payload = buildMedicalRecordPayload(form)
  const { data } = await medicalApi.create(payload)
  const recordId = data.data?.id || data.id

  if (form.currentIllnessHistory || form.illnessDuration || form.illnessOnset || form.appetite || form.thirst || form.urination || form.defecation || form.vaccinationHistory || form.dewormingHistory || form.previousIllnesses || form.previousSurgeries || form.currentMedications || form.ownerObservations || form.otherSigns || form.feedingType || form.feedingBrand || form.environment || form.recentTravel || form.vomiting || form.coughing || form.sneezing || form.pruritus || form.locomotionIssues || form.contactWithAnimals) {
    await medicalApi.anamnesis(recordId, buildAnamnesisPayload(form))
  }

  const pe = buildPhysicalExamPayload(form)
  if (Object.keys(pe).length) {
    await medicalApi.physicalExam(recordId, pe)
  }

  if (form.diagnosisName) {
    await medicalApi.diagnoses(recordId, buildDiagnosisPayload(form))
  }

  if (form.treatment.treatmentType) {
    await medicalApi.treatments(recordId, buildTreatmentPayload(form))
  }

  if (form.labOrder.tests.length > 0) {
    await labApi.orders.create(buildLabOrderPayload(form, recordId))
  }

  if (form.imagingOrder.imagingTypeId) {
    await labApi.imaging.create(buildImagingOrderPayload(form, recordId))
  }

  if (form.hospitalizationOrder.hospitalizationReason && form.hospitalizationOrder.responsibleVetId) {
    await labApi.hospitalizations.create(buildHospitalizationOrderPayload(form, recordId))
  }

  if (form.surgeryOrder.surgeryTypeId && form.surgeryOrder.leadSurgeonId && form.surgeryOrder.scheduledDate) {
    await labApi.surgeries.create(buildSurgeryOrderPayload(form, recordId))
  }

  if (form.prescriptionItems.length > 0) {
    await medicalApi.prescriptions.create(recordId, buildPrescriptionPayload(form))
  }

  return recordId
}

export async function submitDetailLabOrder(detailRecord, detailOrders) {
  await labApi.orders.create({
    patientId: parseInt(detailRecord.patient_id, 10),
    medicalRecordId: detailRecord.id,
    priority: detailOrders.lab.priority,
    clinicalNotes: detailOrders.lab.clinicalNotes || detailRecord.chief_complaint,
    tests: detailOrders.lab.tests.map((testId) => ({ testId })),
  })
}

export async function submitDetailImagingOrder(detailRecord, detailOrders) {
  await labApi.imaging.create({
    patientId: parseInt(detailRecord.patient_id, 10),
    medicalRecordId: detailRecord.id,
    imagingTypeId: parseInt(detailOrders.imaging.imagingTypeId, 10),
    priority: detailOrders.imaging.priority,
    bodyRegion: detailOrders.imaging.bodyRegion || undefined,
    clinicalIndication: detailOrders.imaging.clinicalIndication || detailRecord.chief_complaint,
    sedationRequired: !!detailOrders.imaging.sedationRequired,
  })
}

export async function submitDetailHospitalization(detailRecord, detailOrders) {
  await labApi.hospitalizations.create({
    patientId: parseInt(detailRecord.patient_id, 10),
    medicalRecordId: detailRecord.id,
    responsibleVetId: parseInt(detailOrders.hospitalization.responsibleVetId, 10),
    wardId: detailOrders.hospitalization.wardId ? parseInt(detailOrders.hospitalization.wardId, 10) : undefined,
    kennelId: detailOrders.hospitalization.kennelId ? parseInt(detailOrders.hospitalization.kennelId, 10) : undefined,
    hospitalizationReason: detailOrders.hospitalization.hospitalizationReason,
    admissionDiagnosis: detailOrders.hospitalization.admissionDiagnosis || undefined,
    admissionWeight: detailOrders.hospitalization.admissionWeight || undefined,
    estimatedDischargeDate: detailOrders.hospitalization.estimatedDischargeDate || undefined,
    specialInstructions: detailOrders.hospitalization.specialInstructions || undefined,
  })
}

export async function submitDetailSurgery(detailRecord, detailOrders) {
  const payload = {
    patientId: parseInt(detailRecord.patient_id, 10),
    medicalRecordId: detailRecord.id,
    surgeryTypeId: parseInt(detailOrders.surgery.surgeryTypeId, 10),
    leadSurgeonId: parseInt(detailOrders.surgery.leadSurgeonId, 10),
    scheduledDate: detailOrders.surgery.startTime
      ? `${detailOrders.surgery.scheduledDate}T${detailOrders.surgery.startTime}`
      : `${detailOrders.surgery.scheduledDate}T09:00`,
    urgency: detailOrders.surgery.urgency || 'elective',
  }
  if (detailOrders.surgery.startTime) payload.startTime = detailOrders.surgery.startTime
  if (detailOrders.surgery.preoperativeDiagnosis) payload.preoperativeDiagnosis = detailOrders.surgery.preoperativeDiagnosis
  if (detailOrders.surgery.surgicalApproach) payload.surgicalApproach = detailOrders.surgery.surgicalApproach
  if (detailOrders.surgery.notes) payload.notes = detailOrders.surgery.notes
  await labApi.surgeries.create(payload)
}

export async function refreshDetailRecord(recordId) {
  const { data } = await medicalApi.get(recordId)
  return normalizeMedicalRecord(data?.data || data)
}

export function extractEvolutionError(error, fallback) {
  return extractDetailedErrorMessage(error, fallback, { context: 'Evoluciones' })
}

export default function useEvolutionsDomain() {
  return {
    asArray,
    normalizeMedicalRecord,
    normalizePatient,
    normalizeRelatedLabOrder,
    normalizeRelatedImagingOrder,
    normalizeRelatedSurgery,
    normalizeRelatedHospitalization,
    normalizeLabTest,
    normalizeImagingType,
    normalizeSurgeryType,
    normalizeWardAvailability,
    normalizeProfessional,
    normalizeRoleList,
    currentUserProfessional,
    preferredProfessionalId,
    buildMedicalRecordPayload,
    buildAnamnesisPayload,
    buildPhysicalExamPayload,
    buildDiagnosisPayload,
    buildTreatmentPayload,
    buildLabOrderPayload,
    buildImagingOrderPayload,
    buildHospitalizationOrderPayload,
    buildSurgeryOrderPayload,
    buildPrescriptionPayload,
    makeDetailOrdersForm,
    makeEvolutionsForm,
    makePrescriptionItemDraft,
    addPrescriptionItem,
    removePrescriptionItem,
    validateEvolutionsForm,
    hasAnamnesisData,
    hasPhysicalExamData,
    hasDiagnosisData,
    prefillProfessionalFields,
    listMedicalRecords,
    getMedicalRecordDetail: refreshDetailRecord,
    searchPatients,
    loadPatientHistoryForEvolutions,
    loadOrderCatalogs,
    loadProfessionalsForEvolutions,
    loadRelatedOrders,
    createMedicalRecordWithAttachments,
    submitDetailLabOrder,
    submitDetailImagingOrder,
    submitDetailHospitalization,
    submitDetailSurgery,
    refreshDetailRecord,
    extractEvolutionError,
  }
}
