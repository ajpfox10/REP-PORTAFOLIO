<template>
  <div class="page">

    <div class="page-header">
      <div class="page-header__left">
        <span class="page-emoji" aria-hidden="true">💉</span>
        <div>
          <h2 class="page-title">{{ t('vaccines.title') }}</h2>
          <p class="page-sub">{{ t('vaccines.subtitle') }}</p>
        </div>
      </div>
      <button type="button" class="btn-primary" @click="openModal()">
        {{ mainTab === 'vacunas' ? t('vaccines.registerVaccination') : t('vaccines.registerDeworming') }}
      </button>
    </div>

    <!-- Tabs principales -->
    <div class="main-tabs">
      <button class="main-tab-btn" :class="{ 'main-tab-btn--active': mainTab === 'vacunas' }" @click="mainTab = 'vacunas'" type="button">
        {{ t('vaccines.tabVaccines') }}
      </button>
      <button class="main-tab-btn" :class="{ 'main-tab-btn--active': mainTab === 'deworming' }" @click="mainTab = 'deworming'" type="button">
        {{ t('vaccines.tabDeworming') }}
      </button>
    </div>

    <!-- ==============================
         SECCIÓN VACUNAS
    ============================== -->
    <template v-if="mainTab === 'vacunas'">
      <!-- Stats rápidos -->
      <div class="stats-row">
        <div class="stat-card" style="--c:#D6F3EC;--ct:#1A9E7F">
          <span class="stat-card__icon" aria-hidden="true">✅</span>
          <div>
            <strong>{{ stats.upToDate }}</strong>
            <span>{{ t('vaccines.upToDate') }}</span>
          </div>
        </div>
        <div class="stat-card" style="--c:#FFF3CC;--ct:#8A6200">
          <span class="stat-card__icon" aria-hidden="true">⚠️</span>
          <div>
            <strong>{{ stats.dueSoon }}</strong>
            <span>{{ t('vaccines.dueSoon') }}</span>
          </div>
        </div>
        <div class="stat-card" style="--c:#FDEAEA;--ct:#c0392b">
          <span class="stat-card__icon" aria-hidden="true">🔴</span>
          <div>
            <strong>{{ stats.overdue }}</strong>
            <span>{{ t('vaccines.overdue') }}</span>
          </div>
        </div>
        <div class="stat-card" style="--c:#D6EEFF;--ct:#1A5FAA">
          <span class="stat-card__icon" aria-hidden="true">📋</span>
          <div>
            <strong>{{ stats.total }}</strong>
            <span>{{ t('vaccines.totalRecords') }}</span>
          </div>
        </div>
      </div>

      <!-- Filtros -->
      <div class="filters">
        <label for="vac-search" class="sr-only">{{ t('vaccines.searchPlaceholder') }}</label>
        <input id="vac-search" name="vac-search" v-model.trim="search" type="search" :placeholder="t('vaccines.searchPlaceholder')" class="filter-input filter-input--grow" @input="debouncedLoad()" />
        <label for="vac-status" class="sr-only">{{ t('vaccines.allStatuses') }}</label>
        <select id="vac-status" name="vac-status" v-model="statusFilter" class="filter-select" @change="load()">
          <option value="">{{ t('vaccines.allStatuses') }}</option>
          <option value="up_to_date">{{ t('vaccines.statusUpToDate') }}</option>
          <option value="due_soon">{{ t('vaccines.statusDueSoon') }}</option>
          <option value="overdue">{{ t('vaccines.statusOverdue') }}</option>
        </select>
      </div>

      <div v-if="loading" class="loading-state" role="status"><span class="spin spin--dark" /> {{ t('vaccines.loadingVaccines') }}</div>
      <div v-else-if="error" class="alert alert--error">{{ error }}</div>
      <div v-else-if="items.length === 0" class="empty-state">
        <span class="empty-state__emoji" aria-hidden="true">🐾</span>
        <p>{{ t('vaccines.emptyVaccines') }}</p>
      </div>

      <!-- Tabla vacunas -->
      <div v-else class="card">
        <table class="table">
          <thead>
            <tr>
              <th>{{ t('vaccines.patient') }}</th>
              <th>{{ t('vaccines.vaccine') }}</th>
              <th>{{ t('vaccines.applicationDate') }}</th>
              <th>{{ t('vaccines.nextDose') }}</th>
              <th>{{ t('vaccines.lot') }}</th>
              <th>Aplicación</th>
              <th>{{ t('vaccines.status') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="v in items" :key="v.id">
              <td>
                <div class="pet-cell">
                  <span>{{ petEmoji(v.species) }}</span>
                  <div>
                    <strong>{{ v.patient_name || '—' }}</strong>
                    <span class="sub">{{ v.administered_by || '' }}</span>
                  </div>
                </div>
              </td>
              <td>
                <div>
                    <strong>{{ v.vaccine_name || '—' }}</strong>
                  <span class="sub">{{ v.manufacturer || '' }}</span>
                </div>
              </td>
              <td>{{ formatDate(v.administered_date) }}</td>
              <td :class="dueDateClass(v.next_dose_due)">{{ formatDate(v.next_dose_due) }}</td>
              <td class="sub">{{ v.lot_number || '-' }}</td>
              <td class="sub">
                <span v-if="v.expiry_date">Vence {{ formatDate(v.expiry_date) }}</span>
                <span v-if="v.expiry_date && (v.dose || v.route)"> | </span>
                <span v-if="v.dose">{{ v.dose }}</span>
                <span v-if="v.dose && v.route"> / </span>
                <span v-if="v.route">{{ routeLabel(v.route) }}</span>
                <span v-if="v.administration_site" class="sub"> | {{ v.administration_site }}</span>
                <span v-if="v.medical_record_id" class="sub"> | Ficha #{{ v.medical_record_id }}</span>
                <span v-if="!v.expiry_date && !v.dose && !v.route && !v.administration_site && !v.medical_record_id">-</span>
              </td>
              <td><span class="badge" :class="vacStatus(v)">{{ vacStatusLabel(v) }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Paginación vacunas -->
      <div v-if="pagination.totalPages > 1" class="pagination">
        <button type="button" :disabled="pagination.page <= 1" @click="load(pagination.page - 1)">{{ t('common.previous') }}</button>
        <span>{{ pagination.page }} / {{ pagination.totalPages }}</span>
        <button type="button" :disabled="pagination.page >= pagination.totalPages" @click="load(pagination.page + 1)">{{ t('common.next') }}</button>
      </div>
    </template>

    <!-- ==============================
         SECCIÓN DESPARASITACIÓN
    ============================== -->
    <template v-if="mainTab === 'deworming'">
      <!-- Filtros deworming -->
      <div class="filters">
        <label for="dew-search" class="sr-only">{{ t('vaccines.searchDewormingPlaceholder') }}</label>
        <input id="dew-search" name="dew-search" v-model.trim="dewSearch" type="search" :placeholder="t('vaccines.searchDewormingPlaceholder')" class="filter-input filter-input--grow" @input="debouncedLoadDew()" />
      </div>

      <div v-if="dewLoading" class="loading-state" role="status"><span class="spin spin--dark" /> {{ t('vaccines.loadingDeworming') }}</div>
      <div v-else-if="dewError" class="alert alert--error">{{ dewError }}</div>
      <div v-else-if="dewItems.length === 0" class="empty-state">
        <span class="empty-state__emoji" aria-hidden="true">🐛</span>
        <p>{{ t('vaccines.emptyDeworming') }}</p>
      </div>

      <!-- Tabla deworming -->
      <div v-else class="card">
        <table class="table">
          <thead>
            <tr>
              <th>{{ t('vaccines.patient') }}</th>
              <th>{{ t('vaccines.product') }}</th>
              <th>{{ t('vaccines.parasiteType') }}</th>
              <th>{{ t('vaccines.date') }}</th>
              <th>{{ t('vaccines.nextDose') }}</th>
              <th>{{ t('vaccines.weightDose') }}</th>
              <th>{{ t('vaccines.administeredBy') }}</th>
              <th>Vía / notas</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in dewItems" :key="d.id">
              <td>
                <div class="pet-cell">
                  <span>{{ petEmoji(d.species) }}</span>
                  <div>
                    <strong>{{ d.patient_name || '—' }}</strong>
                    <span class="sub">{{ d.species || '' }}</span>
                  </div>
                </div>
              </td>
              <td>
                <div>
                  <strong>{{ d.product_name || '—' }}</strong>
                  <span class="sub">{{ d.active_ingredient || '' }}</span>
                </div>
              </td>
              <td>{{ d.parasite_type || '—' }}</td>
              <td>{{ formatDate(d.deworming_date) }}</td>
              <td :class="dueDateClass(d.next_due_date)">{{ formatDate(d.next_due_date) }}</td>
              <td>
                <span v-if="d.weight_at_treatment">{{ d.weight_at_treatment }} kg</span>
                <span v-if="d.weight_at_treatment && d.dose_administered"> / </span>
                <span v-if="d.dose_administered">{{ d.dose_administered }}</span>
                <span v-if="!d.weight_at_treatment && !d.dose_administered" class="sub">—</span>
              </td>
              <td class="sub">{{ d.administered_by || '—' }}</td>
              <td class="sub">
                <span v-if="d.route">{{ routeLabel(d.route) }}</span>
                <span v-if="d.route && d.notes"> | </span>
                <span v-if="d.notes">{{ d.notes }}</span>
                <span v-if="!d.route && !d.notes">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- PaginaciÃ³n deworming -->
      <div v-if="dewPagination.totalPages > 1" class="pagination">
        <button type="button" :disabled="dewPagination.page <= 1" @click="loadDew(dewPagination.page - 1)">{{ t('common.previous') }}</button>
        <span>{{ dewPagination.page }} / {{ dewPagination.totalPages }}</span>
        <button type="button" :disabled="dewPagination.page >= dewPagination.totalPages" @click="loadDew(dewPagination.page + 1)">{{ t('common.next') }}</button>
      </div>
    </template>

    <!-- ==============================
         MODAL VACUNA
    ============================== -->
    <Transition name="modal">
      <div v-if="showModal && mainTab === 'vacunas'" class="modal-backdrop" @click.self="closeModal()">
        <div class="modal">
          <div class="modal__header">
            <h3>{{ t('vaccines.registerVaccination') }}</h3>
            <button type="button" class="modal__close" :aria-label="t('common.close')" @click="closeModal()">×</button>
          </div>
          <form @submit.prevent="handleCreate" novalidate>
            <div class="form-body">
              <div class="form-grid">
                <div class="field field--full">
                  <label for="vac-m-patient">{{ t('vaccines.patient') }} <span class="req">*</span></label>
                  <input id="vac-m-patient" name="vac-m-patient" v-model.trim="patientSearch" type="search" :placeholder="t('vaccines.patientSearch')" :disabled="saving" @input="searchPatients" autocomplete="off" />
                  <div v-if="patientResults.length" class="autocomplete" role="listbox" :aria-label="t('common.searchResults')">
                    <button v-for="pt in patientResults" :key="pt.id" type="button" class="autocomplete__item" role="option" :aria-label="`${t('common.selectPatient')} ${pt.name}`" @click="selectPatient(pt)">
                      {{ petEmoji(pt.species) }} <b>{{ pt.name }}</b>
                      <span class="autocomplete__owner">— {{ pt.primary_owner || '' }}</span>
                    </button>
                  </div>
                  <div v-if="form.patientId" class="selected-patient">✅ {{ selectedPatientLabel }}</div>
                  <span v-if="fe.patientId" class="field-error">{{ fe.patientId }}</span>
                </div>
                <div class="field field--full">
                  <label for="vac-m-vaccine">{{ t('vaccines.vaccine') }} <span class="req">*</span></label>
                  <select id="vac-m-vaccine" name="vac-m-vaccine" v-model="form.vaccineId" :disabled="saving" required>
                    <option value="">{{ t('vaccines.selectVaccine') }}</option>
                    <option v-for="vac in vaccineList" :key="vac.id" :value="vac.id">{{ vac.name }}</option>
                  </select>
                  <span v-if="fe.vaccineId" class="field-error">{{ fe.vaccineId }}</span>
                </div>
                <div class="field">
                  <label for="vac-m-lot">{{ t('vaccines.lotNumber') }}</label>
                  <input id="vac-m-lot" name="vac-m-lot" v-model.trim="form.lotNumber" type="text" :placeholder="t('vaccines.lotPlaceholder')" :disabled="saving" />
                </div>
                <div class="field">
                  <label for="vac-m-date">{{ t('vaccines.applicationDate') }} <span class="req">*</span></label>
                  <input id="vac-m-date" name="vac-m-date" v-model="form.vaccinationDate" type="date" :disabled="saving" required />
                  <span v-if="fe.vaccinationDate" class="field-error">{{ fe.vaccinationDate }}</span>
                </div>
                <div class="field">
                  <label for="vac-m-next">{{ t('vaccines.nextDose') }}</label>
                  <input id="vac-m-next" name="vac-m-next" v-model="form.nextDoseDue" type="date" :disabled="saving" />
                </div>
                <div class="field">
                  <label for="vac-m-dose">Dosis</label>
                  <input id="vac-m-dose" name="vac-m-dose" v-model.trim="form.dose" type="text" placeholder="ej: 1 mL" :disabled="saving" />
                </div>
                <div class="field">
                  <label for="vac-m-expiry">Vencimiento</label>
                  <input id="vac-m-expiry" name="vac-m-expiry" v-model="form.expiryDate" type="date" :disabled="saving" />
                </div>
                <div class="field">
                  <label for="vac-m-route">Vía</label>
                  <select id="vac-m-route" name="vac-m-route" v-model="form.route" :disabled="saving">
                    <option value="">{{ t('common.choose') }}</option>
                    <option value="oral">{{ t('vaccines.routeOral') }}</option>
                    <option value="topical">{{ t('vaccines.routeTopical') }}</option>
                    <option value="injectable">{{ t('vaccines.routeInjectable') }}</option>
                    <option value="other">{{ t('common.other') }}</option>
                  </select>
                </div>
                <div class="field">
                  <label for="vac-m-site">Sitio</label>
                  <input id="vac-m-site" name="vac-m-site" v-model.trim="form.administrationSite" type="text" placeholder="ej: subcutaneo" :disabled="saving" />
                </div>
                <div class="field">
                  <label for="vac-m-record">Ficha médica</label>
                  <input id="vac-m-record" name="vac-m-record" v-model.trim="form.medicalRecordId" type="number" min="1" placeholder="ID de ficha" :disabled="saving" />
                </div>
                <div class="field field--full">
                  <label for="vac-m-notes">{{ t('vaccines.notes') }}</label>
                  <textarea id="vac-m-notes" name="vac-m-notes" v-model.trim="form.notes" rows="2" :placeholder="t('vaccines.notesPlaceholder')" :disabled="saving" />
                </div>
              </div>
            </div>
            <div v-if="saveError" class="alert alert--error mx">{{ saveError }}</div>
            <div class="modal__actions">
              <button type="button" class="btn-ghost" @click="closeModal()" :disabled="saving">{{ t('common.cancel') }}</button>
              <button type="submit" class="btn-primary" :disabled="saving">
                <span v-if="saving" class="spin spin--sm" /> <span v-else>{{ t('common.create') }}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </Transition>

    <!-- ==============================
         MODAL DESPARASITACIÓN
    ============================== -->
    <Transition name="modal">
      <div v-if="showModal && mainTab === 'deworming'" class="modal-backdrop" @click.self="closeModal()">
        <div class="modal">
          <div class="modal__header">
            <h3>{{ t('vaccines.registerDeworming') }}</h3>
            <button type="button" class="modal__close" :aria-label="t('common.close')" @click="closeModal()">×</button>
          </div>
          <form @submit.prevent="handleCreateDew" novalidate>
            <div class="form-body">
              <div class="form-grid">
                <!-- Paciente -->
                <div class="field field--full">
                  <label for="dew-m-patient">{{ t('vaccines.patient') }} <span class="req">*</span></label>
                  <input id="dew-m-patient" name="dew-m-patient" v-model.trim="dewPatientSearch" type="search" :placeholder="t('vaccines.patientSearch')" :disabled="saving" @input="searchDewPatients" autocomplete="off" />
                  <div v-if="dewPatientResults.length" class="autocomplete" role="listbox" :aria-label="t('common.searchResults')">
                    <button v-for="pt in dewPatientResults" :key="pt.id" type="button" class="autocomplete__item" role="option" :aria-label="`${t('common.selectPatient')} ${pt.name}`" @click="selectDewPatient(pt)">
                      {{ petEmoji(pt.species) }} <b>{{ pt.name }}</b>
                      <span class="autocomplete__owner">— {{ pt.primary_owner || '' }}</span>
                    </button>
                  </div>
                  <div v-if="dewForm.patientId" class="selected-patient">✅ {{ dewSelectedPatientLabel }}</div>
                  <span v-if="dewFe.patientId" class="field-error">{{ dewFe.patientId }}</span>
                </div>

                <!-- Producto antiparasitario -->
                <div class="field field--full">
                  <label for="dew-m-product">{{ t('vaccines.dewormingProduct') }} <span class="req">*</span></label>
                  <select id="dew-m-product" name="dew-m-product" v-model="dewForm.productId" :disabled="saving" required>
                    <option value="">{{ t('vaccines.selectProduct') }}</option>
                    <option v-for="p in dewProductList" :key="p.id" :value="p.id">
                      {{ p.name }}{{ p.parasite_type ? ' — ' + p.parasite_type : '' }}
                    </option>
                  </select>
                  <span v-if="dewFe.productId" class="field-error">{{ dewFe.productId }}</span>
                </div>

                <!-- Fecha -->
                <div class="field">
                  <label for="dew-m-date">{{ t('vaccines.applicationDate') }} <span class="req">*</span></label>
                  <input id="dew-m-date" name="dew-m-date" v-model="dewForm.dewormingDate" type="date" :disabled="saving" required />
                  <span v-if="dewFe.dewormingDate" class="field-error">{{ dewFe.dewormingDate }}</span>
                </div>

                <!-- Próxima dosis -->
                <div class="field">
                  <label for="dew-m-next">{{ t('vaccines.nextDose') }}</label>
                  <input id="dew-m-next" name="dew-m-next" v-model="dewForm.nextDueDate" type="date" :disabled="saving" />
                </div>

                <!-- Peso al tratamiento -->
                <div class="field">
                  <label for="dew-m-weight">{{ t('vaccines.treatmentWeight') }}</label>
                  <input id="dew-m-weight" name="dew-m-weight" v-model.number="dewForm.weightAtTreatment" type="number" step="0.01" min="0" :placeholder="`4.50 ${t('common.kg')}`" :disabled="saving" />
                </div>

                <!-- Dosis administrada -->
                <div class="field">
                  <label for="dew-m-dose">{{ t('vaccines.administeredDose') }}</label>
                  <input id="dew-m-dose" name="dew-m-dose" v-model.trim="dewForm.doseAdministered" type="text" :placeholder="t('vaccines.dosePlaceholder')" :disabled="saving" />
                </div>

                <!-- Vía de administración -->
                <div class="field">
                  <label for="dew-m-route">{{ t('vaccines.administrationRoute') }}</label>
                  <select id="dew-m-route" name="dew-m-route" v-model="dewForm.route" :disabled="saving">
                    <option value="">{{ t('common.choose') }}</option>
                    <option value="oral">{{ t('vaccines.routeOral') }}</option>
                    <option value="topical">{{ t('vaccines.routeTopical') }}</option>
                    <option value="injectable">{{ t('vaccines.routeInjectable') }}</option>
                    <option value="other">{{ t('common.other') }}</option>
                  </select>
                </div>

                <!-- Notas -->
                <div class="field field--full">
                  <label for="dew-m-notes">{{ t('vaccines.notes') }}</label>
                  <textarea id="dew-m-notes" name="dew-m-notes" v-model.trim="dewForm.notes" rows="2" :placeholder="t('vaccines.notesAdditionalPlaceholder')" :disabled="saving" />
                </div>
              </div>
            </div>
            <div v-if="dewSaveError" class="alert alert--error mx">{{ dewSaveError }}</div>
            <div class="modal__actions">
              <button type="button" class="btn-ghost" @click="closeModal()" :disabled="saving">{{ t('common.cancel') }}</button>
              <button type="submit" class="btn-primary" :disabled="saving">
                <span v-if="saving" class="spin spin--sm" /> <span v-else>{{ t('common.create') }}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import http from '../api/client'
import { t } from '../i18n'
import { logError } from '../utils/errors'

function asArray(value) {
  if (Array.isArray(value)) return value
  if (value == null) return []
  return [value]
}

function normalizePatient(row) {
  if (!row || typeof row !== 'object') return null
  return {
    ...row,
    id: row.id ?? row.patient_id ?? row.patientId ?? null,
    name: row.name ?? row.full_name ?? row.fullName ?? '',
    species: row.species ?? row.species_name ?? row.speciesName ?? '',
    primary_owner: row.primary_owner ?? row.owner_name ?? row.ownerName ?? '',
  }
}

function normalizeVaccine(row) {
  if (!row || typeof row !== 'object') return null
  return {
    ...row,
    id: row.id ?? row.vaccine_id ?? row.vaccineId ?? null,
    name: row.name ?? row.vaccine_name ?? row.vaccineName ?? '',
    manufacturer: row.manufacturer ?? row.brand ?? '',
    next_dose_due: row.next_dose_due ?? row.next_due_date ?? row.nextDoseDue ?? row.nextDueDate ?? null,
    patient_name: row.patient_name ?? row.patient?.name ?? row.patientName ?? '',
    lot_number: row.lot_number ?? row.batch_number ?? row.lotNumber ?? row.batchNumber ?? '',
    expiry_date: row.expiry_date ?? row.expiryDate ?? null,
    dose: row.dose ?? '',
    route: row.route ?? '',
    administration_site: row.administration_site ?? row.administrationSite ?? '',
    medical_record_id: row.medical_record_id ?? row.medicalRecordId ?? null,
  }
}

function normalizeDewProduct(row) {
  if (!row || typeof row !== 'object') return null
  return {
    ...row,
    id: row.id ?? row.product_id ?? row.productId ?? null,
    name: row.name ?? row.product_name ?? row.productName ?? '',
  }
}

function normalizeDewRecord(row) {
  if (!row || typeof row !== 'object') return null
  return {
    ...row,
    id: row.id ?? row.deworming_id ?? row.dewormingId ?? null,
    patient_name: row.patient_name ?? row.patient?.name ?? row.patientName ?? '',
    product_name: row.product_name ?? row.product?.name ?? row.productName ?? '',
    active_ingredient: row.active_ingredient ?? row.activeIngredient ?? '',
    parasite_type: row.parasite_type ?? row.parasiteType ?? '',
    route: row.route ?? '',
    notes: row.notes ?? '',
  }
}

// â”€â”€ Tab principal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const mainTab = ref('vacunas')

// â”€â”€ Helpers compartidos â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function petEmoji(s) {
  if (!s) return '\u{1F43E}'
  const sl = s.toLowerCase()
  const m = {
    perro: '\u{1F436}',
    dog: '\u{1F436}',
    gato: '\u{1F431}',
    cat: '\u{1F431}',
    conejo: '\u{1F430}',
    rabbit: '\u{1F430}',
    loro: '\u{1F99C}',
    bird: '\u{1F99C}',
    pez: '\u{1F41F}',
    fish: '\u{1F41F}',
    tortuga: '\u{1F422}',
    reptile: '\u{1F98E}',
    hamster: '\u{1F439}',
  }
  return m[sl] || '\u{1F43E}'
}

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' })
}

function dueDateClass(dt) {
  if (!dt) return ''
  const days = (new Date(dt) - Date.now()) / (1000 * 60 * 60 * 24)
  if (days < 0)  return 'overdue'
  if (days < 30) return 'due-soon'
  return ''
}

function routeLabel(route) {
  return { oral: 'Oral', topical: 'Tópica', injectable: 'Inyectable', other: 'Otra' }[route] || route || '—'
}

// â”€â”€ Modal compartido â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const showModal = ref(false)
const saving    = ref(false)

function openModal()  {
  if (mainTab.value === 'vacunas') {
    resetForm()
    patientSearch.value = ''
    patientResults.value = []
    selectedPatientLabel.value = ''
  } else {
    resetDewForm()
    dewPatientSearch.value = ''
    dewPatientResults.value = []
    dewSelectedPatientLabel.value = ''
  }
  showModal.value = true
}
function closeModal() { showModal.value = false; resetForm(); resetDewForm() }

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  VACUNAS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const items       = ref([])
const loading     = ref(false)
const error       = ref('')
const search      = ref('')
const statusFilter = ref('')
const pagination  = ref({ page: 1, totalPages: 1 })
const stats       = ref({ upToDate: 0, dueSoon: 0, overdue: 0, total: 0 })
const vaccineList = ref([])

async function loadVaccines() {
  try {
    const { data } = await http.get('/vaccinations/vaccines')
    vaccineList.value = asArray(data?.data || data?.vaccines || data).map(normalizeVaccine).filter(Boolean)
  } catch (error) { logError('vacunas.loadVaccinesCatalog', error); vaccineList.value = [] }
}

function vacStatus(v) {
  if (!v.next_dose_due) return 'badge--neutral'
  const days = (new Date(v.next_dose_due) - Date.now()) / (1000 * 60 * 60 * 24)
  if (days < 0)  return 'badge--red'
  if (days < 30) return 'badge--yellow'
  return 'badge--green'
}

function vacStatusLabel(v) {
  if (!v.next_dose_due) return t('vaccines.applied')
  const days = (new Date(v.next_dose_due) - Date.now()) / (1000 * 60 * 60 * 24)
  if (days < 0)  return t('vaccines.overdue')
  if (days < 30) return t('vaccines.dueSoon')
  return t('vaccines.upToDate')
}

// Patient autocomplete (vacunas)
const patientSearch        = ref('')
const patientResults       = ref([])
const selectedPatientLabel = ref('')
let patientTimer = null

async function searchPatients() {
  clearTimeout(patientTimer)
  form.patientId = ''
  selectedPatientLabel.value = ''
  if (patientSearch.value.length < 2) { patientResults.value = []; return }
  patientTimer = setTimeout(async () => {
    try {
      const { data } = await http.get('/patients', { params: { search: patientSearch.value, limit: 8 } })
      patientResults.value = asArray(data?.data || data?.patients || data).map(normalizePatient).filter(Boolean)
    } catch (error) { logError('vacunas.searchPatients', error, { search: patientSearch.value }); patientResults.value = [] }
  }, 300)
}
function selectPatient(pt) {
  form.patientId = pt.id
  selectedPatientLabel.value = `${pt.name} (${pt.primary_owner || ''})`
  patientSearch.value = pt.name
  patientResults.value = []
}

async function load(page = 1) {
  loading.value = true; error.value = ''
  try {
    const pageSize = 20
    const { data } = await http.get('/vaccinations')
    let rows = asArray(data?.data || data?.vaccinations || data).map(normalizeVaccine).filter(Boolean)
    const needle = search.value.trim().toLowerCase()
    if (needle) {
      rows = rows.filter((row) => [row.patient_name, row.vaccine_name, row.manufacturer]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)));
    }
    if (statusFilter.value) {
      rows = rows.filter((row) => {
        if (statusFilter.value === 'up_to_date') return vacStatus(row) === 'badge--green'
        if (statusFilter.value === 'due_soon') return vacStatus(row) === 'badge--yellow'
        if (statusFilter.value === 'overdue') return vacStatus(row) === 'badge--red'
        return true
      })
    }
    const totalPages = Math.max(1, Math.ceil(rows.length / pageSize))
    const safePage = Math.min(page, totalPages)
    items.value = rows.slice((safePage - 1) * pageSize, safePage * pageSize)
    pagination.value = { page: safePage, totalPages }
    computeStats()
  } catch (e) {
    error.value = e.response?.data?.message || t('vaccines.loadVaccinesError')
  } finally { loading.value = false }
}

function computeStats() {
  const all = items.value
  stats.value.total    = all.length
  stats.value.overdue  = all.filter(v => vacStatus(v) === 'badge--red').length
  stats.value.dueSoon  = all.filter(v => vacStatus(v) === 'badge--yellow').length
  stats.value.upToDate = all.filter(v => vacStatus(v) === 'badge--green').length
}

let timer = null
function debouncedLoad() { clearTimeout(timer); timer = setTimeout(load, 350) }

const saveError = ref('')
const fe        = reactive({})
const form      = reactive({
  patientId:'', vaccineId:'', lotNumber:'', vaccinationDate:'', nextDoseDue:'', notes:'',
  dose:'', expiryDate:'', route:'', administrationSite:'', medicalRecordId:''
})

function resetForm() {
  Object.keys(form).forEach(k => form[k] = '')
  saveError.value = ''; Object.keys(fe).forEach(k => delete fe[k])
}

function validate() {
  Object.keys(fe).forEach(k => delete fe[k])
  if (!form.patientId)       fe.patientId       = t('common.required')
  if (!form.vaccineId)       fe.vaccineId       = t('common.required')
  if (!form.vaccinationDate) fe.vaccinationDate  = t('common.required')
  return Object.keys(fe).length === 0
}

async function handleCreate() {
  if (!validate()) return
  saving.value = true; saveError.value = ''
  try {
    const payload = {
      patientId:       parseInt(form.patientId),
      vaccineId:       parseInt(form.vaccineId),
      vaccinationDate: form.vaccinationDate,
    }
    if (form.lotNumber)   payload.batchNumber = form.lotNumber
    if (form.nextDoseDue) payload.nextDueDate = form.nextDoseDue
    if (form.dose)        payload.dose = form.dose
    if (form.expiryDate)  payload.expiryDate = form.expiryDate
    if (form.route)       payload.route = form.route
    if (form.administrationSite) payload.administrationSite = form.administrationSite
    if (form.medicalRecordId) payload.medicalRecordId = parseInt(form.medicalRecordId)
    if (form.notes)       payload.notes       = form.notes
    await http.post('/vaccinations', payload)
    closeModal(); await load()
  } catch (e) {
    saveError.value = e.response?.data?.message || t('vaccines.createVaccinationError')
  } finally { saving.value = false }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  DESPARASITACIÃ“N
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const dewItems      = ref([])
const dewLoading    = ref(false)
const dewError      = ref('')
const dewSearch     = ref('')
const dewPagination = ref({ page: 1, totalPages: 1 })
const dewProductList = ref([])

async function loadDewProducts() {
  try {
    const { data } = await http.get('/vaccinations/deworming/products')
    dewProductList.value = asArray(data?.data || data?.products || data).map(normalizeDewProduct).filter(Boolean)
  } catch (error) { logError('vacunas.loadDewormingProducts', error); dewProductList.value = [] }
}

async function loadDew(page = 1) {
  dewLoading.value = true; dewError.value = ''
  try {
    const pageSize = 20
    const { data } = await http.get('/vaccinations/deworming')
    const rows = asArray(data?.data || data?.deworming || data).map(normalizeDewRecord).filter(Boolean)
    const needle = dewSearch.value.trim().toLowerCase()
    const filtered = needle
      ? rows.filter((row) => [row.patient_name, row.product_name, row.active_ingredient, row.parasite_type]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle)))
      : rows
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
    const safePage = Math.min(page, totalPages)
    dewItems.value = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)
    dewPagination.value = { page: safePage, totalPages }
  } catch (e) {
    dewError.value = e.response?.data?.message || t('vaccines.loadDewormingError')
  } finally { dewLoading.value = false }
}

let dewTimer = null
function debouncedLoadDew() { clearTimeout(dewTimer); dewTimer = setTimeout(loadDew, 350) }

// Patient autocomplete (deworming)
const dewPatientSearch        = ref('')
const dewPatientResults       = ref([])
const dewSelectedPatientLabel = ref('')
let dewPatientTimer = null

async function searchDewPatients() {
  clearTimeout(dewPatientTimer)
  dewForm.patientId = ''
  dewSelectedPatientLabel.value = ''
  if (dewPatientSearch.value.length < 2) { dewPatientResults.value = []; return }
  dewPatientTimer = setTimeout(async () => {
    try {
      const { data } = await http.get('/patients', { params: { search: dewPatientSearch.value, limit: 8 } })
      dewPatientResults.value = asArray(data?.data || data?.patients || data).map(normalizePatient).filter(Boolean)
    } catch (error) { logError('vacunas.searchDewormingPatients', error, { search: dewPatientSearch.value }); dewPatientResults.value = [] }
  }, 300)
}
function selectDewPatient(pt) {
  dewForm.patientId = pt.id
  dewSelectedPatientLabel.value = `${pt.name} (${pt.primary_owner || ''})`
  dewPatientSearch.value = pt.name
  dewPatientResults.value = []
}

const dewSaveError = ref('')
const dewFe        = reactive({})
const dewForm      = reactive({
  patientId: '', productId: '', dewormingDate: '', nextDueDate: '',
  weightAtTreatment: '', doseAdministered: '', route: '', notes: ''
})

function resetDewForm() {
  Object.keys(dewForm).forEach(k => dewForm[k] = '')
  dewSaveError.value = ''; Object.keys(dewFe).forEach(k => delete dewFe[k])
}

function validateDew() {
  Object.keys(dewFe).forEach(k => delete dewFe[k])
  if (!dewForm.patientId)    dewFe.patientId    = t('common.required')
  if (!dewForm.productId)    dewFe.productId    = t('common.required')
  if (!dewForm.dewormingDate) dewFe.dewormingDate = t('common.required')
  return Object.keys(dewFe).length === 0
}

async function handleCreateDew() {
  if (!validateDew()) return
  saving.value = true; dewSaveError.value = ''
  try {
    const payload = {
      patientId:    parseInt(dewForm.patientId),
      productId:    parseInt(dewForm.productId),
      dewormingDate: dewForm.dewormingDate,
    }
    if (dewForm.weightAtTreatment) payload.weightAtTreatment = parseFloat(dewForm.weightAtTreatment)
    if (dewForm.doseAdministered)  payload.doseAdministered  = dewForm.doseAdministered
    if (dewForm.route)             payload.route             = dewForm.route
    if (dewForm.nextDueDate)       payload.nextDueDate       = dewForm.nextDueDate
    if (dewForm.notes)             payload.notes             = dewForm.notes
    await http.post('/vaccinations/deworming', payload)
    closeModal(); await loadDew()
  } catch (e) {
    dewSaveError.value = e.response?.data?.message || t('vaccines.createDewormingError')
  } finally { saving.value = false }
}

// â”€â”€ InicializaciÃ³n â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
onMounted(() => {
  load()
  loadVaccines()
  loadDew()
  loadDewProducts()
})

onUnmounted(() => {
  clearTimeout(timer)
  clearTimeout(dewTimer)
  clearTimeout(patientTimer)
  clearTimeout(dewPatientTimer)
})
</script>

<style scoped>
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
.page { display: flex; flex-direction: column; gap: 20px; }
.page-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
.page-header__left { display: flex; align-items: center; gap: 14px; }
.page-emoji { font-size: 2rem; }
.page-title { font-size: 1.35rem; font-weight: 700; color: var(--text); }
.page-sub   { font-size: 0.82rem; color: var(--text-2); margin-top: 2px; }

/* Tabs principales */
.main-tabs { display: flex; border-bottom: 2px solid var(--border); gap: 0; }
.main-tab-btn { padding: 10px 22px; background: none; border: none; border-bottom: 2px solid transparent; margin-bottom: -2px; cursor: pointer; font-size: 0.9rem; font-weight: 500; color: var(--text-3); transition: color 0.15s, border-color 0.15s; white-space: nowrap; }
.main-tab-btn:hover { color: var(--text); }
.main-tab-btn--active { color: var(--primary); border-bottom-color: var(--primary); font-weight: 700; }

/* Stats */
.stats-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
.stat-card { background: var(--c); border-radius: var(--radius-lg); padding: 16px; display: flex; align-items: center; gap: 12px; }
.stat-card__icon { font-size: 1.6rem; }
.stat-card strong { display: block; font-size: 1.4rem; font-weight: 700; color: var(--ct); }
.stat-card span   { font-size: 0.75rem; color: var(--ct); opacity: 0.8; }

.filters { display: flex; gap: 10px; flex-wrap: wrap; }
.filter-input, .filter-select { padding: 9px 13px; border: 1.5px solid var(--border); border-radius: var(--radius); font-size: 0.87rem; background: var(--white); color: var(--text); outline: none; }
.filter-input:focus, .filter-select:focus { border-color: var(--primary); }
.filter-input--grow { flex: 1; min-width: 200px; }

/* Tabla */
.card { background: var(--white); border-radius: var(--radius-xl); box-shadow: var(--shadow); overflow: hidden; }
.table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
.table th { text-align: left; padding: 12px 14px; font-size: 0.78rem; font-weight: 600; color: var(--text-3); letter-spacing: 0.05em; text-transform: uppercase; background: var(--surface); border-bottom: 1px solid var(--border); }
.table td { padding: 12px 14px; border-bottom: 1px solid #f0f0f0; color: var(--text); vertical-align: middle; }
.table tr:last-child td { border-bottom: none; }
.table tr:hover td { background: var(--surface); }

.pet-cell { display: flex; align-items: center; gap: 8px; font-size: 1.2rem; }
.pet-cell strong { display: block; font-size: 0.9rem; }
.sub { display: block; font-size: 0.75rem; color: var(--text-3); }
.overdue  { color: #c0392b; font-weight: 600; }
.due-soon { color: #d68910; font-weight: 600; }

/* Badges */
.badge { display: inline-block; padding: 3px 9px; border-radius: 20px; font-size: 0.72rem; font-weight: 600; }
.badge--green   { background: #D6F3EC; color: #1A9E7F; }
.badge--yellow  { background: #FFF3CC; color: #8A6200; }
.badge--red     { background: #FDEAEA; color: #c0392b; }
.badge--neutral { background: var(--surface-2); color: var(--text-3); }

/* PaginaciÃ³n */
.pagination { display: flex; align-items: center; justify-content: center; gap: 16px; font-size: 0.85rem; color: var(--text-2); }
.pagination button { padding: 6px 14px; border: 1.5px solid var(--border); border-radius: var(--radius-sm); background: none; cursor: pointer; font-size: 0.82rem; color: var(--text-2); }
.pagination button:hover:not(:disabled) { background: var(--surface-2); }
.pagination button:disabled { opacity: 0.4; cursor: not-allowed; }

.btn-primary { padding: 10px 20px; background: linear-gradient(135deg, var(--primary) 0%, var(--accent-mint) 100%); color: white; border: none; border-radius: var(--radius); font-size: 0.9rem; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: opacity var(--transition), transform var(--transition); }
.btn-primary:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
.btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
.btn-ghost { padding: 10px 20px; background: none; border: 1.5px solid var(--border); border-radius: var(--radius); color: var(--text-2); font-size: 0.9rem; font-weight: 500; cursor: pointer; transition: background var(--transition); }
.btn-ghost:hover:not(:disabled) { background: var(--surface-2); }

.modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 16px; }
.modal { background: var(--white); border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); width: 100%; max-width: 540px; max-height: 92vh; overflow-y: auto; }
.modal__header { display: flex; align-items: center; justify-content: space-between; padding: 20px 24px 16px; border-bottom: 1px solid var(--border); }
.modal__header h3 { font-size: 1.1rem; font-weight: 700; color: var(--text); }
.modal__close { background: none; border: none; cursor: pointer; font-size: 1rem; color: var(--text-3); padding: 4px 8px; border-radius: var(--radius-sm); }
.modal__close:hover { background: var(--surface-2); }
.form-body { padding: 20px 24px 0; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.field { display: flex; flex-direction: column; gap: 5px; position: relative; }
.field label { font-size: 0.82rem; font-weight: 600; color: var(--text-2); }
.field input, .field select, .field textarea { padding: 9px 12px; border: 1.5px solid var(--border); border-radius: var(--radius); font-size: 0.9rem; color: var(--text); background: var(--surface); outline: none; transition: border-color var(--transition); }
.field input:focus, .field select:focus, .field textarea:focus { border-color: var(--primary); }
.field textarea { resize: vertical; }
.field--full { grid-column: 1 / -1; }
.field-error { font-size: 0.75rem; color: var(--danger); }
.req { color: var(--danger); }
.modal__actions { display: flex; gap: 12px; justify-content: flex-end; padding: 16px 24px 24px; }
.alert { padding: 10px 14px; border-radius: var(--radius-sm); font-size: 0.875rem; }
.alert--error { background: #FDEAEA; color: #c0392b; border-left: 3px solid var(--danger); }
.mx { margin: 0 24px 8px; }
.loading-state, .empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 60px 20px; color: var(--text-3); font-size: 0.9rem; background: var(--white); border-radius: var(--radius-xl); box-shadow: var(--shadow-sm); }
.empty-state__emoji { font-size: 3rem; }
.spin { width: 20px; height: 20px; border: 2px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: spin 0.7s linear infinite; display: inline-block; }
.spin--sm { width: 14px; height: 14px; }
.spin--dark { border-color: rgba(0,0,0,0.1); border-top-color: var(--primary); }
@keyframes spin { to { transform: rotate(360deg); } }
.modal-enter-active, .modal-leave-active { transition: opacity 0.2s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
@media (max-width: 600px) { .form-grid { grid-template-columns: 1fr; } .table th:nth-child(5), .table td:nth-child(5) { display: none; } }
.autocomplete { position: absolute; z-index: 100; background: var(--white); border: 1.5px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); width: 100%; max-height: 200px; overflow-y: auto; top: 100%; left: 0; }
.autocomplete__item { padding: 9px 13px; cursor: pointer; font-size: 0.88rem; }
.autocomplete__item:hover { background: var(--surface-2); }
.autocomplete__owner { font-size: 0.78rem; color: var(--text-3); }
.selected-patient { margin-top: 6px; font-size: 0.82rem; color: var(--primary); font-weight: 500; }
</style>
