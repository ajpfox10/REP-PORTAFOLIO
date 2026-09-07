<template>
  <div class="page">

    <div class="page-header">
      <div class="page-header__left">
        <span class="page-emoji">🏥</span>
        <div>
          <h2 class="page-title">{{ t('hospitalizations.title') }}</h2>
          <p class="page-sub">{{ t('hospitalizations.subtitle') }}</p>
        </div>
      </div>
      <BaseButton type="button" @click="openAdmit()">{{ t('hospitalizations.newAdmission') }}</BaseButton>
    </div>

    <!-- Stats -->
    <div class="stats-row">
      <div class="stat-card" style="--c:#D6EEFF;--ct:#1A5FAA">
        <span class="stat-card__icon">🛏️</span>
        <div>
          <strong>{{ stats.active }}</strong>
          <span>{{ t('hospitalizations.activeHospitalized') }}</span>
        </div>
      </div>
      <div class="stat-card" style="--c:#D6F3EC;--ct:#1A9E7F">
        <span class="stat-card__icon">🚪</span>
        <div>
          <strong>{{ stats.dischargedToday }}</strong>
          <span>{{ t('hospitalizations.dischargeToday') }}</span>
        </div>
      </div>
      <div class="stat-card" style="--c:#FFF3CC;--ct:#8A6200">
        <span class="stat-card__icon">📅</span>
        <div>
          <strong>{{ stats.avgDays }}</strong>
          <span>{{ t('hospitalizations.averageDays') }}</span>
        </div>
      </div>
    </div>

    <!-- Toggle de vista -->
    <div class="view-toggle">
      <button type="button" :class="['toggle-btn', { 'toggle-btn--active': viewMode === 'list' }]" @click="viewMode = 'list'">
        ☰ {{ t('hospitalizations.listView') }}
      </button>
      <button type="button" :class="['toggle-btn', { 'toggle-btn--active': viewMode === 'board' }]" @click="switchToBoard()">
        🏠 {{ t('hospitalizations.boardView') }}
      </button>
    </div>

    <!-- ── VISTA LISTA ── -->
    <template v-if="viewMode === 'list'">
      <div class="filters">
        <label for="hosp-search" class="sr-only">{{ t('hospitalizations.searchPlaceholder') }}</label>
        <input
          id="hosp-search"
          name="hosp-search"
          v-model.trim="search"
          type="search"
          :placeholder="t('hospitalizations.searchPlaceholder')"
          class="filter-input filter-input--grow"
          @input="debouncedLoad()"
        />
        <label for="hosp-status" class="sr-only">{{ t('common.allStatuses') }}</label>
        <select id="hosp-status" name="hosp-status" v-model="statusFilter" class="filter-select" @change="load()">
          <option value="">{{ t('common.allStatuses') }}</option>
          <option value="admitted">{{ t('hospitalizations.admittedStatus') }}</option>
          <option value="discharged">{{ t('hospitalizations.dischargedStatus') }}</option>
          <option value="transferred">{{ t('hospitalizations.transferredStatus') }}</option>
        </select>
      </div>

      <div v-if="loading" class="loading-state" role="status" aria-live="polite">
        <span class="spin spin--dark" /> {{ t('hospitalizations.loading') }}</div>
      <div v-else-if="error" class="alert alert--error" role="alert">{{ error }}</div>
      <div v-else-if="items.length === 0" class="empty-state">
        <span class="empty-state__emoji">🏥</span>
        <p>{{ t('hospitalizations.empty') }}</p>
      </div>

      <div v-else class="card">
        <table class="table">
          <thead>
            <tr>
              <th>{{ t('hospitalizations.patient') }}</th>
              <th>{{ t('hospitalizations.wardKennel') }}</th>
              <th>{{ t('hospitalizations.veterinarian') }}</th>
              <th>{{ t('hospitalizations.admission') }}</th>
              <th>{{ t('hospitalizations.days') }}</th>
              <th>Clinica</th>
              <th>{{ t('hospitalizations.status') }}</th>
              <th>{{ t('hospitalizations.actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="h in items" :key="h.id">
              <td>
                <div class="pet-cell">
                  <span>{{ petEmoji(h.species) }}</span>
                  <div>
                    <strong>{{ h.patient_name || '—' }}</strong>
                    <span class="sub">{{ h.admission_reason || '' }}</span>
                  </div>
                </div>
              </td>
              <td>
                <strong class="ward-name">{{ h.ward_name || '—' }}</strong>
                <span v-if="h.kennel_number" class="sub">{{ t('hospitalizations.kennelLabel') }} {{ h.kennel_number }}</span>
              </td>
              <td class="sub">{{ h.attending_vet_name || '—' }}</td>
              <td class="sub">{{ formatDate(h.admission_date) }}</td>
              <td>
                <span class="days-badge">{{ h.days_hospitalized ?? '—' }} d</span>
              </td>
              <td class="sub">
                <span v-if="h.estimated_discharge_date">Alta {{ formatDate(h.estimated_discharge_date) }}</span>
                <span v-if="h.last_temp"> · {{ h.last_temp }} °C</span>
                <span v-if="h.last_hr"> · {{ h.last_hr }} lpm</span>
              </td>
              <td>
                <span class="badge" :class="hospStatusClass(h.status)">{{ hospStatusLabel(h.status) }}</span>
              </td>
              <td>
                <div class="action-btns">
                  <button
                    class="btn-action btn-action--primary"
                    @click="openHospDetail(h)"
                    :title="t('hospitalizations.viewAdmission')"
                  >
                    {{ t('common.view') }}
                  </button>
                  <button
                    v-if="h.status === 'admitted'"
                    class="btn-action btn-action--danger"
                    @click="openDischarge(h)"
                    :title="t('hospitalizations.discharge')"
                    >
                    {{ t('hospitalizations.discharge') }}
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="pagination.totalPages > 1" class="pagination">
        <button type="button" :disabled="pagination.page <= 1" @click="load(pagination.page - 1)">{{ t('common.previous') }}</button>
        <span>{{ pagination.page }} / {{ pagination.totalPages }}</span>
        <button type="button" :disabled="pagination.page >= pagination.totalPages" @click="load(pagination.page + 1)">{{ t('common.next') }}</button>
      </div>
    </template>

    <!-- ── VISTA TABLERO ── -->
    <template v-else>
      <div v-if="boardLoading" class="loading-state" role="status" aria-live="polite">
        <span class="spin spin--dark" /> {{ t('hospitalizations.boardLoading') }}</div>
      <div v-else-if="boardError" class="alert alert--error" role="alert">{{ boardError }}</div>
      <div v-else-if="boardData.length === 0" class="empty-state">
        <span class="empty-state__emoji">🏠</span>
        <p>{{ t('hospitalizations.boardEmpty') }}</p>
      </div>
      <div v-else class="board">
        <div v-for="ward in boardData" :key="ward.id || ward.ward_name" class="ward-card">
          <div class="ward-card__header">
            <div>
              <h3 class="ward-card__name">{{ ward.ward_name || ward.name }}</h3>
              <span class="sub">{{ ward.ward_type || '' }}</span>
            </div>
            <div class="ward-card__summary">
              <span class="badge badge--green">{{ ward.available_kennels ?? '?' }} {{ t('hospitalizations.free') }}</span>
              <span class="badge badge--red">{{ (ward.total_kennels - ward.available_kennels) ?? '?' }} {{ t('hospitalizations.occupied') }}</span>
            </div>
          </div>
          <div class="kennel-grid">
            <div
              v-for="kennel in (ward.kennels || [])"
              :key="kennel.id"
              :class="['kennel-chip', kennel.status === 'occupied' ? 'kennel-chip--occupied' : 'kennel-chip--free']"
              :title="kennel.status === 'occupied' ? t('hospitalizations.occupied') : t('hospitalizations.free')"
            >
              {{ kennel.number }}
              <span v-if="kennel.kennel_type" class="kennel-type">{{ kennel.kennel_type }}</span>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- ══════════════════ MODAL ADMITIR ══════════════════ -->
    <Transition name="modal">
      <div v-if="showAdmit" class="modal-backdrop" @click.self="showAdmit = false">
        <div class="modal modal--wide">
          <div class="modal__header">
            <h3>🏥 {{ t('hospitalizations.admitTitle') }}</h3>
            <button type="button" class="modal__close" :aria-label="t('common.close')" @click="showAdmit = false">×</button>
          </div>

          <form @submit.prevent="handleAdmit" novalidate>
            <div class="form-body">

              <!-- Paciente autocomplete -->
              <div class="field field--full" style="position:relative">
                <label for="hosp-m-patient">{{ t('hospitalizations.patientLabel') }} <span class="req">*</span></label>
                <input
                  id="hosp-m-patient"
                  name="hosp-m-patient"
                  v-model.trim="patientSearch"
                  type="search"
                  :placeholder="t('hospitalizations.patientSearchPlaceholder')"
                  :disabled="admitSaving"
                  @input="searchPatients"
                  autocomplete="off"
                />
                <div v-if="patientResults.length" class="autocomplete" role="listbox" :aria-label="t('hospitalizations.searchByName')">
                    <button v-for="pt in patientResults" :key="pt.id" type="button" class="autocomplete__item" role="option" :aria-label="`${t('common.selectPatient')} ${pt.name}`" @click="selectPatient(pt)">
                    {{ petEmoji(pt.species) }} <b>{{ pt.name }}</b>
                    <span v-if="pt.hc_number" class="autocomplete__owner"> · HC {{ pt.hc_number }}</span>
                    <span class="autocomplete__owner">— {{ pt.primary_owner || '' }}</span>
                  </button>
                </div>
                <div v-if="admitForm.patientId" class="selected-patient">✅ {{ selectedPatientLabel }}</div>
                <span v-if="afe.patientId" class="field-error">{{ afe.patientId }}</span>
              </div>

              <!-- Sala y jaula -->
              <div class="form-grid">
                <div class="field">
                  <label for="hosp-m-ward">{{ t('hospitalizations.wardLabel') }} <span class="req">*</span></label>
                  <select id="hosp-m-ward" name="hosp-m-ward" v-model="admitForm.wardId" :disabled="admitSaving || wardsLoading" @change="admitForm.kennelId = ''">
                    <option value="">{{ wardsLoading ? t('hospitalizations.wardLoading') : t('hospitalizations.wardPlaceholder') }}</option>
                    <option v-for="w in availableWards" :key="w.id" :value="w.id">
                      {{ w.name }} ({{ w.available_kennels }} {{ t('hospitalizations.free') }})
                    </option>
                  </select>
                  <span v-if="afe.wardId" class="field-error">{{ afe.wardId }}</span>
                </div>

                <div class="field">
                  <label for="hosp-m-kennel">{{ t('hospitalizations.kennelLabel') }}</label>
                  <select id="hosp-m-kennel" name="hosp-m-kennel" v-model="admitForm.kennelId" :disabled="admitSaving || !admitForm.wardId">
                    <option value="">{{ t('hospitalizations.noKennel') }}</option>
                    <option
                      v-for="k in freeKennelsForWard"
                      :key="k.id"
                      :value="k.id"
                    >
                      Jaula {{ k.number }}{{ k.kennel_type ? ' (' + k.kennel_type + ')' : '' }}
                    </option>
                  </select>
                </div>

                <div class="field field--full">
                  <label for="hosp-m-vet">{{ t('hospitalizations.vetInCharge') }} <span class="req">*</span></label>
                  <input
                    id="hosp-m-vet"
                    name="hosp-m-vet"
                    v-model.trim="admitForm.attendingVetId"
                    type="text"
                    placeholder="ID del veterinario responsable…"
                    :disabled="admitSaving"
                  />
                  <span v-if="afe.attendingVetId" class="field-error">{{ afe.attendingVetId }}</span>
                </div>

                <div class="field field--full">
                  <label for="hosp-m-reason">{{ t('hospitalizations.admissionReason') }} <span class="req">*</span></label>
                  <textarea
                    id="hosp-m-reason"
                    name="hosp-m-reason"
                    v-model.trim="admitForm.admissionReason"
                    rows="3"
                    :placeholder="t('hospitalizations.admissionReasonPlaceholder')"
                    :disabled="admitSaving"
                  />
                  <span v-if="afe.admissionReason" class="field-error">{{ afe.admissionReason }}</span>
                </div>
                <div class="field">
                  <label for="hosp-m-weight">Peso ingreso</label>
                  <input id="hosp-m-weight" name="hosp-m-weight" v-model.number="admitForm.admissionWeight" type="number" min="0" step="0.01" placeholder="ej: 12.4" :disabled="admitSaving" />
                </div>
                <div class="field">
                  <label for="hosp-m-discharge-est">Alta estimada</label>
                  <input id="hosp-m-discharge-est" name="hosp-m-discharge-est" v-model="admitForm.estimatedDischargeDate" type="date" :disabled="admitSaving" />
                </div>
                <div class="field field--full">
                  <label for="hosp-m-diag">Diagnostico de ingreso</label>
                  <textarea id="hosp-m-diag" name="hosp-m-diag" v-model.trim="admitForm.admissionDiagnosis" rows="2" placeholder="Diagnostico inicial" :disabled="admitSaving" />
                </div>
                <div class="field field--full">
                  <label for="hosp-m-instructions">Indicaciones especiales</label>
                  <textarea id="hosp-m-instructions" name="hosp-m-instructions" v-model.trim="admitForm.specialInstructions" rows="2" placeholder="Cuidados, aislamiento, dieta..." :disabled="admitSaving" />
                </div>
              </div>

            </div>

            <div v-if="admitError" class="alert alert--error mx">{{ admitError }}</div>

            <div class="modal__actions">
              <BaseButton type="button" variant="ghost" @click="showAdmit = false" :disabled="admitSaving">{{ t('common.cancel') }}</BaseButton>
              <button type="submit" class="btn-primary" :disabled="admitSaving">
                <span v-if="admitSaving" class="spin spin--sm" />
                <span v-else>🏥 {{ t('hospitalizations.admit') }}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </Transition>

    <!-- ══════════════════ MODAL VER INTERNACIÓN ══════════════════ -->
    <Transition name="modal">
      <div v-if="showDetail" class="modal-backdrop" @click.self="showDetail = false">
        <div class="modal modal--wide">
          <div class="modal__header">
            <h3>🏥 {{ t('hospitalizations.detailTitle') }} — {{ detailData?.patient_name }}</h3>
            <button type="button" class="modal__close" @click="showDetail = false">✕</button>
          </div>

          <div v-if="detailLoading" class="loading-state" style="min-height:200px" role="status" aria-live="polite">
            <span class="spin spin--dark" /> {{ t('hospitalizations.loadingDetail') }}
          </div>
          <template v-else-if="detailData">
            <!-- Info general -->
            <div class="form-body" style="padding-bottom:0">
              <div class="detail-grid">
                <div class="detail-item">
                  <span class="detail-label">{{ t('hospitalizations.wardKennelDetail') }}</span>
                  <span>{{ detailData.ward_name || '—' }}{{ detailData.kennel_number ? ' · ' + t('hospitalizations.kennelLabel') + ' ' + detailData.kennel_number : '' }}</span>
                </div>
                <div class="detail-item">
                  <span class="detail-label">{{ t('hospitalizations.vetLabel') }}</span>
                  <span>{{ detailData.attending_vet_name || '—' }}</span>
                </div>
                <div class="detail-item">
                  <span class="detail-label">{{ t('hospitalizations.admissionDate') }}</span>
                  <span>{{ formatDate(detailData.admission_date) }}</span>
                </div>
                <div class="detail-item">
                  <span class="detail-label">{{ t('hospitalizations.daysHospitalized') }}</span>
                  <span>{{ detailData.days_hospitalized ?? '—' }}</span>
                </div>
                <div v-if="detailData.estimated_discharge_date" class="detail-item">
                  <span class="detail-label">Alta estimada</span>
                  <span>{{ formatDate(detailData.estimated_discharge_date) }}</span>
                </div>
                <div v-if="detailData.last_temp || detailData.last_hr" class="detail-item">
                  <span class="detail-label">Ultimos controles</span>
                  <span>{{ detailData.last_temp ? detailData.last_temp + ' °C' : '—' }}{{ detailData.last_hr ? ' · ' + detailData.last_hr + ' lpm' : '' }}</span>
                </div>
                <div class="detail-item detail-item--full">
                  <span class="detail-label">{{ t('hospitalizations.reason') }}</span>
                  <span>{{ detailData.admission_reason || '—' }}</span>
                </div>
                <div v-if="detailData.admission_diagnosis" class="detail-item detail-item--full">
                  <span class="detail-label">Diagnostico de ingreso</span>
                  <span>{{ detailData.admission_diagnosis }}</span>
                </div>
                <div v-if="detailData.admission_weight" class="detail-item">
                  <span class="detail-label">Peso ingreso</span>
                  <span>{{ detailData.admission_weight }} kg</span>
                </div>
                <div v-if="detailData.medical_record_id" class="detail-item">
                  <span class="detail-label">Ficha medica</span>
                  <span>#{{ detailData.medical_record_id }}</span>
                </div>
                <div v-if="detailData.special_instructions" class="detail-item detail-item--full">
                  <span class="detail-label">Indicaciones especiales</span>
                  <span>{{ detailData.special_instructions }}</span>
                </div>
              </div>
            </div>

            <!-- Tabs -->
            <div class="tabs">
              <button type="button" :class="['tab', { 'tab--active': detailTab === 'monitoring' }]" @click="detailTab = 'monitoring'">
                📊 {{ t('hospitalizations.monitoringLabel') }}
              </button>
              <button type="button" :class="['tab', { 'tab--active': detailTab === 'medications' }]" @click="detailTab = 'medications'">
                💊 {{ t('hospitalizations.medicationsLabel') }}
              </button>
            </div>

            <!-- Tab monitoreo -->
            <div v-if="detailTab === 'monitoring'" class="tab-content">
              <!-- Lista de signos -->
              <div v-if="detailData.monitoring && detailData.monitoring.length" class="monitoring-list">
                <div v-for="(m, i) in detailData.monitoring" :key="i" class="monitoring-record">
                  <div class="monitoring-record__time sub">{{ formatDate(m.recorded_at || m.created_at) }}</div>
                  <div class="monitoring-chips">
                    <span v-if="m.heart_rate" class="mon-chip">❤️ {{ m.heart_rate }} lpm</span>
                    <span v-if="m.respiratory_rate" class="mon-chip">🫁 {{ m.respiratory_rate }} rpm</span>
                    <span v-if="m.temperature" class="mon-chip">🌡️ {{ m.temperature }}°C</span>
                    <span v-if="m.systolic_bp" class="mon-chip">🩺 {{ m.systolic_bp }} mmHg</span>
                    <span v-if="m.mucous_membranes" class="mon-chip">{{ m.mucous_membranes }}</span>
                    <span v-if="m.hydration_status" class="mon-chip">💧 {{ m.hydration_status }}</span>
                    <span v-if="m.consciousness_level" class="mon-chip" :class="consciousnessClass(m.consciousness_level)">
                      {{ consciousnessLabel(m.consciousness_level) }}
                    </span>
                  </div>
                  <p v-if="m.notes" class="sub" style="margin-top:4px">{{ m.notes }}</p>
                </div>
              </div>
              <div v-else class="empty-inline">{{ t('hospitalizations.noMonitoringRecords') }}</div>

              <!-- Formulario nuevo monitoreo -->
              <div class="inline-form">
                <div class="section-title" style="margin-bottom:12px">{{ t('hospitalizations.vitalSignsLabel') }}</div>
                <div class="form-grid">
                  <div class="field">
                    <label for="hosp-mon-hr">{{ t('hospitalizations.heartRate') }}</label>
                    <input id="hosp-mon-hr" name="hosp-mon-hr" v-model.number="monForm.heartRate" type="number" min="0" max="400" placeholder="80" :disabled="monSaving" />
                  </div>
                  <div class="field">
                    <label for="hosp-mon-rr">{{ t('hospitalizations.respiratoryRate') }}</label>
                    <input id="hosp-mon-rr" name="hosp-mon-rr" v-model.number="monForm.respiratoryRate" type="number" min="0" max="200" placeholder="20" :disabled="monSaving" />
                  </div>
                  <div class="field">
                    <label for="hosp-mon-temp">{{ t('hospitalizations.temperature') }}</label>
                    <input id="hosp-mon-temp" name="hosp-mon-temp" v-model.number="monForm.temperature" type="number" step="0.1" min="30" max="45" placeholder="38.5" :disabled="monSaving" />
                  </div>
                  <div class="field">
                    <label for="hosp-mon-bp">{{ t('hospitalizations.systolicBp') }}</label>
                    <input id="hosp-mon-bp" name="hosp-mon-bp" v-model.number="monForm.systolicBp" type="number" min="0" max="300" placeholder="120" :disabled="monSaving" />
                  </div>
                  <div class="field">
                    <label for="hosp-mon-mucous">{{ t('hospitalizations.mucousMembranes') }}</label>
                    <input id="hosp-mon-mucous" name="hosp-mon-mucous" v-model.trim="monForm.mucousMembranes" type="text" placeholder="Rosadas, húmedas…" :disabled="monSaving" />
                  </div>
                  <div class="field">
                    <label for="hosp-mon-hydration">{{ t('hospitalizations.hydrationStatus') }}</label>
                    <input id="hosp-mon-hydration" name="hosp-mon-hydration" v-model.trim="monForm.hydrationStatus" type="text" placeholder="Normotenso, deshidratado…" :disabled="monSaving" />
                  </div>
                  <div class="field">
                    <label for="hosp-mon-consciousness">{{ t('hospitalizations.consciousnessLevel') }}</label>
                    <select id="hosp-mon-consciousness" name="hosp-mon-consciousness" v-model="monForm.consciousnessLevel" :disabled="monSaving">
                      <option value="">— {{ t('common.none') }} —</option>
                      <option value="alert">{{ t('hospitalizations.consciousnessAlert') }}</option>
                      <option value="lethargic">{{ t('hospitalizations.consciousnessLethargic') }}</option>
                      <option value="stupor">{{ t('hospitalizations.consciousnessStupor') }}</option>
                      <option value="coma">{{ t('hospitalizations.consciousnessComa') }}</option>
                    </select>
                  </div>
                  <div class="field field--full">
                    <label for="hosp-mon-notes">{{ t('hospitalizations.notes') }}</label>
                    <textarea id="hosp-mon-notes" name="hosp-mon-notes" v-model.trim="monForm.notes" rows="2" :placeholder="t('common.notes')" :disabled="monSaving" />
                  </div>
                </div>
                <div v-if="monError" class="alert alert--error" style="margin-top:8px" role="alert">{{ monError }}</div>
                <div style="margin-top:10px;display:flex;justify-content:flex-end">
                  <BaseButton type="button" style="padding:8px 18px;font-size:0.85rem" @click="handleMonitoring" :disabled="monSaving">
                    <span v-if="monSaving" class="spin spin--sm" />
                    <span v-else>💾 {{ t('hospitalizations.saveMonitoring') }}</span>
                  </BaseButton>
                </div>
              </div>
            </div>

            <!-- Tab medicamentos -->
            <div v-if="detailTab === 'medications'" class="tab-content">
              <!-- Lista -->
              <div v-if="detailData.medications && detailData.medications.length" class="med-list">
                <div v-for="(med, i) in detailData.medications" :key="i" class="med-record">
                  <div class="med-record__header">
                    <strong>{{ med.medication_name }}</strong>
                    <span class="badge badge--blue">{{ med.route }}</span>
                    <span class="sub">Cada {{ med.frequency }}</span>
                  </div>
                  <div class="sub">{{ med.dose }} {{ med.dose_unit }}{{ med.duration_hours ? ' · ' + med.duration_hours + 'h' : '' }}</div>
                  <p v-if="med.notes" class="sub" style="margin-top:3px">{{ med.notes }}</p>
                </div>
              </div>
              <div v-else class="empty-inline">{{ t('hospitalizations.noMedicationRecords') }}</div>

              <!-- Formulario nuevo medicamento -->
              <div class="inline-form">
                <div class="section-title" style="margin-bottom:12px">{{ t('hospitalizations.prescribeMedication') }}</div>
                <div class="form-grid">
                  <div class="field field--full">
                    <label for="hosp-med-name">{{ t('hospitalizations.medication') }} <span class="req">*</span></label>
                    <input id="hosp-med-name" name="hosp-med-name" v-model.trim="medForm.medicationName" type="text" :placeholder="t('common.name')" :disabled="medSaving" />
                    <span v-if="mfe.medicationName" class="field-error">{{ mfe.medicationName }}</span>
                  </div>
                  <div class="field">
                    <label for="hosp-med-dose">{{ t('hospitalizations.dose') }} <span class="req">*</span></label>
                    <input id="hosp-med-dose" name="hosp-med-dose" v-model.trim="medForm.dose" type="text" :placeholder="t('hospitalizations.dose')" :disabled="medSaving" />
                    <span v-if="mfe.dose" class="field-error">{{ mfe.dose }}</span>
                  </div>
                  <div class="field">
                    <label for="hosp-med-unit">{{ t('hospitalizations.unit') }}</label>
                    <input id="hosp-med-unit" name="hosp-med-unit" v-model.trim="medForm.doseUnit" type="text" :placeholder="t('hospitalizations.unit')" :disabled="medSaving" />
                  </div>
                  <div class="field">
                    <label for="hosp-med-frequency">{{ t('hospitalizations.frequency') }} <span class="req">*</span></label>
                    <input id="hosp-med-frequency" name="hosp-med-frequency" v-model.trim="medForm.frequency" type="text" :placeholder="t('hospitalizations.frequency')" :disabled="medSaving" />
                    <span v-if="mfe.frequency" class="field-error">{{ mfe.frequency }}</span>
                  </div>
                  <div class="field">
                    <label for="hosp-med-route">{{ t('hospitalizations.route') }} <span class="req">*</span></label>
                    <select id="hosp-med-route" name="hosp-med-route" v-model="medForm.route" :disabled="medSaving">
                      <option value="">{{ t('common.choose') }}</option>
                      <option value="oral">Oral</option>
                      <option value="iv">IV</option>
                      <option value="im">IM</option>
                      <option value="sc">SC</option>
                      <option value="topical">Tópica</option>
                      <option value="other">{{ t('common.other') }}</option>
                    </select>
                    <span v-if="mfe.route" class="field-error">{{ mfe.route }}</span>
                  </div>
                  <div class="field">
                    <label for="hosp-med-start">{{ t('hospitalizations.start') }} <span class="req">*</span></label>
                    <input id="hosp-med-start" name="hosp-med-start" v-model="medForm.startDatetime" type="datetime-local" :disabled="medSaving" />
                    <span v-if="mfe.startDatetime" class="field-error">{{ mfe.startDatetime }}</span>
                  </div>
                  <div class="field">
                    <label for="hosp-med-duration">{{ t('hospitalizations.durationHours') }}</label>
                    <input id="hosp-med-duration" name="hosp-med-duration" v-model.number="medForm.durationHours" type="number" min="1" :placeholder="t('hospitalizations.durationHours')" :disabled="medSaving" />
                  </div>
                  <div class="field field--full">
                    <label for="hosp-med-notes">{{ t('hospitalizations.notes') }}</label>
                    <textarea id="hosp-med-notes" name="hosp-med-notes" v-model.trim="medForm.notes" rows="2" :placeholder="t('common.notes')" :disabled="medSaving" />
                  </div>
                </div>
                <div v-if="medError" class="alert alert--error" style="margin-top:8px" role="alert">{{ medError }}</div>
                <div style="margin-top:10px;display:flex;justify-content:flex-end">
                  <BaseButton type="button" style="padding:8px 18px;font-size:0.85rem" @click="handleMedication" :disabled="medSaving">
                    <span v-if="medSaving" class="spin spin--sm" />
                    <span v-else>💊 {{ t('hospitalizations.prescribe') }}</span>
                  </BaseButton>
                </div>
              </div>
            </div>
          </template>

          <div class="modal__actions">
              <BaseButton
                v-if="detailData?.status === 'admitted'"
                variant="danger"
                @click="openDischarge(detailData); showDetail = false"
              >
                🚪 {{ t('hospitalizations.discharge') }}
              </BaseButton>
            <BaseButton type="button" variant="ghost" @click="showDetail = false">{{ t('common.close') }}</BaseButton>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ══════════════════ MODAL DAR ALTA ══════════════════ -->
    <Transition name="modal">
      <div v-if="showDischarge" class="modal-backdrop" @click.self="showDischarge = false">
        <div class="modal modal--sm">
          <div class="modal__header">
            <h3>🚪 {{ t('hospitalizations.dischargeTitle') }} — {{ dischargeTarget?.patient_name }}</h3>
            <BaseButton type="button" variant="ghost" class="modal__close" @click="showDischarge = false">✕</BaseButton>
          </div>
          <form @submit.prevent="handleDischarge" novalidate>
            <div class="form-body">
              <div class="discharge-confirm">
                <p>{{ t('hospitalizations.dischargeConfirm', { patient: dischargeTarget?.patient_name || '' }) }}</p>
              </div>
              <div class="field field--full">
                <label for="hosp-dis-notes">{{ t('hospitalizations.dischargeNotes') }}</label>
                <textarea
                  id="hosp-dis-notes"
                  name="hosp-dis-notes"
                  v-model.trim="dischargeForm.dischargeNotes"
                  rows="3"
                  :placeholder="t('common.notes')"
                  :disabled="dischargeSaving"
                />
              </div>
              <div class="field field--full">
                <label for="hosp-dis-followup">{{ t('hospitalizations.followUpDate') }}</label>
                <input id="hosp-dis-followup" name="hosp-dis-followup" v-model="dischargeForm.followUpDate" type="date" :disabled="dischargeSaving" />
              </div>
            </div>
            <div v-if="dischargeError" class="alert alert--error mx" role="alert">{{ dischargeError }}</div>
            <div class="modal__actions">
              <BaseButton type="button" variant="ghost" @click="showDischarge = false" :disabled="dischargeSaving">{{ t('common.cancel') }}</BaseButton>
              <BaseButton type="submit" variant="danger" :disabled="dischargeSaving">
                <span v-if="dischargeSaving" class="spin spin--sm" />
                <span v-else>🚪 {{ t('hospitalizations.confirmDischarge') }}</span>
              </BaseButton>
            </div>
          </form>
        </div>
      </div>
    </Transition>

  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { t } from '../i18n'
import BaseButton from '../components/base/BaseButton.vue'
import { extractDetailedErrorMessage, logError } from '../utils/errors'
import {
  addMedication as addMedicationRequest,
  addMonitoringRecord as addMonitoringRecordRequest,
  admitPatient as admitPatientRequest,
  dischargeHospitalization as dischargeHospitalizationRequest,
  getHospitalizationDetail as getHospitalizationDetailRequest,
  loadAvailableWards as loadAvailableWardsRequest,
  loadHospitalizations as loadHospitalizationsRequest,
  loadHospitalizationsBoard as loadHospitalizationsBoardRequest,
  searchPatients as searchPatientsRequest,
} from '../composables/hospitalizations/useHospitalizationsDomain'

// ── Vista ────────────────────────────────────────────────────────────────────
const viewMode = ref('list')

// ── Lista ────────────────────────────────────────────────────────────────────
const items        = ref([])
const loading      = ref(false)
const error        = ref('')
const search       = ref('')
const statusFilter = ref('')
const pagination   = ref({ page: 1, totalPages: 1 })

const stats = reactive({ active: 0, dischargedToday: 0, avgDays: '—' })

async function load(page = 1) {
  loading.value = true; error.value = ''
  try {
    const pageSize = 15
    const rows = await loadHospitalizationsRequest({ status: statusFilter.value })
    const needle = search.value.trim().toLowerCase()
    const filtered = needle
      ? rows.filter((row) => [row.patient_name, row.species, row.responsible_vet, row.ward_name, row.kennel_number]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle)))
      : rows
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
    const safePage = Math.min(page, totalPages)
    items.value = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)
    pagination.value = { page: safePage, totalPages }
    computeStats()
  } catch (e) {
    logError('hospitalizaciones.load', e)
    error.value = extractDetailedErrorMessage(e, 'No se pudieron cargar las internaciones', { context: 'Carga de internaciones' })
  } finally { loading.value = false }
}

function computeStats() {
  const today = new Date().toISOString().split('T')[0]
  let active = 0, dischargedToday = 0, totalDays = 0, countWithDays = 0
  items.value.forEach(h => {
    if (h.status === 'admitted') active++
    if (h.status === 'discharged' && (h.discharge_date || '').startsWith(today)) dischargedToday++
    if (h.days_hospitalized != null) { totalDays += h.days_hospitalized; countWithDays++ }
  })
  stats.active = active
  stats.dischargedToday = dischargedToday
  stats.avgDays = countWithDays ? (totalDays / countWithDays).toFixed(1) : '—'
}

let loadTimer = null
function debouncedLoad() { clearTimeout(loadTimer); loadTimer = setTimeout(load, 350) }

// ── Tablero ──────────────────────────────────────────────────────────────────
const boardData    = ref([])
const boardLoading = ref(false)
const boardError   = ref('')

async function loadBoard() {
  boardLoading.value = true; boardError.value = ''
  try {
    boardData.value = await loadHospitalizationsBoardRequest()
  } catch (e) {
    logError('hospitalizaciones.loadBoard', e)
    boardError.value = extractDetailedErrorMessage(e, 'No se pudo cargar el tablero', { context: 'Tablero de internaciones' })
  } finally { boardLoading.value = false }
}

function switchToBoard() {
  viewMode.value = 'board'
  if (boardData.value.length === 0) loadBoard()
}

// ── Salas (para admisión) ────────────────────────────────────────────────────
const availableWards = ref([])
const wardsLoading   = ref(false)

async function loadWards() {
  wardsLoading.value = true
  try {
    availableWards.value = await loadAvailableWardsRequest()
  } catch (error) {
    logError('hospitalizaciones.loadWards', error)
    availableWards.value = []
  }
  finally { wardsLoading.value = false }
}

const freeKennelsForWard = computed(() => {
  if (!admitForm.wardId) return []
  const ward = availableWards.value.find(w => w.id === admitForm.wardId)
  if (!ward || !ward.kennels) return []
  return ward.kennels.filter(k => k.status === 'available' || k.status === 'free')
})

// ── Helpers ──────────────────────────────────────────────────────────────────
function petEmoji(s) {
  if (!s) return '🐾'
  const m = { perro:'🐶', dog:'🐶', gato:'🐱', cat:'🐱', conejo:'🐰', rabbit:'🐰', loro:'🦜', bird:'🦜', pez:'🐟', fish:'🐟', tortuga:'🐢', reptile:'🦎', hamster:'🐹' }
  return m[s.toLowerCase()] || '🐾'
}

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function hospStatusClass(s) {
  return { admitted: 'badge--blue', discharged: 'badge--green', transferred: 'badge--yellow' }[s] || 'badge--gray'
}

function hospStatusLabel(s) {
  return {
    admitted: t('hospitalizations.admittedStatus'),
    discharged: t('hospitalizations.dischargedStatus'),
    transferred: t('hospitalizations.transferredStatus'),
  }[s] || s || '—'
}

function consciousnessClass(c) {
  return { alert: 'mon-chip--green', lethargic: 'mon-chip--yellow', stupor: 'mon-chip--orange', coma: 'mon-chip--red' }[c] || ''
}

function consciousnessLabel(c) {
  return {
    alert: t('hospitalizations.consciousnessAlert'),
    lethargic: t('hospitalizations.consciousnessLethargic'),
    stupor: t('hospitalizations.consciousnessStupor'),
    coma: t('hospitalizations.consciousnessComa'),
  }[c] || c || ''
}

// ── Autocomplete paciente ────────────────────────────────────────────────────
const patientSearch        = ref('')
const patientResults       = ref([])
const selectedPatientLabel = ref('')
let patientTimer = null

async function searchPatients() {
  clearTimeout(patientTimer)
  admitForm.patientId = ''
  selectedPatientLabel.value = ''
  if (patientSearch.value.length < 2) { patientResults.value = []; return }
  patientTimer = setTimeout(async () => {
    try {
      patientResults.value = await searchPatientsRequest(patientSearch.value)
    } catch (error) {
      logError('hospitalizaciones.searchPatients', error, { search: patientSearch.value })
      patientResults.value = []
    }
  }, 300)
}

function selectPatient(pt) {
  admitForm.patientId = pt.id
  selectedPatientLabel.value = `${pt.name}${pt.hc_number ? ' · HC ' + pt.hc_number : ''}${pt.primary_owner ? ' — ' + pt.primary_owner : ''}`
  patientSearch.value = pt.name
  patientResults.value = []
}

// ── Modal admitir ────────────────────────────────────────────────────────────
const showAdmit   = ref(false)
const admitSaving = ref(false)
const admitError  = ref('')
const afe         = reactive({})

const admitForm = reactive({
  patientId: '',
  wardId: '',
  kennelId: '',
  attendingVetId: '',
  admissionReason: '',
  admissionDiagnosis: '',
  admissionWeight: null,
  estimatedDischargeDate: '',
  specialInstructions: '',
})

function openAdmit() {
  Object.assign(admitForm, {
    patientId: '', wardId: '', kennelId: '', attendingVetId: '', admissionReason: '',
    admissionDiagnosis: '', admissionWeight: null, estimatedDischargeDate: '', specialInstructions: ''
  })
  patientSearch.value = ''
  patientResults.value = []
  selectedPatientLabel.value = ''
  admitError.value = ''
  Object.keys(afe).forEach(k => delete afe[k])
  showAdmit.value = true
  if (availableWards.value.length === 0) loadWards()
}

function validateAdmit() {
  Object.keys(afe).forEach(k => delete afe[k])
  if (!admitForm.patientId)      afe.patientId      = 'Seleccioná un paciente'
  if (!admitForm.wardId)         afe.wardId         = 'Seleccioná una sala'
  if (!admitForm.attendingVetId) afe.attendingVetId = 'Ingresá el veterinario a cargo'
  if (!admitForm.admissionReason) afe.admissionReason = 'Ingresá el motivo de internación'
  return Object.keys(afe).length === 0
}

async function handleAdmit() {
  if (!validateAdmit()) return
  admitSaving.value = true; admitError.value = ''
  try {
    await admitPatientRequest(admitForm)
    showAdmit.value = false
    await load()
  } catch (e) {
    admitError.value = extractDetailedErrorMessage(e, 'No se pudo admitir el paciente.', { context: 'Admision de paciente' })
  } finally { admitSaving.value = false }
}

// ── Modal detalle ────────────────────────────────────────────────────────────
const showDetail   = ref(false)
const detailLoading = ref(false)
const detailData   = ref(null)
const detailTab    = ref('monitoring')

async function openHospDetail(hosp) {
  showDetail.value = true
  detailLoading.value = true
  detailData.value = null
  detailTab.value = 'monitoring'
  resetMonForm()
  resetMedForm()
  try {
    detailData.value = await getHospitalizationDetailRequest(hosp.id)
  } catch (error) {
    logError('hospitalizaciones.openDetail', error, { hospitalizationId: hosp?.id })
    detailData.value = hosp
  }
  finally { detailLoading.value = false }
}

// ── Monitoreo ────────────────────────────────────────────────────────────────
const monSaving = ref(false)
const monError  = ref('')
const monForm   = reactive({
  heartRate: null,
  respiratoryRate: null,
  temperature: null,
  systolicBp: null,
  mucousMembranes: '',
  hydrationStatus: '',
  consciousnessLevel: '',
  notes: '',
})

function resetMonForm() {
  Object.assign(monForm, { heartRate: null, respiratoryRate: null, temperature: null, systolicBp: null, mucousMembranes: '', hydrationStatus: '', consciousnessLevel: '', notes: '' })
  monError.value = ''
}

async function handleMonitoring() {
  monSaving.value = true; monError.value = ''
  try {
    await addMonitoringRecordRequest(detailData.value.id, monForm)
    detailData.value = await getHospitalizationDetailRequest(detailData.value.id)
    resetMonForm()
  } catch (e) {
    monError.value = extractDetailedErrorMessage(e, 'No se pudo registrar el monitoreo.', { context: 'Registro de monitoreo' })
  } finally { monSaving.value = false }
}

// ── Medicamentos ─────────────────────────────────────────────────────────────
const medSaving = ref(false)
const medError  = ref('')
const mfe       = reactive({})
const medForm   = reactive({
  medicationName: '',
  dose: '',
  doseUnit: '',
  frequency: '',
  route: '',
  startDatetime: '',
  durationHours: null,
  notes: '',
})

function resetMedForm() {
  Object.assign(medForm, { medicationName: '', dose: '', doseUnit: '', frequency: '', route: '', startDatetime: '', durationHours: null, notes: '' })
  Object.keys(mfe).forEach(k => delete mfe[k])
  medError.value = ''
}

function validateMed() {
  Object.keys(mfe).forEach(k => delete mfe[k])
  if (!medForm.medicationName) mfe.medicationName = 'Requerido'
  if (!medForm.dose)           mfe.dose           = 'Requerido'
  if (!medForm.frequency)      mfe.frequency      = 'Requerido'
  if (!medForm.route)          mfe.route          = 'Seleccioná la vía'
  if (!medForm.startDatetime)  mfe.startDatetime  = 'Requerido'
  return Object.keys(mfe).length === 0
}

async function handleMedication() {
  if (!validateMed()) return
  medSaving.value = true; medError.value = ''
  try {
    await addMedicationRequest(detailData.value.id, medForm)
    detailData.value = await getHospitalizationDetailRequest(detailData.value.id)
    resetMedForm()
  } catch (e) {
    medError.value = extractDetailedErrorMessage(e, 'No se pudo prescribir el medicamento.', { context: 'Prescripcion de medicamento' })
  } finally { medSaving.value = false }
}

// ── Modal dar alta ───────────────────────────────────────────────────────────
const showDischarge    = ref(false)
const dischargeTarget  = ref(null)
const dischargeSaving  = ref(false)
const dischargeError   = ref('')
const dischargeForm    = reactive({ dischargeNotes: '', followUpDate: '' })

function openDischarge(hosp) {
  dischargeTarget.value = hosp
  Object.assign(dischargeForm, { dischargeNotes: '', followUpDate: '' })
  dischargeError.value = ''
  showDischarge.value = true
}

async function handleDischarge() {
  dischargeSaving.value = true; dischargeError.value = ''
  try {
    await dischargeHospitalizationRequest(dischargeTarget.value.id, dischargeForm)
    showDischarge.value = false
    await load()
  } catch (e) {
    dischargeError.value = extractDetailedErrorMessage(e, 'No se pudo registrar el alta.', { context: 'Alta de internacion' })
  } finally { dischargeSaving.value = false }
}

onMounted(load)
onUnmounted(() => {
  clearTimeout(loadTimer)
  clearTimeout(patientTimer)
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

/* Stats */
.stats-row { display: flex; gap: 14px; flex-wrap: wrap; }
.stat-card { display: flex; align-items: center; gap: 14px; background: var(--c, var(--surface)); border-radius: var(--radius-lg); padding: 16px 20px; flex: 1; min-width: 160px; }
.stat-card__icon { font-size: 1.6rem; }
.stat-card strong { display: block; font-size: 1.5rem; font-weight: 800; color: var(--ct, var(--text)); line-height: 1; }
.stat-card span { font-size: 0.78rem; color: var(--ct, var(--text-2)); opacity: 0.85; }

/* Toggle de vista */
.view-toggle { display: flex; gap: 0; border: 1.5px solid var(--border); border-radius: var(--radius); overflow: hidden; width: fit-content; }
.toggle-btn { padding: 8px 18px; background: var(--white); border: none; font-size: 0.85rem; font-weight: 500; color: var(--text-2); cursor: pointer; transition: background 0.12s, color 0.12s; }
.toggle-btn:first-child { border-right: 1.5px solid var(--border); }
.toggle-btn--active { background: var(--primary); color: white; font-weight: 700; }
.toggle-btn:hover:not(.toggle-btn--active) { background: var(--surface); }

/* Filtros */
.filters { display: flex; gap: 10px; flex-wrap: wrap; }
.filter-input { padding: 9px 13px; border: 1.5px solid var(--border); border-radius: var(--radius); font-size: 0.87rem; background: var(--white); color: var(--text); outline: none; }
.filter-input:focus { border-color: var(--primary); }
.filter-input--grow { flex: 1; min-width: 200px; }
.filter-select { padding: 9px 13px; border: 1.5px solid var(--border); border-radius: var(--radius); font-size: 0.87rem; background: var(--white); color: var(--text); outline: none; cursor: pointer; }
.filter-select:focus { border-color: var(--primary); }

/* Card / Table */
.card { background: var(--white); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); overflow: hidden; }
.table { width: 100%; border-collapse: collapse; font-size: 0.87rem; }
.table thead th { background: var(--surface); padding: 11px 14px; text-align: left; font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-3); border-bottom: 1.5px solid var(--border); white-space: nowrap; }
.table tbody tr { border-bottom: 1px solid var(--border); transition: background 0.12s; }
.table tbody tr:last-child { border-bottom: none; }
.table tbody tr:hover { background: var(--surface); }
.table tbody td { padding: 11px 14px; color: var(--text); vertical-align: middle; }

.pet-cell { display: flex; align-items: center; gap: 10px; }
.pet-cell div { display: flex; flex-direction: column; gap: 1px; }
.pet-cell strong { font-size: 0.88rem; color: var(--text); }
.sub { font-size: 0.75rem; color: var(--text-3); }
.ward-name { font-size: 0.88rem; color: var(--text); display: block; }
.days-badge { display: inline-block; padding: 3px 8px; border-radius: 20px; font-size: 0.8rem; font-weight: 700; background: var(--surface); color: var(--text-2); }

/* Badges */
.badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 0.73rem; font-weight: 700; white-space: nowrap; }
.badge--gray   { background: #EAEAEA; color: #555; }
.badge--yellow { background: #FFF3CC; color: #8A6200; }
.badge--blue   { background: #D6EEFF; color: #1A5FAA; }
.badge--green  { background: #D6F3EC; color: #1A9E7F; }
.badge--red    { background: #FDEAEA; color: #c0392b; }

/* Acciones */
.action-btns { display: flex; gap: 6px; }
.btn-action { padding: 5px 12px; border: 1.5px solid var(--border); border-radius: var(--radius-sm); background: none; font-size: 0.78rem; font-weight: 500; color: var(--text-2); cursor: pointer; transition: background 0.12s; }
.btn-action:hover { background: var(--surface); }
.btn-action--primary { background: var(--primary); color: white; border-color: var(--primary); }
.btn-action--primary:hover { opacity: 0.88; }
.btn-action--danger { background: var(--danger); color: white; border-color: var(--danger); }
.btn-action--danger:hover { opacity: 0.88; }

/* Paginación */
.pagination { display: flex; align-items: center; justify-content: center; gap: 16px; font-size: 0.85rem; color: var(--text-2); }
.pagination button { padding: 6px 14px; border: 1.5px solid var(--border); border-radius: var(--radius-sm); background: none; cursor: pointer; font-size: 0.82rem; color: var(--text-2); }
.pagination button:hover:not(:disabled) { background: var(--surface-2); }
.pagination button:disabled { opacity: 0.4; cursor: not-allowed; }

/* Tablero de salas */
.board { display: flex; flex-direction: column; gap: 20px; }
.ward-card { background: var(--white); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); padding: 18px 20px; }
.ward-card__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
.ward-card__name { font-size: 1rem; font-weight: 700; color: var(--text); }
.ward-card__summary { display: flex; gap: 8px; flex-wrap: wrap; }
.kennel-grid { display: flex; flex-wrap: wrap; gap: 8px; }
.kennel-chip { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 60px; height: 60px; border-radius: var(--radius); font-size: 0.85rem; font-weight: 700; border: 2px solid; cursor: default; transition: transform 0.1s; }
.kennel-chip:hover { transform: scale(1.06); }
.kennel-chip--free     { background: #D6F3EC; color: #1A9E7F; border-color: #A7E5D4; }
.kennel-chip--occupied { background: #FDEAEA; color: #c0392b; border-color: #F5BCBC; }
.kennel-type { font-size: 0.6rem; font-weight: 400; opacity: 0.8; }

/* Botones */
.btn-primary { padding: 10px 20px; background: linear-gradient(135deg, var(--primary) 0%, var(--accent-mint) 100%); color: white; border: none; border-radius: var(--radius); font-size: 0.9rem; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: opacity var(--transition), transform var(--transition); }
.btn-primary:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
.btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
.btn-ghost { padding: 10px 20px; background: none; border: 1.5px solid var(--border); border-radius: var(--radius); color: var(--text-2); font-size: 0.9rem; font-weight: 500; cursor: pointer; transition: background var(--transition); }
.btn-ghost:hover:not(:disabled) { background: var(--surface-2); }
.btn-danger { padding: 10px 20px; background: var(--danger); color: white; border: none; border-radius: var(--radius); font-size: 0.9rem; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: opacity var(--transition); }
.btn-danger:hover:not(:disabled) { opacity: 0.88; }
.btn-danger:disabled { opacity: 0.6; cursor: not-allowed; }

/* Modal */
.modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 16px; }
.modal { background: var(--white); border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); width: 100%; max-width: 700px; max-height: 92vh; overflow-y: auto; display: flex; flex-direction: column; }
.modal--wide { max-width: 900px; }
.modal--sm   { max-width: 480px; }
.modal__header { display: flex; align-items: center; justify-content: space-between; padding: 20px 24px 14px; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: var(--white); z-index: 2; }
.modal__header h3 { font-size: 1.1rem; font-weight: 700; color: var(--text); }
.modal__close { background: none; border: none; cursor: pointer; font-size: 1rem; color: var(--text-3); padding: 4px 8px; border-radius: var(--radius-sm); }
.modal__close:hover { background: var(--surface-2); }
.modal__actions { display: flex; align-items: center; justify-content: flex-end; gap: 10px; padding: 14px 24px 20px; border-top: 1px solid var(--border); position: sticky; bottom: 0; background: var(--white); z-index: 1; }

/* Formulario */
.form-body { padding: 20px 24px 4px; flex: 1; display: flex; flex-direction: column; gap: 14px; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.field { display: flex; flex-direction: column; gap: 4px; }
.field label { font-size: 0.8rem; font-weight: 600; color: var(--text-2); }
.field input, .field select, .field textarea { padding: 8px 11px; border: 1.5px solid var(--border); border-radius: var(--radius); font-size: 0.88rem; color: var(--text); background: var(--surface); outline: none; transition: border-color var(--transition); }
.field input:focus, .field select:focus, .field textarea:focus { border-color: var(--primary); background: var(--white); }
.field textarea { resize: vertical; }
.field--full { grid-column: 1 / -1; }
.field-error { font-size: 0.73rem; color: var(--danger); }
.req { color: var(--danger); }

.section-title { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-3); padding-bottom: 4px; border-bottom: 1px solid var(--border); }

/* Autocomplete */
.autocomplete { position: absolute; z-index: 100; background: var(--white); border: 1.5px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); width: 100%; max-height: 200px; overflow-y: auto; top: calc(100% + 2px); left: 0; }
.autocomplete__item { padding: 9px 13px; cursor: pointer; font-size: 0.88rem; }
.autocomplete__item:hover { background: var(--surface-2); }
.autocomplete__owner { font-size: 0.78rem; color: var(--text-3); }
.selected-patient { margin-top: 5px; font-size: 0.82rem; color: var(--primary); font-weight: 500; }

/* Detalle grid */
.detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.detail-item { display: flex; flex-direction: column; gap: 3px; padding: 10px 12px; background: var(--surface); border-radius: var(--radius); }
.detail-item--full { grid-column: 1 / -1; }
.detail-label { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-3); }

/* Tabs */
.tabs { display: flex; border-bottom: 2px solid var(--border); padding: 0 24px; margin-top: 8px; }
.tab { padding: 10px 18px; background: none; border: none; font-size: 0.88rem; font-weight: 600; color: var(--text-3); cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -2px; transition: color 0.12s, border-color 0.12s; }
.tab--active { color: var(--primary); border-bottom-color: var(--primary); }
.tab:hover:not(.tab--active) { color: var(--text-2); }

.tab-content { padding: 20px 24px; display: flex; flex-direction: column; gap: 14px; }

/* Monitoreo */
.monitoring-list { display: flex; flex-direction: column; gap: 10px; max-height: 260px; overflow-y: auto; padding-right: 4px; }
.monitoring-record { background: var(--surface); border: 1.5px solid var(--border); border-radius: var(--radius); padding: 10px 14px; }
.monitoring-record__time { margin-bottom: 6px; }
.monitoring-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.mon-chip { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border-radius: 20px; font-size: 0.75rem; font-weight: 600; background: #EAEAEA; color: #555; }
.mon-chip--green  { background: #D6F3EC; color: #1A9E7F; }
.mon-chip--yellow { background: #FFF3CC; color: #8A6200; }
.mon-chip--orange { background: #FEF0E0; color: #B45309; }
.mon-chip--red    { background: #FDEAEA; color: #c0392b; }

/* Medicamentos */
.med-list { display: flex; flex-direction: column; gap: 10px; max-height: 220px; overflow-y: auto; padding-right: 4px; }
.med-record { background: var(--surface); border: 1.5px solid var(--border); border-radius: var(--radius); padding: 10px 14px; }
.med-record__header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 4px; }
.med-record__header strong { font-size: 0.9rem; color: var(--text); }

/* Inline form */
.inline-form { background: var(--surface); border: 1.5px solid var(--border); border-radius: var(--radius-lg); padding: 16px; }
.inline-form .field input, .inline-form .field select, .inline-form .field textarea { background: var(--white); }

.empty-inline { padding: 20px; text-align: center; font-size: 0.85rem; color: var(--text-3); background: var(--surface); border-radius: var(--radius); }

/* Dar alta */
.discharge-confirm { background: #FFF3CC; border-left: 3px solid #8A6200; border-radius: var(--radius-sm); padding: 12px 16px; font-size: 0.88rem; color: #8A6200; }

/* Alertas */
.alert { padding: 10px 14px; border-radius: var(--radius-sm); font-size: 0.875rem; }
.alert--error { background: #FDEAEA; color: #c0392b; border-left: 3px solid var(--danger); }
.mx { margin: 0 24px 8px; }

/* Estados */
.loading-state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 60px 20px; color: var(--text-3); font-size: 0.9rem; background: var(--white); border-radius: var(--radius-xl); box-shadow: var(--shadow-sm); }
.empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 60px 20px; color: var(--text-3); font-size: 0.9rem; background: var(--white); border-radius: var(--radius-xl); box-shadow: var(--shadow-sm); }
.empty-state__emoji { font-size: 3rem; }

/* Spinner */
.spin { width: 20px; height: 20px; border: 2px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: spin 0.7s linear infinite; display: inline-block; }
.spin--sm { width: 14px; height: 14px; }
.spin--dark { border-color: rgba(0,0,0,0.1); border-top-color: var(--primary); }
@keyframes spin { to { transform: rotate(360deg); } }

/* Transición modal */
.modal-enter-active, .modal-leave-active { transition: opacity 0.2s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }

@media (max-width: 700px) {
  .stats-row { gap: 10px; }
  .stat-card { min-width: 130px; }
  .form-grid { grid-template-columns: 1fr; }
  .detail-grid { grid-template-columns: 1fr; }
  .modal { max-width: 100%; max-height: 100vh; border-radius: 0; }
  .kennel-chip { width: 50px; height: 50px; font-size: 0.78rem; }
  .table thead th:nth-child(3), .table tbody td:nth-child(3),
  .table thead th:nth-child(5), .table tbody td:nth-child(5) { display: none; }
}
</style>
