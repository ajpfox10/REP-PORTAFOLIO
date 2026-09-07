import { clientsApi, patientsApi } from '../../api'
import { extractDetailedErrorMessage } from '../../utils/errors'

export function asArray(value) {
  return Array.isArray(value) ? value : []
}

export function normalizePatient(row) {
  if (!row || typeof row !== 'object') return null
  return {
    ...row,
    species: row.species || row.species_name || row.speciesName || '',
    breed_name: row.breed_name || row.breedName || row.breed || '',
    breed: row.breed || row.breed_name || row.breedName || '',
    primary_owner: row.primary_owner || row.owner_name || row.ownerName || '',
    owner_name: row.owner_name || row.primary_owner || row.ownerName || '',
    owner_phone: row.owner_phone || row.ownerPhone || '',
    owner_id: row.owner_id ?? row.ownerId ?? null,
    hc_number: row.hc_number || row.hcNumber || '',
    weight_kg: row.weight_kg ?? row.weightKg ?? null,
    body_condition_score: row.body_condition_score ?? row.bodyConditionScore ?? null,
    chip_number: row.chip_number || row.microchip_number || row.microchipNumber || '',
    scientific_name: row.scientific_name || '',
    coat_color_name: row.coat_color_name || row.coatColorName || row.coat_color || '',
    photo_url: row.photo_url || row.photoUrl || '',
    tattoo_number: row.tattoo_number || row.tattooNumber || row.tattoo_code || '',
    passport_number: row.passport_number || row.passportNumber || '',
    notes: row.notes || '',
    owners: asArray(row.owners),
    allergies: asArray(row.allergies),
    chronicConditions: asArray(row.chronicConditions),
    is_active: row.is_active ?? row.active ?? true,
  }
}

const SPECIES_COLORS = {
  perro: { text: '#8B5E3C', bg: '#FFF0E0' },
  gato: { text: '#7A3DAA', bg: '#F0E8FF' },
  conejo: { text: '#2E8B57', bg: '#E0FFE8' },
  ave: { text: '#1A7A9A', bg: '#E0F5FF' },
  pez: { text: '#1A5FAA', bg: '#E0EEFF' },
  reptil: { text: '#5A8A2E', bg: '#EEFFD0' },
  hámster: { text: '#A05028', bg: '#FFE8D0' },
}

export function speciesKey(species) {
  if (!species) return ''
  const lower = species.toLowerCase()
  if (lower.includes('perro') || lower.includes('dog')) return 'perro'
  if (lower.includes('gato') || lower.includes('cat')) return 'gato'
  if (lower.includes('conejo') || lower.includes('rabbit')) return 'conejo'
  if (lower.includes('ave') || lower.includes('bird')) return 'ave'
  if (lower.includes('pez') || lower.includes('fish')) return 'pez'
  if (lower.includes('reptil')) return 'reptil'
  if (lower.includes('hámster') || lower.includes('hamster')) return 'hámster'
  return lower
}

export function speciesColor(species) {
  return SPECIES_COLORS[speciesKey(species)]?.text || 'var(--text-2)'
}

export function speciesBg(species) {
  return SPECIES_COLORS[speciesKey(species)]?.bg || 'var(--surface-2)'
}

export function petEmoji(species) {
  const key = speciesKey(species || '')
  const map = { perro: '🐶', gato: '🐱', conejo: '🐰', ave: '🐦', pez: '🐟', reptil: '🦎', hámster: '🐹' }
  return map[key] || '🐾'
}

export function sexLabel(sex) {
  return sex === 'male' ? 'Macho' : sex === 'female' ? 'Hembra' : '—'
}

export function formatPatientAge(birthDate) {
  if (!birthDate) return '—'
  const date = new Date(birthDate)
  if (isNaN(date.getTime())) return '—'
  const diff = Date.now() - date.getTime()
  if (diff < 0) return 'Fecha inválida'
  const years = Math.floor(diff / (1000 * 60 * 60 * 24 * 365))
  const months = Math.floor(diff / (1000 * 60 * 60 * 24 * 30))
  if (years >= 1) return `${years} año${years !== 1 ? 's' : ''}`
  return `${months} mes${months !== 1 ? 'es' : ''}`
}

export function formatPatientDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export async function loadSpeciesCatalog() {
  const { data } = await patientsApi.species()
  return asArray(data?.data || data)
}

export async function listPatients(filters = {}) {
  const params = { page: filters.page ?? 1, limit: filters.limit ?? 12 }
  if (filters.search) params.search = filters.search
  if (filters.species) params.species = filters.species
  const { data } = await patientsApi.list(params)
  const meta = data.meta || data.pagination || {}
  return {
    rows: asArray(data?.data || data?.patients || data).map(normalizePatient).filter(Boolean),
    meta: {
      page: meta.page || params.page,
      totalPages: meta.totalPages || meta.total_pages || 1,
    },
  }
}

export async function getPatientDetail(patientId) {
  const { data } = await patientsApi.get(patientId)
  return normalizePatient(data?.data || data)
}

export function validatePatientForm(form, editingId, errors, translate) {
  Object.keys(errors).forEach((key) => delete errors[key])
  if (!form.name) errors.name = 'El nombre es requerido'
  if (!editingId) {
    if (!form.speciesId) errors.speciesId = translate('patients.selectSpecies')
    if (!form.ownerFirstName) errors.ownerFirstName = 'El nombre es requerido'
    if (!form.ownerLastName) errors.ownerLastName = 'El apellido es requerido'
    if (!form.ownerPhone) errors.ownerPhone = 'El teléfono es requerido'
  }
  return Object.keys(errors).length === 0
}

export function buildPatientUpdatePayload(form) {
  const payload = { name: form.name, sex: form.sex }
  if (form.birthDate) payload.birthDate = form.birthDate
  if (form.weight) payload.weightKg = parseFloat(form.weight)
  if (form.microchip) payload.microchipNumber = form.microchip
  if (form.breedId) payload.breedId = parseInt(form.breedId, 10)
  if (form.coatColorId) payload.coatColorId = parseInt(form.coatColorId, 10)
  if (form.tattooNumber) payload.tattooNumber = form.tattooNumber
  if (form.passportNumber) payload.passportNumber = form.passportNumber
  if (form.bodyConditionScore) payload.bodyConditionScore = parseFloat(form.bodyConditionScore)
  payload.isNeutered = !!form.isNeutered
  payload.isDeceased = !!form.isDeceased
  if (form.photoUrl) payload.photoUrl = form.photoUrl
  if (form.notes) payload.notes = form.notes
  return payload
}

export function buildOwnerPayload(form) {
  return {
    firstName: form.ownerFirstName,
    lastName: form.ownerLastName,
    phone: form.ownerPhone,
    email: form.ownerEmail || undefined,
  }
}

export function buildPatientCreatePayload(form, clientId) {
  const payload = {
    name: form.name,
    speciesId: parseInt(form.speciesId, 10),
    primaryOwnerId: clientId,
    sex: form.sex || 'unknown',
  }
  if (form.birthDate) payload.birthDate = form.birthDate
  if (form.weight) payload.weightKg = parseFloat(form.weight)
  if (form.microchip) payload.microchipNumber = form.microchip
  if (form.breedId) payload.breedId = parseInt(form.breedId, 10)
  if (form.coatColorId) payload.coatColorId = parseInt(form.coatColorId, 10)
  if (form.tattooNumber) payload.tattooNumber = form.tattooNumber
  if (form.passportNumber) payload.passportNumber = form.passportNumber
  if (form.bodyConditionScore) payload.bodyConditionScore = parseFloat(form.bodyConditionScore)
  payload.isNeutered = !!form.isNeutered
  payload.isDeceased = !!form.isDeceased
  if (form.photoUrl) payload.photoUrl = form.photoUrl
  if (form.notes) payload.notes = form.notes
  return payload
}

export async function createOwnerAndPatient(form) {
  const clientRes = await clientsApi.create(buildOwnerPayload(form))
  const clientId = clientRes.data?.data?.id || clientRes.data?.id
  await patientsApi.create(buildPatientCreatePayload(form, clientId))
}

export async function updatePatient(patientId, form) {
  await patientsApi.update(patientId, buildPatientUpdatePayload(form))
}

export function extractPatientError(error, fallback) {
  const message = extractDetailedErrorMessage(error, fallback, { context: 'Pacientes' })
  return /request failed with status code/i.test(message)
    ? extractDetailedErrorMessage({ response: error?.response }, fallback, { context: 'Pacientes' })
    : message
}

export function formatPatientSaveError(error) {
  const detail = error?.response?.data?.error?.details
  if (detail?.length) return detail.map((entry) => `${entry.path}: ${entry.msg}`).join(', ')
  return extractPatientError(error, 'No se pudo guardar el paciente.')
}
