<template>
  <div class="page">

    <div class="page-header">
      <div class="page-header__left">
        <span class="page-emoji">🐾</span>
        <div>
          <h2 class="page-title">{{ t('patients.title') }}</h2>
          <p class="page-sub">{{ t('patients.subtitle') }}</p>
        </div>
      </div>
      <BaseButton type="button" @click="openModal()">{{ t('patients.newPatient') }}</BaseButton>
    </div>

    <!-- Búsqueda -->
    <div class="filters">
      <label for="pat-search" class="sr-only">{{ t('patients.searchPlaceholder') }}</label>
      <input id="pat-search" name="pat-search" v-model.trim="search" type="search" :placeholder="t('patients.searchPlaceholder')" class="filter-input filter-input--grow" @input="debouncedLoad()" />
      <label for="pat-species" class="sr-only">{{ t('patients.allSpecies') }}</label>
      <select id="pat-species" name="pat-species" v-model="speciesFilter" class="filter-select" @change="load()">
        <option value="">{{ t('patients.allSpecies') }}</option>
        <option v-for="sp in speciesList" :key="sp.id" :value="sp.common_name">
          {{ petEmoji(sp.slug) }} {{ sp.common_name }}
        </option>
      </select>
    </div>
    <div v-if="speciesError" class="alert alert--warning" role="status">{{ speciesError }}</div>

    <!-- Carga -->
    <div v-if="loading" class="loading-state" role="status" aria-live="polite">
      <span class="spin spin--dark" /> {{ t('patients.loading') }}
    </div>
    <div v-else-if="error" class="alert alert--error" role="alert">{{ error }}</div>

    <!-- Grid de pacientes -->
    <div v-else-if="items.length === 0" class="empty-state">
      <span class="empty-state__emoji">🐾</span>
      <p>{{ t('patients.empty') }}</p>
      <BaseButton type="button" variant="ghost" @click="openModal()">{{ t('patients.registerFirst') }}</BaseButton>
    </div>

    <div v-else class="patient-grid">
      <div v-for="p in items" :key="p.id" class="patient-card" :style="{ '--pet-color': speciesColor(p.species) }">
        <div class="patient-card__top">
          <span class="patient-card__emoji">{{ petEmoji(p.species) }}</span>
          <div class="patient-card__info">
            <strong class="patient-card__name">{{ p.name }}</strong>
            <span class="patient-card__species">{{ p.species }}</span>
          </div>
          <span class="badge badge--species" :style="{ background: speciesBg(p.species), color: speciesColor(p.species) }">
            {{ p.breed_name || p.breed || t('patients.noBreed') }}
          </span>
        </div>
        <div class="patient-card__body">
          <div class="patient-card__row">
            <span>📁</span>
            <span>{{ p.hc_number || '—' }}</span>
          </div>
          <div class="patient-card__row">
            <span>👤</span>
            <span>{{ p.primary_owner || p.owner_name || '—' }}</span>
          </div>
          <div class="patient-card__row">
            <span>🎂</span>
            <span>{{ p.birth_date ? formatAge(p.birth_date) : '—' }}</span>
          </div>
          <div class="patient-card__row">
            <span>⚖️</span>
            <span>{{ p.weight_kg ? p.weight_kg + ' kg' : '—' }}</span>
          </div>
          <div v-if="p.coat_color" class="patient-card__row">
            <span>🎨</span>
            <span>{{ p.coat_color }}</span>
          </div>
        </div>
        <div class="patient-card__footer">
          <span class="badge" :class="p.is_active !== false ? 'badge--active' : 'badge--inactive'">
            {{ p.is_active !== false ? t('common.active') : t('common.inactive') }}
          </span>
          <div class="patient-card__actions">
            <button type="button" class="btn-card" :title="t('patients.history')" :aria-label="t('patients.history')" @click="openDetail(p)">📋</button>
            <button type="button" class="btn-card" :title="t('patients.edit')" :aria-label="t('patients.edit')" @click="openEdit(p)">✏️</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Paginación -->
    <div v-if="pagination.totalPages > 1" class="pagination">
      <button type="button" :disabled="pagination.page <= 1" @click="loadPage(pagination.page - 1)">← Ant.</button>
      <span>{{ pagination.page }} / {{ pagination.totalPages }}</span>
      <button type="button" :disabled="pagination.page >= pagination.totalPages" @click="loadPage(pagination.page + 1)">{{ t('patients.next') }} →</button>
    </div>

    <!-- Modal detalle -->
    <Transition name="modal">
      <div v-if="showDetail" class="modal-backdrop" @click.self="showDetail = false">
        <div class="modal">
          <div class="modal__header">
            <h3>{{ petEmoji(detailPatient?.species) }} {{ detailPatient?.name }}</h3>
            <BaseButton type="button" variant="ghost" class="modal__close" @click="showDetail = false">✕</BaseButton>
          </div>
          <div v-if="detailLoading" class="loading-state" role="status" aria-live="polite">
            <span class="spin spin--dark" /> {{ t('patients.loading') }}
          </div>
          <div v-else-if="detailError" class="alert alert--error" role="alert">{{ detailError }}</div>
          <div class="form-body" v-else-if="detailPatient">
            <div class="detail-row"><b>{{ t('patients.species') }}:</b> {{ detailPatient.species }}</div>
            <div class="detail-row"><b>HC:</b> {{ detailPatient.hc_number || '—' }}</div>
            <div class="detail-row" v-if="detailPatient.scientific_name"><b>Nombre científico:</b> {{ detailPatient.scientific_name }}</div>
            <div class="detail-row"><b>{{ t('patients.breed') }}:</b> {{ detailPatient.breed_name || detailPatient.breed || t('patients.noBreed') }}</div>
            <div class="detail-row"><b>{{ t('patients.sex') }}:</b> {{ sexLabel(detailPatient.sex) }}</div>
            <div class="detail-row"><b>{{ t('patients.birthdate') }}:</b> {{ detailPatient.birth_date ? formatDate(detailPatient.birth_date) : '—' }}</div>
            <div class="detail-row"><b>{{ t('patients.weight') }}:</b> {{ detailPatient.weight_kg ? detailPatient.weight_kg + ' kg' : '—' }}</div>
            <div class="detail-row"><b>Condición corporal:</b> {{ detailPatient.body_condition_score || '—' }}</div>
            <div class="detail-row"><b>{{ t('patients.chip') }}:</b> {{ detailPatient.chip_number || '—' }}</div>
            <div class="detail-row"><b>Tatuaje:</b> {{ detailPatient.tattoo_number || detailPatient.tattoo_code || '—' }}</div>
            <div class="detail-row"><b>Pasaporte:</b> {{ detailPatient.passport_number || '—' }}</div>
            <div class="detail-row"><b>Color de pelaje:</b> {{ detailPatient.coat_color_name || detailPatient.coat_color || '—' }}</div>
            <div class="detail-row"><b>Esterilizado:</b> {{ boolLabel(detailPatient.is_sterilized ?? detailPatient.is_neutered) }}</div>
            <div class="detail-row"><b>Fallecido:</b> {{ boolLabel(detailPatient.is_deceased) }}</div>
            <div class="detail-row"><b>{{ t('patients.owner') }}:</b> {{ detailPatient.primary_owner || '—' }}</div>
            <div class="detail-row"><b>{{ t('patients.ownerPhone') }}:</b> {{ detailPatient.owner_phone || '—' }}</div>
            <div class="detail-row" v-if="detailPatient.photo_url"><b>Foto:</b> <a :href="detailPatient.photo_url" target="_blank" rel="noopener noreferrer">{{ detailPatient.photo_url }}</a></div>
            <div class="detail-row" v-if="detailPatient.notes"><b>Notas:</b> {{ detailPatient.notes }}</div>

            <div v-if="detailPatient.owners?.length" class="detail-block">
              <b>Propietarios</b>
              <ul class="detail-list">
                <li v-for="owner in detailPatient.owners" :key="owner.id">
                  {{ [owner.first_name, owner.last_name].filter(Boolean).join(' ') || '—' }}
                  <span class="sub">{{ owner.ownership_type || 'secondary' }} · {{ owner.phone || owner.email || 'sin contacto' }}</span>
                </li>
              </ul>
            </div>

            <div v-if="detailPatient.allergies?.length" class="detail-block">
              <b>Alergias</b>
              <ul class="detail-list">
                <li v-for="allergy in detailPatient.allergies" :key="allergy.id || allergy.allergen">
                  {{ allergy.allergen || '—' }}
                  <span class="sub">{{ [allergy.severity, allergy.reaction_description].filter(Boolean).join(' · ') || 'sin detalle' }}</span>
                </li>
              </ul>
            </div>

            <div v-if="detailPatient.chronicConditions?.length" class="detail-block">
              <b>Condiciones crónicas</b>
              <ul class="detail-list">
                <li v-for="condition in detailPatient.chronicConditions" :key="condition.id || condition.condition_name">
                  {{ condition.condition_name || '—' }}
                  <span class="sub">{{ [condition.diagnosis_code, condition.managed_with].filter(Boolean).join(' · ') || 'sin detalle' }}</span>
                </li>
              </ul>
            </div>
          </div>
          <div class="modal__actions">
            <BaseButton type="button" variant="ghost" @click="showDetail = false">{{ t('common.close') }}</BaseButton>
            <BaseButton type="button" @click="openEdit(detailPatient); showDetail = false">{{ t('patients.edit') }}</BaseButton>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Modal nuevo/editar paciente -->
    <Transition name="modal">
      <div v-if="showModal" class="modal-backdrop" @click.self="closeModal()">
        <div class="modal">
          <div class="modal__header">
            <h3>{{ editingId ? t('patients.editPatient') : t('patients.newPatientModal') }}</h3>
            <BaseButton type="button" variant="ghost" class="modal__close" @click="closeModal()">✕</BaseButton>
          </div>
          <form @submit.prevent="handleSave" novalidate>
            <div class="form-body">
              <div class="form-section-title">{{ t('patients.petData') }}</div>
              <div class="form-grid">
                <div class="field">
                  <label for="pat-name">Nombre <span class="req">*</span></label>
                  <input id="pat-name" name="pat-name" v-model.trim="form.name" type="text" placeholder="Max" :disabled="saving" required />
                  <span v-if="fe.name" class="field-error">{{ fe.name }}</span>
                </div>
                <div class="field">
                  <label for="pat-species-id">Especie <span class="req">*</span></label>
                  <select id="pat-species-id" name="pat-species-id" v-model="form.speciesId" :disabled="saving || !!editingId" required>
                    <option value="">{{ t('common.choose') }}</option>
                    <option v-for="sp in speciesList" :key="sp.id" :value="sp.id">
                      {{ petEmoji(sp.slug) }} {{ sp.common_name }}
                    </option>
                  </select>
                  <span v-if="editingId" class="field-hint">{{ t('patients.cannotChangeSpecies') }}</span>
                  <span v-if="fe.speciesId" class="field-error">{{ fe.speciesId || t('patients.selectSpecies') }}</span>
                </div>
                <div class="field">
                  <label for="pat-sex">Sexo <span class="req">*</span></label>
                  <select id="pat-sex" name="pat-sex" v-model="form.sex" :disabled="saving" required>
                    <option value="unknown">{{ t('common.none') }}</option>
                    <option value="male">Macho</option>
                    <option value="female">Hembra</option>
                  </select>
                  <span v-if="fe.sex" class="field-error">{{ fe.sex }}</span>
                </div>
                <div class="field">
                  <label for="pat-birth">{{ t('patients.birthdate') }}</label>
                  <input id="pat-birth" name="pat-birth" v-model="form.birthDate" type="date" :disabled="saving" />
                </div>
                <div class="field">
                  <label for="pat-weight">Peso (kg)</label>
                  <input id="pat-weight" name="pat-weight" v-model.number="form.weight" type="number" step="0.1" min="0" placeholder="3.5" :disabled="saving" />
                </div>
                <div class="field">
                  <label for="pat-bcs">Condición corporal</label>
                  <input id="pat-bcs" name="pat-bcs" v-model.number="form.bodyConditionScore" type="number" min="1" max="9" step="0.5" placeholder="5" :disabled="saving" />
                </div>
                <div class="field">
                  <label for="pat-microchip">Microchip</label>
                  <input id="pat-microchip" name="pat-microchip" v-model.trim="form.microchip" type="text" placeholder="123456789012345" :disabled="saving" />
                </div>
                <div class="field">
                  <label for="pat-breed">Raza ID</label>
                  <input id="pat-breed" name="pat-breed" v-model.number="form.breedId" type="number" min="1" placeholder="Opcional" :disabled="saving" />
                </div>
                <div class="field">
                  <label for="pat-color">Color ID</label>
                  <input id="pat-color" name="pat-color" v-model.number="form.coatColorId" type="number" min="1" placeholder="Opcional" :disabled="saving" />
                </div>
                <div class="field">
                  <label for="pat-tattoo">Tatuaje</label>
                  <input id="pat-tattoo" name="pat-tattoo" v-model.trim="form.tattooNumber" type="text" placeholder="Opcional" :disabled="saving" />
                </div>
                <div class="field">
                  <label for="pat-passport">Pasaporte</label>
                  <input id="pat-passport" name="pat-passport" v-model.trim="form.passportNumber" type="text" placeholder="Opcional" :disabled="saving" />
                </div>
                <div class="field">
                  <label for="pat-photo">Foto URL</label>
                  <input id="pat-photo" name="pat-photo" v-model.trim="form.photoUrl" type="url" placeholder="https://..." :disabled="saving" />
                </div>
                <label class="checkbox-label">
                  <input id="pat-neutered" name="pat-neutered" v-model="form.isNeutered" type="checkbox" :disabled="saving" />
                  Esterilizado
                </label>
                <label class="checkbox-label">
                  <input id="pat-deceased" name="pat-deceased" v-model="form.isDeceased" type="checkbox" :disabled="saving" />
                  Fallecido
                </label>
                <div class="field field--full">
                  <label for="pat-notes">Notas</label>
                  <textarea id="pat-notes" name="pat-notes" v-model.trim="form.notes" rows="2" placeholder="Observaciones generales" :disabled="saving" />
                </div>
              </div>

              <!-- Datos del dueño: solo en creación -->
              <template v-if="!editingId">
              <div class="form-section-title" style="margin-top:16px">{{ t('patients.owner') }}</div>
                <div class="form-grid">
                  <div class="field">
                    <label for="own-first-name">Nombre <span class="req">*</span></label>
                    <input id="own-first-name" name="own-first-name" v-model.trim="form.ownerFirstName" type="text" placeholder="María" :disabled="saving" required />
                    <span v-if="fe.ownerFirstName" class="field-error">{{ fe.ownerFirstName }}</span>
                  </div>
                  <div class="field">
                    <label for="own-last-name">Apellido <span class="req">*</span></label>
                    <input id="own-last-name" name="own-last-name" v-model.trim="form.ownerLastName" type="text" placeholder="García" :disabled="saving" required />
                    <span v-if="fe.ownerLastName" class="field-error">{{ fe.ownerLastName }}</span>
                  </div>
                  <div class="field">
                    <label for="own-phone">Teléfono <span class="req">*</span></label>
                    <input id="own-phone" name="own-phone" v-model.trim="form.ownerPhone" type="tel" placeholder="+54 9 11 1234-5678" :disabled="saving" required />
                    <span v-if="fe.ownerPhone" class="field-error">{{ fe.ownerPhone }}</span>
                  </div>
                  <div class="field">
                    <label for="own-email">Email</label>
                    <input id="own-email" name="own-email" v-model.trim="form.ownerEmail" type="email" placeholder="maria@email.com" :disabled="saving" />
                  </div>
                </div>
              </template>
            </div>

            <div v-if="saveError" class="alert alert--error mx" role="alert">{{ saveError }}</div>
            <div class="modal__actions">
      <BaseButton type="button" variant="ghost" @click="closeModal()" :disabled="saving">{{ t('common.cancel') }}</BaseButton>
              <BaseButton type="submit" :disabled="saving">
                <span v-if="saving" class="spin spin--sm" />
                <span v-else>{{ editingId ? t('patients.saveChanges') : t('patients.registerPatient') }}</span>
              </BaseButton>
            </div>
          </form>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import BaseButton from '../components/base/BaseButton.vue'
import {
  createOwnerAndPatient,
  extractPatientError,
  formatPatientAge,
  formatPatientDate,
  formatPatientSaveError,
  getPatientDetail,
  listPatients,
  loadSpeciesCatalog,
  normalizePatient,
  petEmoji,
  sexLabel,
  speciesBg,
  speciesColor,
  updatePatient,
  validatePatientForm,
} from '../composables/patients/usePatientsDomain'
import { t } from '../i18n'
import { logError } from '../utils/errors'
import { useUiFeedback } from '../composables/useUiFeedback'

const { success } = useUiFeedback()

const items        = ref([])
const loading      = ref(false)
const error        = ref('')
const search       = ref('')
const speciesFilter = ref('')
const pagination   = ref({ page: 1, totalPages: 1 })
const speciesList  = ref([])   // [{ id, common_name, slug }]
const speciesError = ref('')

function formatAge(bd) {
  return formatPatientAge(bd)
}

function formatDate(iso) {
  return formatPatientDate(iso)
}

// ── Load species list ────────────────────────────────────────────────────────

async function loadSpecies() {
  speciesError.value = ''
  try {
    speciesList.value = await loadSpeciesCatalog()
  } catch (error) {
    logError('pacientes.loadSpecies', error)
    speciesError.value = 'No se pudo cargar el catálogo de especies. Podés seguir viendo pacientes, pero para crear uno nuevo necesitás reintentar.'
  }
}

// ── Load patients ────────────────────────────────────────────────────────────

async function load(page = 1) {
  loading.value = true; error.value = ''
  try {
    const payload = await listPatients({
      page,
      limit: 12,
      search: search.value,
      species: speciesFilter.value,
    })
    items.value = payload.rows
    pagination.value = payload.meta
  } catch (e) {
    error.value = extractPatientError(e, 'No se pudieron cargar los pacientes.')
  } finally {
    loading.value = false
  }
}

function loadPage(p) { load(p) }

let timer = null
function debouncedLoad() {
  clearTimeout(timer)
  timer = setTimeout(() => load(), 350)
}

// ── Detail modal ─────────────────────────────────────────────────────────────

const showDetail    = ref(false)
const detailPatient = ref(null)
const detailLoading = ref(false)
const detailError   = ref('')
async function openDetail(p) {
  detailPatient.value = normalizePatient(p)
  detailError.value = ''
  showDetail.value = true
  detailLoading.value = true
  try {
    detailPatient.value = await getPatientDetail(p.id)
  } catch (e) {
    detailError.value = extractPatientError(e, 'No se pudo cargar el detalle del paciente.')
  } finally {
    detailLoading.value = false
  }
}

// ── Create / Edit modal ──────────────────────────────────────────────────────

const showModal = ref(false)
const saving    = ref(false)
const saveError = ref('')
const editingId = ref(null)
const fe        = reactive({})

const form = reactive({
  name: '', speciesId: '', sex: 'unknown', birthDate: '', weight: '', microchip: '',
  breedId: '', coatColorId: '', tattooNumber: '', passportNumber: '',
  bodyConditionScore: '', photoUrl: '', notes: '', isNeutered: false, isDeceased: false,
  ownerFirstName: '', ownerLastName: '', ownerPhone: '', ownerEmail: '',
})

function openModal() { editingId.value = null; resetForm(); showModal.value = true }
function closeModal() { showModal.value = false; resetForm() }

function resetForm() {
  form.name = ''; form.speciesId = ''; form.sex = 'unknown'
  form.birthDate = ''; form.weight = ''; form.microchip = ''
  form.breedId = ''; form.coatColorId = ''; form.tattooNumber = ''; form.passportNumber = ''
  form.bodyConditionScore = ''; form.photoUrl = ''; form.notes = ''
  form.isNeutered = false; form.isDeceased = false
  form.ownerFirstName = ''; form.ownerLastName = ''
  form.ownerPhone = ''; form.ownerEmail = ''
  editingId.value = null
  saveError.value = ''
  Object.keys(fe).forEach(k => delete fe[k])
}

function openEdit(p) {
  editingId.value = p.id
  form.name      = p.name || ''
  // Preserve speciesId as display info when editing (can't change)
  form.speciesId = p.species_id || ''
  form.sex       = p.sex || 'unknown'
  form.birthDate = p.birth_date ? (p.birth_date.includes('T') ? p.birth_date.split('T')[0] : p.birth_date.slice(0, 10)) : ''
  form.weight    = p.weight_kg || ''
  form.microchip = p.chip_number || ''
  form.breedId   = p.breed_id || ''
  form.coatColorId = p.coat_color_id || p.color_id || ''
  form.tattooNumber = p.tattoo_number || p.tattoo_code || ''
  form.passportNumber = p.passport_number || ''
  form.bodyConditionScore = p.body_condition_score || ''
  form.photoUrl = p.photo_url || ''
  form.notes = p.notes || ''
  form.isNeutered = !!(p.is_sterilized ?? p.is_neutered)
  form.isDeceased = !!p.is_deceased
  saveError.value = ''
  Object.keys(fe).forEach(k => delete fe[k])
  showModal.value = true
}

function validate() {
  return validatePatientForm(form, editingId.value, fe, t)
}

async function handleSave() {
  if (!validate()) return
  saving.value = true; saveError.value = ''
  try {
    if (editingId.value) {
      await updatePatient(editingId.value, form)
      success('Paciente actualizado.')
    } else {
      await createOwnerAndPatient(form)
      success('Paciente creado.')
    }
    closeModal()
    await load()
  } catch (e) {
    saveError.value = formatPatientSaveError(e)
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  loadSpecies()
  load()
})

onUnmounted(() => {
  clearTimeout(timer)
})

function boolLabel(value) {
  return value ? 'Sí' : 'No'
}
</script>

<style scoped>
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
.page { display: flex; flex-direction: column; gap: 20px; }

.page-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
.page-header__left { display: flex; align-items: center; gap: 14px; }
.page-emoji { font-size: 2rem; }
.page-title { font-size: 1.35rem; font-weight: 700; color: var(--text); }
.page-sub   { font-size: 0.82rem; color: var(--text-2); margin-top: 2px; }

.filters { display: flex; gap: 10px; flex-wrap: wrap; }
.filter-input, .filter-select {
  padding: 9px 13px; border: 1.5px solid var(--border); border-radius: var(--radius);
  font-size: 0.87rem; background: var(--white); color: var(--text); outline: none;
  transition: border-color var(--transition);
}
.filter-input:focus, .filter-select:focus { border-color: var(--primary); }
.filter-input--grow { flex: 1; min-width: 200px; }

/* Patient Grid */
.patient-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 14px;
}

.patient-card {
  background: var(--white);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
  border-top: 4px solid var(--pet-color, var(--primary));
  transition: box-shadow var(--transition), transform var(--transition);
}
.patient-card:hover { box-shadow: var(--shadow); transform: translateY(-2px); }

.patient-card__top {
  display: flex; align-items: center; gap: 10px;
  padding: 14px 14px 10px;
}
.patient-card__emoji { font-size: 2rem; }
.patient-card__name  { display: block; font-size: 1rem; font-weight: 700; color: var(--text); }
.patient-card__species { display: block; font-size: 0.75rem; color: var(--text-3); }
.patient-card__info  { flex: 1; min-width: 0; }

.patient-card__body { padding: 8px 14px; border-top: 1px solid var(--border); }
.patient-card__row  {
  display: flex; align-items: center; gap: 8px;
  font-size: 0.82rem; color: var(--text-2);
  padding: 4px 0;
}

.patient-card__footer {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px; border-top: 1px solid var(--border); background: var(--surface);
}
.patient-card__actions { display: flex; gap: 4px; }
.btn-card {
  background: none; border: 1px solid var(--border); border-radius: 6px;
  padding: 3px 7px; font-size: 0.85rem; cursor: pointer; transition: background var(--transition);
}
.btn-card:hover { background: var(--surface-2); }
.detail-row { padding: 6px 0; border-bottom: 1px solid var(--border); font-size: 0.9rem; color: var(--text-2); }
.detail-row b { color: var(--text); margin-right: 6px; }

/* Badges */
.badge { display: inline-block; padding: 3px 9px; border-radius: 20px; font-size: 0.72rem; font-weight: 600; }
.badge--active   { background: #D6F3EC; color: #1A9E7F; }
.badge--inactive { background: #FDEAEA; color: #c0392b; }
.badge--species  { font-size: 0.72rem; }

/* Paginación */
.pagination {
  display: flex; align-items: center; justify-content: center; gap: 16px;
  font-size: 0.85rem; color: var(--text-2);
}
.pagination button {
  padding: 6px 14px; border: 1.5px solid var(--border);
  border-radius: var(--radius-sm); background: none; cursor: pointer;
  font-size: 0.82rem; color: var(--text-2); transition: background var(--transition);
}
.pagination button:hover:not(:disabled) { background: var(--surface-2); }
.pagination button:disabled { opacity: 0.4; cursor: not-allowed; }

/* Buttons */
.btn-primary {
  padding: 10px 20px;
  background: linear-gradient(135deg, var(--primary) 0%, var(--accent-mint) 100%);
  color: white; border: none; border-radius: var(--radius);
  font-size: 0.9rem; font-weight: 600; cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px;
  transition: opacity var(--transition), transform var(--transition);
}
.btn-primary:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
.btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }

.btn-ghost {
  padding: 10px 20px; background: none; border: 1.5px solid var(--border);
  border-radius: var(--radius); color: var(--text-2); font-size: 0.9rem;
  font-weight: 500; cursor: pointer; transition: background var(--transition);
}
.btn-ghost:hover:not(:disabled) { background: var(--surface-2); }

/* Modal */
.modal-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,0.4);
  display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 16px;
}
.modal {
  background: var(--white); border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg); width: 100%; max-width: 620px; max-height: 92vh; overflow-y: auto;
}
.modal__header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 20px 24px 16px; border-bottom: 1px solid var(--border); position: sticky; top: 0;
  background: var(--white); z-index: 1;
}
.modal__header h3 { font-size: 1.1rem; font-weight: 700; color: var(--text); }
.modal__close { background: none; border: none; cursor: pointer; font-size: 1rem; color: var(--text-3); padding: 4px 8px; border-radius: var(--radius-sm); }
.modal__close:hover { background: var(--surface-2); }

.form-body { padding: 20px 24px 0; }
.form-section-title { font-size: 0.78rem; font-weight: 700; color: var(--primary); letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 12px; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

.field { display: flex; flex-direction: column; gap: 5px; }
.field label { font-size: 0.82rem; font-weight: 600; color: var(--text-2); }
.field input, .field select {
  padding: 9px 12px; border: 1.5px solid var(--border); border-radius: var(--radius);
  font-size: 0.9rem; color: var(--text); background: var(--surface); outline: none;
  transition: border-color var(--transition);
}
.field input:focus, .field select:focus { border-color: var(--primary); }
.field-error { font-size: 0.75rem; color: var(--danger); }
.field-hint  { font-size: 0.73rem; color: var(--text-3); font-style: italic; }
.req { color: var(--danger); }

.modal__actions {
  display: flex; gap: 12px; justify-content: flex-end;
  padding: 16px 24px 24px;
}

.alert { padding: 10px 14px; border-radius: var(--radius-sm); font-size: 0.875rem; }
.alert--error { background: #FDEAEA; color: #c0392b; border-left: 3px solid var(--danger); }
.alert--warning { background: #fff8e6; color: #8a5a00; border-left: 3px solid #f0b429; }
.mx { margin: 0 24px 8px; }

.loading-state, .empty-state {
  display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 12px; padding: 60px 20px;
  color: var(--text-3); font-size: 0.9rem;
  background: var(--white); border-radius: var(--radius-xl); box-shadow: var(--shadow-sm);
}
.empty-state__emoji { font-size: 3rem; }

.spin { width: 20px; height: 20px; border: 2px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: spin 0.7s linear infinite; display: inline-block; }
.spin--sm { width: 14px; height: 14px; }
.spin--dark { border-color: rgba(0,0,0,0.1); border-top-color: var(--primary); }
@keyframes spin { to { transform: rotate(360deg); } }

.modal-enter-active, .modal-leave-active { transition: opacity 0.2s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }

@media (max-width: 720px) {
  .patient-grid { grid-template-columns: 1fr; }
  .form-grid { grid-template-columns: 1fr; }
  .modal__actions { flex-direction: column-reverse; }
  .modal__actions :deep(button) { width: 100%; }
}
</style>
