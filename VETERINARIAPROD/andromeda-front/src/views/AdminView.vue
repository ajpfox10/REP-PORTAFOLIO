<template>
  <div class="admin" aria-live="polite">
    <section class="hero">
      <div>
        <h2 class="hero__title">{{ t('admin.title') }}</h2>
        <p class="hero__subtitle">{{ t('admin.subtitle') }}</p>
      </div>
      <div class="hero__actions">
        <BaseButton :aria-label="t('admin.newUser')" @click="openModal">
          + {{ t('admin.newUser') }}
        </BaseButton>
        <button class="btn-logout" type="button" @click="handleLogout" title="Cerrar sesión">
          ⏻ Cerrar sesión
        </button>
      </div>
    </section>

    <div v-if="globalError" class="alert alert--error" role="alert">{{ globalError }}</div>

    <section class="panel panel--stacked">
      <header class="section-head">
        <div>
          <h3>Estado del portal de dueños</h3>
          <p>Solo muestra salud operativa, latencia y disponibilidad del servicio.</p>
        </div>
        <div class="hero__actions">
          <BaseButton variant="ghost" @click="loadPortalHealth" :disabled="portalHealthLoading">
            {{ portalHealthLoading ? 'Verificando…' : 'Actualizar' }}
          </BaseButton>
          <a class="portal-link" :href="portalHref" target="_blank" rel="noopener noreferrer">
            Abrir portal
          </a>
        </div>
      </header>

      <div v-if="portalHealthError" class="alert alert--error" role="alert">{{ portalHealthError }}</div>

      <div v-if="portalHealthLoading" class="table-loading" role="status">
        <span class="spinner spinner--dark" />
        <span>Consultando salud del portal…</span>
      </div>

      <div v-else class="portal-health-grid">
        <article class="portal-health-card" :class="portalHealth.statusClass">
          <div class="portal-health-card__top">
            <span class="badge" :class="portalHealth.badgeClass">{{ portalHealth.statusLabel }}</span>
            <span class="portal-health-card__service">portal</span>
          </div>
          <strong class="portal-health-card__headline">Servicio del dueño</strong>
          <p class="portal-health-card__copy">No expone datos de clientes. Solo confirma si el portal está operativo.</p>
          <dl class="portal-health-meta">
            <div>
              <dt>Latencia</dt>
              <dd>{{ formatLatency(portalHealth.latency) }}</dd>
            </div>
            <div>
              <dt>Origen</dt>
              <dd>{{ portalHealth.source || '—' }}</dd>
            </div>
            <div>
              <dt>Destino</dt>
              <dd>{{ portalHealth.target || '—' }}</dd>
            </div>
            <div>
              <dt>Última verificación</dt>
              <dd>{{ formatDateTime(portalHealth.checkedAt) }}</dd>
            </div>
          </dl>
        </article>

        <article class="portal-health-card portal-health-card--wide">
          <strong class="portal-health-card__headline">Checks del servicio</strong>
          <div v-if="portalHealthChecks.length === 0" class="portal-health-empty">Sin detalles adicionales</div>
          <div v-else class="portal-health-checks">
            <div v-for="check in portalHealthChecks" :key="check.name" class="portal-health-check">
              <span class="portal-health-check__name">{{ check.name }}</span>
              <span class="portal-health-check__value">{{ check.value }}</span>
            </div>
          </div>
        </article>
      </div>
    </section>

    <section class="panel">
      <BaseTable :label="t('admin.title')" :caption="t('admin.subtitle')">
        <div v-if="loading" class="table-loading" role="status">
          <span class="spinner spinner--dark" />
          <span>{{ t('common.loading') }}</span>
        </div>

        <table v-else class="table">
          <thead>
            <tr>
              <th>{{ t('admin.name') }}</th>
              <th>{{ t('admin.email') }}</th>
              <th>{{ t('admin.role') }}</th>
              <th>{{ t('admin.branch') }}</th>
              <th>{{ t('admin.status') }}</th>
              <th>{{ t('admin.created') }}</th>
              <th>{{ t('admin.actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="users.length === 0">
              <td colspan="7" class="table__empty">{{ t('admin.noUsers') }}</td>
            </tr>
            <tr v-for="user in users" :key="user.id">
              <td class="table__name">
                <span class="avatar">{{ initials(user) }}</span>
                <span>{{ user.first_name }} {{ user.last_name }}</span>
              </td>
              <td class="table__email">{{ user.email }}</td>
              <td>
                <div class="role-cell">
                  <span class="badge badge--role">{{ formatRole(user.roles) }}</span>
                  <select
                    :id="`admin-role-${user.id}`"
                    :name="`admin-role-${user.id}`"
                    class="role-select"
                    :value="firstRole(user.roles)"
                    :aria-label="`${t('admin.role')}: ${user.email}`"
                    :disabled="changingRoleId === user.id"
                    @change="handleRoleChange(user, $event.target.value)"
                  >
                    <option v-for="role in ADMIN_ROLES" :key="role.value" :value="role.value">
                      {{ role.label }}
                    </option>
                  </select>
                </div>
              </td>
              <td>{{ user.branch_name || t('common.none') }}</td>
              <td>
                <span class="badge" :class="user.is_active ? 'badge--active' : 'badge--inactive'">
                  {{ user.is_active ? t('common.active') : t('common.inactive') }}
                </span>
              </td>
              <td class="table__date">{{ formatDate(user.created_at) }}</td>
              <td>
                <button
                  v-if="user.is_active"
                  class="btn-icon btn-icon--danger"
                  type="button"
                  :title="t('admin.deactivateUser')"
                  :aria-label="t('admin.deactivateUser')"
                  @click="confirmDeactivate(user)"
                >
                  {{ t('common.delete') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>

        <div v-if="meta.totalPages > 1" class="pagination">
          <button type="button" :disabled="meta.page <= 1" @click="loadPage(meta.page - 1)">
            {{ t('common.previous') }}
          </button>
          <span>{{ t('admin.pagination', { page: meta.page, total: meta.totalPages }) }}</span>
          <button type="button" :disabled="meta.page >= meta.totalPages" @click="loadPage(meta.page + 1)">
            {{ t('common.next') }}
          </button>
        </div>
      </BaseTable>
    </section>

    <section class="panel panel--stacked">
      <header class="section-head">
        <div>
          <h3>{{ t('admin.authPolicies') }}</h3>
          <p>{{ t('admin.authPoliciesHelp') }}</p>
        </div>
      </header>

      <div class="policy-row">
        <div>
          <strong>{{ t('admin.optionalTwoFactorLabel') }}</strong>
          <p class="policy-help">{{ t('admin.optionalTwoFactorHelp') }}</p>
        </div>
        <label class="policy-switch">
          <input
            id="admin-2fa-toggle"
            name="admin-2fa-toggle"
            type="checkbox"
            :checked="authPolicy.twoFactorOptionalEnabled"
            :disabled="savingAuthPolicy"
            @change="toggleTwoFactorPolicy($event.target.checked)"
          />
          <span>{{ authPolicy.twoFactorOptionalEnabled ? t('admin.enabled') : t('admin.disabled') }}</span>
        </label>
      </div>
      <div v-if="authPolicyError" class="alert alert--error" role="alert">{{ authPolicyError }}</div>
    </section>

    <section class="panel panel--stacked">
      <header class="section-head">
        <div>
          <h3>Features de acceso</h3>
          <p>Controla features por organizacion sin tocar el RBAC base.</p>
        </div>
      </header>

      <div v-if="featureFlagsLoading" class="table-loading" role="status">
        <span class="spinner spinner--dark" />
        <span>{{ t('common.loading') }}</span>
      </div>

      <div v-else class="feature-grid">
        <article v-for="feature in aiFeatures" :key="feature.key" class="feature-card">
          <div class="feature-card__body">
            <strong>{{ feature.label }}</strong>
            <p>{{ feature.description }}</p>
            <span class="feature-card__key">{{ feature.key }}</span>
          </div>
          <label class="policy-switch">
            <input
              :id="`admin-feat-${feature.key}`"
              :name="`admin-feat-${feature.key}`"
              type="checkbox"
              :checked="Boolean(featureFlags[feature.key])"
              :disabled="savingFeatureKey === feature.key"
              @change="toggleFeatureFlag(feature.key, $event.target.checked)"
            />
            <span>{{ featureFlags[feature.key] ? t('admin.enabled') : t('admin.disabled') }}</span>
          </label>
        </article>
      </div>
      <div v-if="featureFlagsError" class="alert alert--error" role="alert">{{ featureFlagsError }}</div>
    </section>

    <section class="panel panel--stacked">
      <header class="section-head">
        <div>
          <h3>{{ t('admin.roleOverrides') }}</h3>
          <p>{{ t('admin.roleOverridesHelp') }}</p>
        </div>
      </header>

      <div class="rbac-controls">
        <label for="admin-rbac-role" class="sr-only">{{ t('admin.role') }}</label>
        <select id="admin-rbac-role" name="admin-rbac-role" v-model="overrideForm.role" class="role-select">
          <option value="">{{ t('admin.selectRole') }}</option>
          <option v-for="role in roleCatalog" :key="role.name" :value="role.name">
            {{ formatRole(role.name) }}
          </option>
        </select>
        <label for="admin-rbac-grant" class="sr-only">{{ t('admin.grant') }}</label>
        <input id="admin-rbac-grant" name="admin-rbac-grant" v-model.trim="overrideForm.grant" type="text" :placeholder="t('admin.grantPlaceholder')" />
        <label for="admin-rbac-revoke" class="sr-only">{{ t('admin.revoke') }}</label>
        <input id="admin-rbac-revoke" name="admin-rbac-revoke" v-model.trim="overrideForm.revoke" type="text" :placeholder="t('admin.revokePlaceholder')" />
        <BaseButton :disabled="savingOverride" @click="saveOverride">{{ t('admin.saveOverride') }}</BaseButton>
      </div>
      <div v-if="overrideError" class="alert alert--error" role="alert">{{ overrideError }}</div>

      <table class="table">
        <thead>
          <tr>
            <th>{{ t('admin.role') }}</th>
            <th>{{ t('admin.grant') }}</th>
            <th>{{ t('admin.revoke') }}</th>
            <th>{{ t('admin.updated') }}</th>
            <th>{{ t('admin.actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="overrides.length === 0">
            <td colspan="5" class="table__empty">{{ t('admin.noOverrides') }}</td>
          </tr>
          <tr v-for="item in overrides" :key="item.role">
            <td>{{ formatRole(item.role) }}</td>
            <td>{{ (item.grant || []).join(', ') || t('common.none') }}</td>
            <td>{{ (item.revoke || []).join(', ') || t('common.none') }}</td>
            <td class="table__date">{{ formatDateTime(item.updated) }}</td>
            <td>
              <button
                class="btn-icon btn-icon--danger"
                type="button"
                :aria-label="`${t('admin.saveOverride')}: ${item.role}`"
                @click="removeOverride(item.role)"
              >
                {{ t('common.delete') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- ── Logs del sistema ─────────────────────────────────────────────── -->
    <section class="panel panel--stacked">
      <header class="section-head">
        <div>
          <h3>Logs del sistema</h3>
          <p>Últimas acciones registradas en la organización</p>
        </div>
        <BaseButton variant="ghost" @click="loadLogs" :disabled="loadingLogs">
          {{ loadingLogs ? 'Cargando…' : 'Actualizar' }}
        </BaseButton>
      </header>

      <div v-if="logsError" class="alert alert--error" role="alert">{{ logsError }}</div>

      <div v-if="loadingLogs" class="table-loading" role="status">
        <span class="spinner spinner--dark" /><span>Cargando logs…</span>
      </div>

      <table v-else class="table table--logs">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Acción</th>
            <th>Recurso</th>
            <th>Usuario</th>
            <th>IP</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="logs.length === 0">
            <td colspan="5" class="table__empty">Sin registros</td>
          </tr>
          <tr v-for="log in logs" :key="log.id" :class="log.action === 'DELETE' ? 'log-row--danger' : ''">
            <td class="table__date">{{ formatDateTime(log.created_at) }}</td>
            <td><span class="badge" :class="logBadgeClass(log.action)">{{ log.action }}</span></td>
            <td class="log-resource">{{ log.resource }}{{ log.resource_id ? ` #${log.resource_id}` : '' }}</td>
            <td class="table__email">{{ log.user_email || log.user_id || '—' }}</td>
            <td class="log-ip">{{ log.ip_address || '—' }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- ── Explorador de base de datos (solo superadmin) ───────────────── -->
    <section v-if="isSuperAdmin" class="panel panel--stacked">
      <header class="section-head">
        <div>
          <h3>Explorador de datos</h3>
          <p>Tablas de negocio — estructura y últimos 10 registros</p>
        </div>
      </header>

      <div class="db-table-pills">
        <button
          v-for="tbl in dbTableList"
          :key="tbl.key"
          class="pill"
          :class="{ 'pill--active': dbSelectedTable === tbl.key }"
          type="button"
          @click="loadTablePreview(tbl.key)"
        >
          {{ tbl.label }}
        </button>
      </div>

      <div v-if="dbLoading" class="table-loading" role="status">
        <span class="spinner spinner--dark" /><span>Cargando…</span>
      </div>

      <template v-if="dbPreview && !dbLoading">
        <div class="db-table-meta">
          <strong>{{ dbPreview.label }}</strong>
          <span class="db-table-desc">{{ dbPreview.description }}</span>
        </div>

        <details class="db-glossary" open>
          <summary>Glosario de columnas ({{ dbPreview.columns.length }})</summary>
          <div class="db-glossary-grid">
            <div v-for="col in dbPreview.columns" :key="col.name" class="db-col-card">
              <div class="db-col-name">{{ col.name }}<span class="db-col-type">{{ col.type }}</span></div>
              <div class="db-col-desc">{{ col.description }}</div>
            </div>
          </div>
        </details>

        <div class="db-records-wrap">
          <p class="db-records-label">Últimos {{ dbPreview.rows.length }} registros</p>
          <div class="table-scroll">
            <table class="table table--sm">
              <thead>
                <tr>
                  <th v-for="col in dbPreview.columns" :key="col.name">{{ col.name }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="dbPreview.rows.length === 0">
                  <td :colspan="dbPreview.columns.length" class="table__empty">Sin registros</td>
                </tr>
                <tr v-for="(row, i) in dbPreview.rows" :key="i">
                  <td v-for="col in dbPreview.columns" :key="col.name" class="db-cell">
                    {{ formatCellValue(row[col.name]) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </template>

      <div v-if="dbError" class="alert alert--error" role="alert">{{ dbError }}</div>
    </section>

    <BaseModal v-model="showModal" :label="t('admin.newUser')" labelledby="admin-new-user-title">
      <div class="modal__header">
        <h3 id="admin-new-user-title">{{ t('admin.newUser') }}</h3>
        <button class="modal__close" type="button" :aria-label="t('common.close')" @click="closeModal">{{ t('common.close') }}</button>
      </div>

      <div v-if="createSuccess" class="modal__success" role="status">
        <span class="success-icon">{{ t('admin.successBadge') }}</span>
        <h4>{{ t('admin.createUserSuccess') }}</h4>
        <p>
          {{ t('admin.welcomeEmailHint') }}
          <strong>{{ form.email }}</strong>
          {{ t('admin.tempPasswordSentence') }}
        </p>
        <p class="hint">{{ t('admin.tempPasswordHint') }}</p>
        <BaseButton @click="closeModal">{{ t('common.close') }}</BaseButton>
      </div>

      <form v-else @submit.prevent="handleCreate" novalidate>
        <div class="form-row">
          <div class="field">
            <label for="admin-m-firstname">{{ t('admin.firstName') }} <span class="req">*</span></label>
            <input id="admin-m-firstname" name="admin-m-firstname" v-model.trim="form.firstName" type="text" placeholder="Juan" :disabled="creating" required />
            <span v-if="errors.firstName" class="field-error">{{ errors.firstName }}</span>
          </div>
          <div class="field">
            <label for="admin-m-lastname">{{ t('admin.lastName') }} <span class="req">*</span></label>
            <input id="admin-m-lastname" name="admin-m-lastname" v-model.trim="form.lastName" type="text" placeholder="Perez" :disabled="creating" required />
            <span v-if="errors.lastName" class="field-error">{{ errors.lastName }}</span>
          </div>
        </div>

        <div class="field">
          <label for="admin-m-email">{{ t('admin.email') }} <span class="req">*</span></label>
          <input id="admin-m-email" name="admin-m-email" v-model.trim="form.email" type="email" placeholder="usuario@veterinaria.com" :disabled="creating" required />
          <span v-if="errors.email" class="field-error">{{ errors.email }}</span>
        </div>

        <div class="field">
          <label for="admin-m-role">{{ t('admin.role') }} <span class="req">*</span></label>
          <select id="admin-m-role" name="admin-m-role" v-model="form.role" :disabled="creating" required>
            <option value="">{{ t('admin.selectRole') }}</option>
            <option v-for="role in ADMIN_ROLES" :key="role.value" :value="role.value">{{ role.label }}</option>
          </select>
          <span v-if="errors.role" class="field-error">{{ errors.role }}</span>
        </div>

        <div class="form-row">
          <div class="field">
            <label for="admin-m-phone">{{ t('admin.phone') }}</label>
            <input id="admin-m-phone" name="admin-m-phone" v-model.trim="form.phone" type="tel" placeholder="+54 9 11 1234-5678" :disabled="creating" />
          </div>
          <div class="field">
            <label for="admin-m-license">{{ t('admin.licenseNumber') }}</label>
            <input id="admin-m-license" name="admin-m-license" v-model.trim="form.licenseNumber" type="text" placeholder="VET-0001" :disabled="creating" />
          </div>
        </div>

        <div v-if="createError" class="alert alert--error" role="alert">{{ createError }}</div>

        <div class="modal__actions">
          <BaseButton type="button" variant="ghost" :disabled="creating" @click="closeModal">
            {{ t('common.cancel') }}
          </BaseButton>
          <BaseButton type="submit" :disabled="creating">
            <span v-if="creating" class="spinner" />
            <span v-else>{{ t('admin.createAndEmail') }}</span>
          </BaseButton>
        </div>

        <p class="modal__hint">
          {{ t('admin.createUserHint') }}
        </p>
      </form>
    </BaseModal>

    <BaseModal
      :model-value="Boolean(deactivateTarget)"
      :label="t('admin.deactivateUser')"
      labelledby="admin-deactivate-title"
      width="420px"
      @update:modelValue="deactivateTarget = null"
    >
      <div class="modal__header">
        <h3 id="admin-deactivate-title">{{ t('admin.deactivateUser') }}</h3>
        <button class="modal__close" type="button" :aria-label="t('common.close')" @click="deactivateTarget = null">{{ t('common.close') }}</button>
      </div>
      <p class="confirm-text">
        {{ t('admin.deactivatePromptPrefix') }}
        <strong>{{ deactivateTarget?.first_name }} {{ deactivateTarget?.last_name }}</strong>
        {{ t('admin.deactivatePrompt') }}
      </p>
      <div v-if="deactivateError" class="alert alert--error" role="alert">{{ deactivateError }}</div>
      <div class="modal__actions">
        <BaseButton variant="ghost" :disabled="deactivating" @click="deactivateTarget = null">
          {{ t('common.cancel') }}
        </BaseButton>
        <BaseButton variant="danger" :disabled="deactivating" @click="handleDeactivate">
          <span v-if="deactivating" class="spinner" />
          <span v-else>{{ t('admin.deactivateUser') }}</span>
        </BaseButton>
      </div>
    </BaseModal>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import BaseButton from '../components/base/BaseButton.vue'
import BaseModal from '../components/base/BaseModal.vue'
import BaseTable from '../components/base/BaseTable.vue'
import { t } from '../i18n'
import {
  ADMIN_ROLES,
  createAdminUser,
  deactivateAdminUser,
  deleteOverride as deleteOverrideRequest,
  extractAdminError,
  firstRole,
  formatRoleLabel,
  loadLogs as listLogsRequest,
  listUsers as listUsersRequest,
  loadAuthPolicy as loadAuthPolicyRequest,
  loadFeatureFlags as loadFeatureFlagsRequest,
  loadOverrides as loadOverridesRequest,
  loadPortalHealth as loadPortalHealthRequest,
  loadTableList as loadTableListRequest,
  loadTablePreview as loadTablePreviewRequest,
  parsePermissions,
  saveOverride as saveOverrideRequest,
  updateAdminUserRole,
  updateAuthPolicy as updateAuthPolicyRequest,
  updateFeatureFlags as updateFeatureFlagsRequest,
} from '../composables/admin/useAdminDomain'
import { useUiFeedback } from '../composables/useUiFeedback'
import { useAuthStore } from '../stores/auth'
import { logError } from '../utils/errors'

const auth   = useAuthStore()
const router = useRouter()
const { confirm, success } = useUiFeedback()
const isSuperAdmin = computed(() => auth.hasRole('superadmin'))

const users = ref([])
const meta = ref({ page: 1, totalPages: 1 })
const loading = ref(false)
const globalError = ref('')
const changingRoleId = ref(null)
const overrides = ref([])
const roleCatalog = ref([])
const savingOverride = ref(false)
const overrideError = ref('')
const overrideForm = reactive({
  role: '',
  grant: '',
  revoke: '',
})
const authPolicy = reactive({
  twoFactorOptionalEnabled: false,
})
const savingAuthPolicy = ref(false)
const authPolicyError = ref('')
const featureFlags = reactive({})
const featureDefinitions = ref([])
const featureFlagsLoading = ref(false)
const featureFlagsError = ref('')
const savingFeatureKey = ref('')

const showModal = ref(false)
const creating = ref(false)
const createError = ref('')
const createSuccess = ref(false)
const errors = reactive({})

const form = reactive({
  firstName: '',
  lastName: '',
  email: '',
  role: '',
  phone: '',
  licenseNumber: '',
})

const deactivateTarget = ref(null)
const deactivating = ref(false)
const deactivateError = ref('')

const logs = ref([])
const loadingLogs = ref(false)
const logsError = ref('')

const dbTableList     = ref([])
const dbSelectedTable = ref('')
const dbPreview       = ref(null)
const dbLoading       = ref(false)
const dbError         = ref('')
const aiFeatures = ref([])
const portalHealthLoading = ref(false)
const portalHealthError = ref('')
const portalHealth = reactive({
  status: 'unknown',
  statusLabel: 'Desconocido',
  statusClass: 'portal-health-card--unknown',
  badgeClass: 'badge--role',
  latency: null,
  source: '',
  target: '',
  checkedAt: '',
})
const portalHealthChecks = ref([])
const portalHref = computed(() => auth.orgId ? `/portal?orgId=${encodeURIComponent(auth.orgId)}` : '/portal')

function openModal() {
  resetForm()
  showModal.value = true
}

function closeModal() {
  showModal.value = false
  createSuccess.value = false
  resetForm()
}

function resetForm() {
  form.firstName = ''
  form.lastName = ''
  form.email = ''
  form.role = ''
  form.phone = ''
  form.licenseNumber = ''
  createError.value = ''
  Object.keys(errors).forEach((key) => delete errors[key])
}

function validateForm() {
  Object.keys(errors).forEach((key) => delete errors[key])
  if (!form.firstName) errors.firstName = 'El nombre es requerido'
  if (!form.lastName) errors.lastName = 'El apellido es requerido'
  if (!form.email) errors.email = 'El email es requerido'
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errors.email = 'Email invalido'
  if (!form.role) errors.role = t('admin.roleRequired')
  return Object.keys(errors).length === 0
}

async function handleCreate() {
  if (!validateForm()) return
  createError.value = ''
  creating.value = true
  try {
    const payload = {
      firstName: form.firstName,
      lastName: form.lastName,
      email: form.email,
      role: form.role,
      branchId: auth.user?.branchId || auth.user?.branch_id || null,
    }
    if (form.phone) payload.phone = form.phone
    if (form.licenseNumber) payload.licenseNumber = form.licenseNumber

    await createAdminUser(payload)
    createSuccess.value = true
    success('Usuario creado correctamente.')
    await loadPage(1)
  } catch (error) {
    const message = extractAdminError(error, 'No se pudo crear el usuario.')
    if (error.response?.status === 409) createError.value = 'Ya existe un usuario con ese email'
    else if (error.response?.status === 400) createError.value = message || 'Datos invalidos. Revisa los campos.'
    else createError.value = message || 'No se pudo crear el usuario. Intenta nuevamente.'
  } finally {
    creating.value = false
  }
}

function confirmDeactivate(user) {
  deactivateTarget.value = user
  deactivateError.value = ''
}

async function handleDeactivate() {
  if (!deactivateTarget.value) return
  deactivateError.value = ''
  deactivating.value = true
  try {
    await deactivateAdminUser(deactivateTarget.value.id)
    deactivateTarget.value = null
    success('Usuario desactivado correctamente.')
    await loadPage(meta.value.page)
  } catch (error) {
    deactivateError.value = extractAdminError(error, 'No se pudo desactivar el usuario.')
  } finally {
    deactivating.value = false
  }
}

async function handleRoleChange(user, role) {
  const current = firstRole(user.roles)
  if (!role || role === current) return
  changingRoleId.value = user.id
  globalError.value = ''
  try {
    await updateAdminUserRole(user.id, role)
    success('Rol actualizado correctamente.')
    await loadPage(meta.value.page)
  } catch (error) {
    globalError.value = extractAdminError(error, 'No se pudo actualizar el rol.')
  } finally {
    changingRoleId.value = null
  }
}

async function loadOverrides() {
  if (!auth.orgId) return
  overrideError.value = ''
  try {
    const payload = await loadOverridesRequest(auth.orgId)
    roleCatalog.value = payload.roleCatalog
    overrides.value = payload.overrides
  } catch (error) {
    overrideError.value = extractAdminError(error, 'No se pudieron cargar los overrides.')
  }
}

async function loadAuthPolicy() {
  authPolicyError.value = ''
  try {
    authPolicy.twoFactorOptionalEnabled = await loadAuthPolicyRequest()
  } catch (error) {
    authPolicyError.value = extractAdminError(error, 'No se pudo cargar la politica de autenticacion.')
  }
}

async function toggleTwoFactorPolicy(enabled) {
  savingAuthPolicy.value = true
  authPolicyError.value = ''
  try {
    await updateAuthPolicyRequest(enabled)
    authPolicy.twoFactorOptionalEnabled = enabled
    success('Politica de autenticacion actualizada.')
  } catch (error) {
    authPolicyError.value = extractAdminError(error, 'No se pudo actualizar la politica de 2FA.')
  } finally {
    savingAuthPolicy.value = false
  }
}

async function loadFeatureFlags() {
  if (!auth.orgId) return
  featureFlagsLoading.value = true
  featureFlagsError.value = ''
  try {
    const { flags, definitions } = await loadFeatureFlagsRequest(auth.orgId)
    for (const key of Object.keys(featureFlags)) delete featureFlags[key]
    for (const [key, value] of Object.entries(flags)) featureFlags[key] = Boolean(value)
    featureDefinitions.value = definitions
    aiFeatures.value = definitions.filter((item) => item.category === 'ai')
  } catch (error) {
    if (error.response?.status === 404) {
      featureDefinitions.value = []
      aiFeatures.value = []
      return
    }
    featureFlagsError.value = extractAdminError(error, 'No se pudieron cargar los feature flags.')
  } finally {
    featureFlagsLoading.value = false
  }
}

async function toggleFeatureFlag(key, enabled) {
  if (!auth.orgId) return
  savingFeatureKey.value = key
  featureFlagsError.value = ''
  const previous = Boolean(featureFlags[key])
  featureFlags[key] = enabled
  try {
    const flags = await updateFeatureFlagsRequest(auth.orgId, { [key]: enabled })
    for (const [flagKey, value] of Object.entries(flags)) featureFlags[flagKey] = Boolean(value)
    success('Feature flag actualizado.')
  } catch (error) {
    featureFlags[key] = previous
    if (error.response?.status === 404) {
      featureFlagsError.value = 'Este ambiente todavia no tiene feature flags desplegados.'
      return
    }
    featureFlagsError.value = extractAdminError(error, 'No se pudo actualizar el feature flag.')
  } finally {
    savingFeatureKey.value = ''
  }
}

async function saveOverride() {
  if (!overrideForm.role) {
    overrideError.value = t('admin.roleRequired')
    return
  }
  savingOverride.value = true
  overrideError.value = ''
  try {
    await saveOverrideRequest(auth.orgId, overrideForm.role, {
      grant: parsePermissions(overrideForm.grant),
      revoke: parsePermissions(overrideForm.revoke),
    })
    overrideForm.role = ''
    overrideForm.grant = ''
    overrideForm.revoke = ''
    success('Override guardado correctamente.')
    await loadOverrides()
  } catch (error) {
    overrideError.value = extractAdminError(error, 'No se pudo guardar el override.')
  } finally {
    savingOverride.value = false
  }
}

async function removeOverride(role) {
  overrideError.value = ''
  const ok = await confirm({
    title: 'Eliminar override',
    message: `Eliminar el override del rol ${formatRole(role)}?`,
    confirmText: 'Eliminar override',
    variant: 'danger',
  })
  if (!ok) return
  try {
    await deleteOverrideRequest(auth.orgId, role)
    success('Override eliminado correctamente.')
    await loadOverrides()
  } catch (error) {
    overrideError.value = extractAdminError(error, 'No se pudo eliminar el override.')
  }
}

async function loadPage(page = 1) {
  loading.value = true
  globalError.value = ''
  try {
    const payload = await listUsersRequest({ page, limit: 20 })
    users.value = payload.rows
    meta.value = payload.meta
  } catch (error) {
    globalError.value = extractAdminError(error, 'No se pudo cargar la lista de usuarios.')
  } finally {
    loading.value = false
  }
}

function initials(user) {
  return [user.first_name?.[0], user.last_name?.[0]].filter(Boolean).join('').toUpperCase()
}

function formatRole(roles) {
  if (!roles) return t('common.none')
  return formatRoleLabel(roles) || t('common.none')
}

function formatDate(iso) {
  if (!iso) return t('common.none')
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatDateTime(iso) {
  if (!iso) return t('common.none')
  return new Date(iso).toLocaleString('es-AR')
}

function formatLatency(ms) {
  if (ms === null || ms === undefined || Number.isNaN(Number(ms))) return '—'
  return `${ms} ms`
}

async function handleLogout() {
  await auth.logout()
  await router.replace('/login')
}

async function loadLogs() {
  loadingLogs.value = true
  logsError.value = ''
  try {
    logs.value = await listLogsRequest()
  } catch (e) {
    logsError.value = extractAdminError(e, 'No se pudieron cargar los logs.')
  } finally {
    loadingLogs.value = false
  }
}

async function loadDbTableList() {
  try {
    dbTableList.value = await loadTableListRequest()
  } catch (error) {
    logError('admin.loadTableList', error)
  }
}

async function loadPortalHealth() {
  portalHealthLoading.value = true
  portalHealthError.value = ''
  try {
    const payload = await loadPortalHealthRequest()
    portalHealth.status = payload.status
    portalHealth.statusLabel = payload.statusLabel
    portalHealth.statusClass = payload.statusClass
    portalHealth.badgeClass = payload.badgeClass
    portalHealth.latency = payload.latency
    portalHealth.source = payload.source
    portalHealth.target = payload.target
    portalHealth.checkedAt = payload.checkedAt
    portalHealthChecks.value = payload.checks
  } catch (error) {
    portalHealthError.value = extractAdminError(error, 'No se pudo cargar el estado del portal.')
  } finally {
    portalHealthLoading.value = false
  }
}

async function loadTablePreview(tableName) {
  if (dbSelectedTable.value === tableName && dbPreview.value) return
  dbSelectedTable.value = tableName
  dbPreview.value = null
  dbError.value = ''
  dbLoading.value = true
  try {
    dbPreview.value = await loadTablePreviewRequest(tableName)
  } catch (e) {
    dbError.value = extractAdminError(e, 'No se pudo cargar la tabla.')
  } finally {
    dbLoading.value = false
  }
}

function formatCellValue(val) {
  if (val === null || val === undefined) return '—'
  if (typeof val === 'object') return JSON.stringify(val)
  const s = String(val)
  return s.length > 60 ? s.slice(0, 57) + '…' : s
}

function logBadgeClass(action) {
  if (!action) return ''
  if (action === 'DELETE') return 'badge--inactive'
  if (action === 'CREATE') return 'badge--active'
  if (action === 'UPDATE') return 'badge--role'
  return ''
}

onMounted(async () => {
  await loadPage()
  await loadAuthPolicy()
  await loadFeatureFlags()
  await loadOverrides()
  await loadPortalHealth()
  await loadLogs()
  if (isSuperAdmin.value) await loadDbTableList()
})
</script>

<style scoped>
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }

.admin {
  display: grid;
  gap: 24px;
}

.hero,
.section-head,
.policy-row,
.rbac-controls,
.modal__header,
.modal__actions,
.table-loading,
.pagination {
  display: flex;
  align-items: center;
}

.hero,
.section-head,
.policy-row {
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.hero__title {
  margin: 0 0 6px;
  font-size: 1.4rem;
  font-weight: 700;
  color: var(--text);
}

.hero__subtitle,
.section-head p,
.policy-help,
.table__date,
.table__email,
.modal__hint,
.hint {
  margin: 0;
  color: var(--text-3);
  font-size: 0.86rem;
}

.panel {
  background: var(--white);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-sm);
  padding: 20px;
}

.panel--stacked {
  display: grid;
  gap: 16px;
}

.portal-health-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr);
  gap: 14px;
}

.portal-health-card {
  border: 1px solid var(--border-light, #eef2f4);
  border-radius: var(--radius);
  padding: 16px;
  background: var(--surface);
  display: grid;
  gap: 12px;
}

.portal-health-card--ok {
  border-color: #d6f2e3;
  background: linear-gradient(180deg, #f7fdf9 0%, #ffffff 100%);
}

.portal-health-card--degraded {
  border-color: #f4e0b2;
  background: linear-gradient(180deg, #fffaf0 0%, #ffffff 100%);
}

.portal-health-card--error {
  border-color: #f3c2c2;
  background: linear-gradient(180deg, #fff7f7 0%, #ffffff 100%);
}

.portal-health-card--unknown {
  border-color: var(--border-light, #eef2f4);
  background: linear-gradient(180deg, #fafbfc 0%, #ffffff 100%);
}

.portal-health-card__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.portal-health-card__service {
  font-family: monospace;
  font-size: 0.76rem;
  color: var(--text-3);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.portal-health-card__headline {
  font-size: 1.02rem;
  color: var(--text);
}

.portal-health-card__copy {
  margin: 0;
  color: var(--text-3);
  font-size: 0.86rem;
  line-height: 1.5;
}

.portal-health-meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin: 0;
}

.portal-health-meta div {
  display: grid;
  gap: 2px;
}

.portal-health-meta dt {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-3);
}

.portal-health-meta dd {
  margin: 0;
  color: var(--text);
  font-weight: 600;
  font-size: 0.88rem;
  word-break: break-word;
}

.portal-health-card--wide {
  align-content: start;
}

.portal-health-checks {
  display: grid;
  gap: 10px;
}

.portal-health-check {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: var(--white);
  border: 1px solid var(--border-light, #eef2f4);
}

.portal-health-check__name {
  font-size: 0.82rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-3);
}

.portal-health-check__value {
  font-size: 0.88rem;
  color: var(--text);
  font-weight: 600;
  text-align: right;
}

.portal-health-empty {
  color: var(--text-3);
  font-size: 0.88rem;
}

.portal-link {
  display: inline-flex;
  align-items: center;
  min-height: 38px;
  padding: 0 14px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--white);
  color: var(--text);
  text-decoration: none;
  font-weight: 600;
}

.portal-link:hover {
  background: var(--surface);
}

.table-loading {
  justify-content: center;
  gap: 12px;
  padding: 48px 16px;
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}

.table th,
.table td {
  padding: 14px 16px;
  text-align: left;
  border-bottom: 1px solid var(--border-light, #eef2f4);
}

.table th {
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-3);
  background: var(--surface);
}

.table__empty {
  padding: 40px 16px !important;
  text-align: center;
  color: var(--text-3);
}

.table__name {
  display: flex;
  align-items: center;
  gap: 10px;
}

.avatar {
  width: 32px;
  height: 32px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--primary) 0%, var(--accent-mint) 100%);
  color: var(--white);
  font-size: 0.72rem;
  font-weight: 700;
}

.badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 0.76rem;
  font-weight: 600;
}

.badge--active {
  background: #eafaf3;
  color: #1e8449;
}

.badge--inactive {
  background: #fdf3f3;
  color: #c0392b;
}

.badge--role {
  background: var(--surface-2, #f4f6f8);
  color: var(--text-2);
}

.role-cell {
  display: grid;
  gap: 8px;
}

.role-select,
.rbac-controls input,
.field input,
.field select {
  width: 100%;
  min-height: 42px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--white);
  color: var(--text);
}

.rbac-controls {
  gap: 12px;
  flex-wrap: wrap;
}

.rbac-controls > * {
  flex: 1 1 220px;
}

.policy-switch {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-weight: 600;
}

.btn-icon {
  width: 34px;
  height: 34px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--danger, #e74c3c);
  cursor: pointer;
}

.btn-icon:hover {
  background: #fdf3f3;
}

.pagination {
  justify-content: center;
  gap: 16px;
  padding: 18px 8px 0;
  color: var(--text-2);
}

.pagination button {
  min-height: 36px;
  padding: 0 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--white);
  color: var(--text-2);
  cursor: pointer;
}

.pagination button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.modal__header {
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 20px;
}

.modal__header h3 {
  margin: 0;
  font-size: 1.05rem;
}

.modal__close {
  width: 36px;
  height: 36px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
}

.modal__close:hover {
  background: var(--surface);
}

.modal__success {
  display: grid;
  gap: 14px;
}

.success-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 999px;
  background: #eafaf3;
  color: #1e8449;
  font-weight: 700;
}

.form-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.field {
  display: grid;
  gap: 8px;
  margin-bottom: 14px;
}

.field label {
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--text);
}

.field-error {
  color: var(--danger, #e74c3c);
  font-size: 0.8rem;
}

.req {
  color: var(--danger, #e74c3c);
}

.modal__actions {
  justify-content: flex-end;
  gap: 12px;
  margin-top: 16px;
}

.confirm-text {
  margin: 0 0 16px;
  color: var(--text);
  line-height: 1.5;
}

.hero__actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.btn-logout {
  min-height: 38px;
  padding: 0 16px;
  border: 1.5px solid var(--danger, #e74c3c);
  border-radius: var(--radius);
  background: transparent;
  color: var(--danger, #e74c3c);
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
  transition: background var(--transition), color var(--transition);
}
.btn-logout:hover {
  background: var(--danger-light, #fdf3f3);
}

.table--logs {
  font-size: 0.82rem;
}

.log-resource {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-ip {
  color: var(--text-3);
  font-size: 0.78rem;
  font-family: monospace;
}

.log-row--danger td {
  background: #fff8f8;
}

.db-table-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.pill {
  padding: 6px 14px;
  border: 1.5px solid var(--border);
  border-radius: 999px;
  background: var(--white);
  color: var(--text-2);
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.pill:hover {
  background: var(--surface);
  border-color: var(--primary);
  color: var(--primary);
}

.pill--active {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--white);
}

.db-table-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 0 4px;
}

.db-table-desc {
  color: var(--text-3);
  font-size: 0.86rem;
}

.db-glossary {
  border: 1px solid var(--border-light, #eef2f4);
  border-radius: var(--radius);
  overflow: hidden;
}

.db-glossary summary {
  padding: 10px 16px;
  font-size: 0.86rem;
  font-weight: 600;
  cursor: pointer;
  background: var(--surface);
  color: var(--text-2);
}

.db-glossary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 1px;
  background: var(--border-light, #eef2f4);
}

.db-col-card {
  background: var(--white);
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.db-col-name {
  font-size: 0.82rem;
  font-weight: 700;
  font-family: monospace;
  color: var(--text);
  display: flex;
  align-items: center;
  gap: 8px;
}

.db-col-type {
  font-weight: 400;
  font-size: 0.75rem;
  color: var(--text-3);
  background: var(--surface-2, #f4f6f8);
  padding: 1px 6px;
  border-radius: 4px;
}

.db-col-desc {
  font-size: 0.8rem;
  color: var(--text-2);
  line-height: 1.4;
}

.db-records-label {
  font-size: 0.82rem;
  color: var(--text-3);
  margin: 12px 0 6px;
}

.db-records-wrap {
  overflow: hidden;
}

.table-scroll {
  overflow-x: auto;
}

.table--sm th,
.table--sm td {
  padding: 8px 12px;
  font-size: 0.8rem;
  white-space: nowrap;
}

.db-cell {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-2);
}

.feature-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 14px;
}

.feature-card {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
  border: 1px solid var(--border-light, #eef2f4);
  border-radius: var(--radius);
  background: var(--surface);
}

.feature-card__body {
  display: grid;
  gap: 6px;
}

.feature-card__body p {
  margin: 0;
  color: var(--text-3);
  font-size: 0.84rem;
  line-height: 1.45;
}

.feature-card__key {
  font-family: monospace;
  font-size: 0.78rem;
  color: var(--text-3);
}

@media (max-width: 900px) {
  .table {
    min-width: 760px;
  }

  .portal-health-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .form-row {
    grid-template-columns: 1fr;
  }

  .panel {
    padding: 16px;
  }

  .modal__actions {
    flex-direction: column-reverse;
    align-items: stretch;
  }
}
</style>
