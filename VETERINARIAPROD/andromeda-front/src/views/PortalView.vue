<template>
  <div class="portal-shell">
    <section class="portal-hero">
      <div class="portal-hero__copy">
        <p class="eyebrow">Portal de dueños</p>
        <h1>Gestioná mascotas, turnos y pagos desde una sola sesión</h1>
        <p class="hero-copy">
          Interfaz operativa del dueño de mascota con login propio, historial de animales,
          turnos, facturas, notificaciones y telemedicina.
        </p>
        <div class="hero-chips">
          <span>Sesion propia</span>
          <span>Mascotas</span>
          <span>Turnos</span>
          <span>Facturas</span>
          <span>Notificaciones</span>
        </div>
      </div>

      <div class="portal-hero__status card">
        <template v-if="isAuthenticated">
          <div class="status-pill status-pill--ok">Sesion activa</div>
          <h2>{{ ownerLabel }}</h2>
          <p>{{ sessionSummary }}</p>
          <div class="status-grid">
            <div>
              <strong>{{ pets.length }}</strong>
              <span>Mascotas</span>
            </div>
            <div>
              <strong>{{ appointments.length }}</strong>
              <span>Turnos</span>
            </div>
            <div>
              <strong>{{ invoices.length }}</strong>
              <span>Facturas</span>
            </div>
            <div>
              <strong>{{ unreadNotifications }}</strong>
              <span>Sin leer</span>
            </div>
          </div>
          <button class="ghost-button" @click="refreshAll" :disabled="loading">
            {{ loading ? 'Actualizando...' : 'Actualizar' }}
          </button>
        </template>

        <template v-else>
          <div class="status-pill">Acceso del dueño</div>
          <h2>Ingresa o crea tu cuenta</h2>
          <p>Usa este portal para gestionar la experiencia del cliente sin depender del panel interno.</p>
          <div class="status-grid">
            <div>
              <strong>1</strong>
              <span>Login</span>
            </div>
            <div>
              <strong>2</strong>
              <span>Mascotas</span>
            </div>
            <div>
              <strong>3</strong>
              <span>Turnos</span>
            </div>
            <div>
              <strong>4</strong>
              <span>Pagos</span>
            </div>
          </div>
        </template>
      </div>
    </section>

    <section v-if="notice" class="notice notice--success">
      {{ notice }}
    </section>
    <section v-if="errorMessage" class="notice notice--error">
      {{ errorMessage }}
    </section>

    <section v-if="!isAuthenticated" class="auth-grid">
      <div class="card auth-card">
        <div class="tab-row">
          <button
            v-for="tab in authTabs"
            :key="tab.key"
            :class="['tab-button', { 'tab-button--active': authMode === tab.key }]"
            @click="authMode = tab.key"
          >
            {{ tab.label }}
          </button>
        </div>

        <form v-if="authMode === 'login'" class="form-grid" @submit.prevent="handleLogin">
          <label for="portal-login-email">
            <span>Email</span>
            <input id="portal-login-email" name="portal-login-email" v-model.trim="loginForm.email" type="email" autocomplete="email" required />
          </label>
          <label for="portal-login-password">
            <span>Contraseña</span>
            <input id="portal-login-password" name="portal-login-password" v-model="loginForm.password" type="password" autocomplete="current-password" required />
          </label>
          <button class="primary-button" type="submit" :disabled="authBusy">
            {{ authBusy ? 'Ingresando...' : 'Entrar al portal' }}
          </button>
        </form>

        <form v-else-if="authMode === 'register'" class="form-grid" @submit.prevent="handleRegister">
          <div class="two-cols">
            <label for="portal-register-first-name">
              <span>Nombre</span>
              <input id="portal-register-first-name" name="portal-register-first-name" v-model.trim="registerForm.firstName" type="text" autocomplete="given-name" required />
            </label>
            <label for="portal-register-last-name">
              <span>Apellido</span>
              <input id="portal-register-last-name" name="portal-register-last-name" v-model.trim="registerForm.lastName" type="text" autocomplete="family-name" required />
            </label>
          </div>
          <label for="portal-register-email">
            <span>Email</span>
            <input id="portal-register-email" name="portal-register-email" v-model.trim="registerForm.email" type="email" autocomplete="email" required />
          </label>
          <label for="portal-register-phone">
            <span>Telefono</span>
            <input id="portal-register-phone" name="portal-register-phone" v-model.trim="registerForm.phone" type="tel" autocomplete="tel" />
          </label>
          <label for="portal-register-password">
            <span>Contraseña</span>
            <input id="portal-register-password" name="portal-register-password" v-model="registerForm.password" type="password" autocomplete="new-password" required />
          </label>
          <button class="primary-button" type="submit" :disabled="authBusy">
            {{ authBusy ? 'Creando cuenta...' : 'Crear cuenta' }}
          </button>
        </form>

        <form v-else class="form-grid" @submit.prevent="handleForgotPassword">
          <label for="portal-forgot-email">
            <span>Email</span>
            <input id="portal-forgot-email" name="portal-forgot-email" v-model.trim="forgotForm.email" type="email" autocomplete="email" required />
          </label>
          <button class="primary-button" type="submit" :disabled="authBusy">
            {{ authBusy ? 'Enviando...' : 'Solicitar recuperacion' }}
          </button>
        </form>
      </div>

      <div class="card info-card">
        <h3>Qué puede hacer el dueño</h3>
        <ul class="bullet-list">
          <li>Ver mascotas, fichas resumidas e historial medico firmado.</li>
          <li>Solicitar, cancelar y seguir turnos desde la misma sesión.</li>
          <li>Revisar facturas y generar pagos con MercadoPago.</li>
          <li>Ver notificaciones y sesiones de telemedicina.</li>
          <li>Registrar FCM para recibir push en el dispositivo.</li>
        </ul>
      </div>
    </section>

    <section v-else class="dashboard-grid">
      <div class="card profile-banner">
        <div>
          <p class="eyebrow">Bienvenido</p>
          <h2>{{ ownerLabel }}</h2>
          <p class="banner-copy">
            {{ profileSummary }}
          </p>
        </div>
        <div class="banner-actions">
          <button class="ghost-button" @click="refreshAll" :disabled="loading">
            {{ loading ? 'Actualizando...' : 'Sincronizar portal' }}
          </button>
          <button class="danger-button" @click="handleLogout">Cerrar sesión</button>
        </div>
      </div>

      <div class="stats-grid">
        <div class="card stat-card">
          <span>Mascotas</span>
          <strong>{{ pets.length }}</strong>
          <small>Activas y asociadas a la cuenta</small>
        </div>
        <div class="card stat-card">
          <span>Turnos</span>
          <strong>{{ appointments.length }}</strong>
          <small>Solicitudes y citas recientes</small>
        </div>
        <div class="card stat-card">
          <span>Facturas</span>
          <strong>{{ invoices.length }}</strong>
          <small>Documentos y saldos pendientes</small>
        </div>
        <div class="card stat-card">
          <span>Telemedicina</span>
          <strong>{{ telemedicine.length }}</strong>
          <small>Sesiones y enlaces disponibles</small>
        </div>
      </div>

      <div class="content-grid">
        <section class="card">
          <div class="section-head">
            <h3>Mascotas</h3>
            <span class="section-hint">Selecciona una mascota para ver su historial.</span>
          </div>

          <div class="pet-grid">
            <button
              v-for="pet in pets"
              :key="pet.id"
              class="pet-card"
              :class="{ 'pet-card--active': selectedPet?.id === pet.id }"
              @click="selectPet(pet)"
            >
              <div class="pet-card__top">
                <strong>{{ pet.name }}</strong>
                <span>{{ pet.species || 'Mascota' }}</span>
              </div>
              <p>{{ pet.breed || 'Sin raza registrada' }}</p>
              <small>{{ pet.microchip_number || 'Sin microchip' }}</small>
            </button>
          </div>

          <div v-if="selectedPet" class="selected-pet">
            <div class="section-head">
              <h4>{{ selectedPet.name }}</h4>
              <span>{{ selectedPet.species }} {{ selectedPet.breed ? `- ${selectedPet.breed}` : '' }}</span>
            </div>

            <div class="detail-grid">
              <div>
                <span>Fecha de nacimiento</span>
                <strong>{{ formatDate(selectedPet.birth_date) }}</strong>
              </div>
              <div>
                <span>Sexo</span>
                <strong>{{ selectedPet.sex || 'Sin dato' }}</strong>
              </div>
              <div>
                <span>Color</span>
                <strong>{{ selectedPet.color || 'Sin dato' }}</strong>
              </div>
              <div>
                <span>Microchip</span>
                <strong>{{ selectedPet.microchip_number || 'Sin dato' }}</strong>
              </div>
            </div>

            <div class="subgrid">
              <div>
                <h5>Historia medica</h5>
                <div v-if="petHistory.length" class="mini-list">
                  <article v-for="row in petHistory" :key="row.id" :id="`portal-history-${row.id}`">
                    <strong :id="`portal-history-${row.id}-date`">{{ formatDate(row.visit_date) }}</strong>
                    <p :id="`portal-history-${row.id}-reason`">{{ row.reason_for_visit || row.chief_complaint || 'Sin detalle' }}</p>
                    <small v-if="row.weight_kg || row.temperature_celsius" :id="`portal-history-${row.id}-vitals`">
                      {{ [row.weight_kg ? `${row.weight_kg} kg` : null, row.temperature_celsius ? `${row.temperature_celsius}°C` : null].filter(Boolean).join(' · ') }}
                    </small>
                    <small :id="`portal-history-${row.id}-vet`">{{ row.vet_name || 'Equipo medico' }}</small>
                    <span v-if="row.status" :id="`portal-history-${row.id}-status`" class="status-pill">{{ row.status }}</span>
                  </article>
                </div>
                <p v-else class="empty-state">No hay historia disponible.</p>
              </div>

              <div>
                <h5>Vacunaciones</h5>
                <div v-if="petVaccinations.length" class="mini-list">
                  <article v-for="row in petVaccinations" :key="row.id" :id="`portal-vaccination-${row.id}`">
                    <strong :id="`portal-vaccination-${row.id}-name`">{{ row.vaccine_name }}</strong>
                    <p :id="`portal-vaccination-${row.id}-date`">{{ formatDate(row.administered_date) }} - {{ row.applied_by || 'Sin profesional' }}</p>
                    <small :id="`portal-vaccination-${row.id}-next`">Proxima: {{ formatDate(row.next_due_date) }}</small>
                    <small v-if="row.lot_number" :id="`portal-vaccination-${row.id}-lot`">Lote: {{ row.lot_number }}</small>
                    <small v-if="row.manufacturer" :id="`portal-vaccination-${row.id}-manufacturer`">{{ row.manufacturer }}</small>
                  </article>
                </div>
                <p v-else class="empty-state">No hay vacunaciones cargadas.</p>
              </div>

              <div>
                <h5>Prescripciones</h5>
                <div v-if="petPrescriptions.length" class="mini-list">
                  <article v-for="row in petPrescriptions" :key="row.id" :id="`portal-prescription-${row.id}`">
                    <strong :id="`portal-prescription-${row.id}-name`">{{ row.medication_name || 'Receta' }}</strong>
                    <p v-if="row.dosage || row.frequency" :id="`portal-prescription-${row.id}-dosage`">
                      {{ [row.dosage, row.frequency].filter(Boolean).join(' — ') }}<span v-if="row.duration_days"> · {{ row.duration_days }} días</span>
                    </p>
                    <p :id="`portal-prescription-${row.id}-instructions`">{{ row.instructions || 'Sin instrucciones' }}</p>
                    <small :id="`portal-prescription-${row.id}-professional`">{{ row.prescribed_by || 'Sin profesional' }}</small>
                    <small v-if="row.refills_allowed != null" :id="`portal-prescription-${row.id}-refills`">Recargas permitidas: {{ row.refills_allowed }}</small>
                  </article>
                </div>
                <p v-else class="empty-state">No hay prescripciones cargadas.</p>
              </div>
            </div>
          </div>
        </section>

        <section class="card">
          <div class="section-head">
            <h3>Solicitar turno</h3>
            <span class="section-hint">Crealo para la mascota seleccionada.</span>
          </div>

          <form class="form-grid" @submit.prevent="createAppointment">
            <label for="portal-appointment-patient">
              <span>Mascota</span>
              <select id="portal-appointment-patient" name="portal-appointment-patient" v-model="appointmentForm.patientId" required>
                <option value="" disabled>Selecciona una mascota</option>
                <option v-for="pet in pets" :key="pet.id" :value="pet.id">{{ pet.name }}</option>
              </select>
            </label>
            <div class="two-cols">
              <label for="portal-appointment-date">
                <span>Fecha y hora</span>
                <input id="portal-appointment-date" name="portal-appointment-date" v-model="appointmentForm.appointmentDate" type="datetime-local" required />
              </label>
              <label for="portal-appointment-branch">
                <span>Sucursal</span>
                <input id="portal-appointment-branch" name="portal-appointment-branch" v-model.trim="appointmentForm.branchId" type="text" placeholder="Opcional" />
              </label>
            </div>
            <label for="portal-appointment-reason">
              <span>Motivo</span>
              <input id="portal-appointment-reason" name="portal-appointment-reason" v-model.trim="appointmentForm.reason" type="text" required />
            </label>
            <label for="portal-appointment-notes">
              <span>Notas</span>
              <textarea id="portal-appointment-notes" name="portal-appointment-notes" v-model.trim="appointmentForm.notes" rows="3" placeholder="Opcional"></textarea>
            </label>
            <button class="primary-button" type="submit" :disabled="portalBusy === 'appointment'">
              {{ portalBusy === 'appointment' ? 'Enviando...' : 'Solicitar turno' }}
            </button>
          </form>

          <div class="list-block">
            <article v-for="item in appointments" :key="item.id" :id="`portal-appointment-item-${item.id}`" class="list-item">
              <div>
                <strong :id="`portal-appointment-item-${item.id}-patient`">{{ item.patient_name }}</strong>
                <p :id="`portal-appointment-item-${item.id}-date`">{{ formatDateTime(item.appointment_date) }} - {{ item.clinic_name || 'Clinica' }}</p>
              </div>
              <div class="list-item__right">
                <span class="status-pill" :class="statusClass(item.status)">{{ item.status }}</span>
                <button
                  v-if="['requested', 'confirmed'].includes(item.status)"
                  class="ghost-button"
                  @click="cancelAppointment(item)"
                >
                  Cancelar
                </button>
              </div>
            </article>
            <p v-if="!appointments.length" class="empty-state">No hay turnos registrados.</p>
          </div>
        </section>
      </div>

      <div class="content-grid content-grid--wide">
        <section class="card">
          <div class="section-head">
            <h3>Facturas</h3>
            <span class="section-hint">Consulta el saldo y genera pago.</span>
          </div>

          <div class="list-block">
            <article v-for="invoice in invoices" :key="invoice.id" :id="`portal-invoice-${invoice.id}`" class="invoice-row">
              <div>
                <strong :id="`portal-invoice-${invoice.id}-number`">{{ invoice.invoice_number }}</strong>
                <p :id="`portal-invoice-${invoice.id}-patient`">{{ invoice.patient_name || 'Mascota no asociada' }} - {{ invoice.clinic_name }}</p>
                <small :id="`portal-invoice-${invoice.id}-dates`">{{ formatDate(invoice.issued_date) }} - Vence {{ formatDate(invoice.due_date) }}</small>
              </div>
              <div class="invoice-row__right">
                <span>{{ formatMoney(invoice.total_amount - (invoice.paid_amount || 0), invoice.currency) }}</span>
                <button class="primary-button primary-button--soft" @click="payInvoice(invoice)">
                  Pagar
                </button>
                <a
                  v-if="invoicePaymentLinks[invoice.id] && isSafeUrl(invoicePaymentLinks[invoice.id])"
                  class="ghost-button"
                  :href="invoicePaymentLinks[invoice.id]"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Abrir pago
                </a>
              </div>
            </article>
            <p v-if="!invoices.length" class="empty-state">No hay facturas registradas.</p>
          </div>
        </section>

        <section class="card">
          <div class="section-head">
            <h3>Notificaciones</h3>
            <span class="section-hint">Marcá como leídas las que ya revisaste.</span>
          </div>

          <div class="list-block">
            <article v-for="note in notifications" :key="note.id" class="list-item">
              <div>
                <strong>{{ note.title || note.notification_type || 'Notificacion' }}</strong>
                <p>{{ note.message }}</p>
                <small>{{ formatDateTime(note.sent_at) }}</small>
              </div>
              <button
                v-if="!note.read_at"
                class="ghost-button"
                @click="markNotification(note)"
              >
                Marcar leída
              </button>
              <span v-else class="status-pill">Leida</span>
            </article>
            <p v-if="!notifications.length" class="empty-state">No hay notificaciones.</p>
          </div>
        </section>
      </div>

      <div class="content-grid content-grid--wide">
        <section class="card">
          <div class="section-head">
            <h3>Telemedicina</h3>
            <span class="section-hint">Sesiones disponibles para consulta remota.</span>
          </div>

          <div class="list-block">
            <article v-for="session in telemedicine" :key="session.id" class="list-item">
              <div>
                <strong>{{ session.patient_name }}</strong>
                <p>{{ formatDateTime(session.session_date) }} - {{ session.vet_name || 'Profesional' }}</p>
                <small>{{ session.status }} - {{ session.session_type || 'telemedicina' }}</small>
              </div>
              <a v-if="session.meeting_url && isSafeUrl(session.meeting_url)" class="ghost-button" :href="session.meeting_url" target="_blank" rel="noopener noreferrer">
                Abrir sala
              </a>
            </article>
            <p v-if="!telemedicine.length" class="empty-state">No hay sesiones de telemedicina.</p>
          </div>
        </section>

        <section class="card">
          <div class="section-head">
            <h3>Mi perfil</h3>
            <span class="section-hint">Actualiza tus datos y la clave de acceso.</span>
          </div>

          <form class="form-grid" @submit.prevent="saveProfile">
            <div class="two-cols">
              <label for="portal-profile-first-name">
                <span>Nombre</span>
                <input id="portal-profile-first-name" name="portal-profile-first-name" v-model.trim="profileForm.firstName" type="text" required />
              </label>
              <label for="portal-profile-last-name">
                <span>Apellido</span>
                <input id="portal-profile-last-name" name="portal-profile-last-name" v-model.trim="profileForm.lastName" type="text" required />
              </label>
            </div>
            <div class="two-cols">
              <label for="portal-profile-phone">
                <span>Telefono</span>
                <input id="portal-profile-phone" name="portal-profile-phone" v-model.trim="profileForm.phone" type="tel" />
              </label>
              <label for="portal-profile-city">
                <span>Ciudad</span>
                <input id="portal-profile-city" name="portal-profile-city" v-model.trim="profileForm.city" type="text" />
              </label>
            </div>
            <label for="portal-profile-address">
              <span>Direccion</span>
              <input id="portal-profile-address" name="portal-profile-address" v-model.trim="profileForm.address" type="text" />
            </label>
            <button class="primary-button" type="submit" :disabled="portalBusy === 'profile'">
              {{ portalBusy === 'profile' ? 'Guardando...' : 'Guardar perfil' }}
            </button>
          </form>

          <form class="form-grid form-grid--spaced" @submit.prevent="changePassword">
            <h4>Cambiar contraseña</h4>
            <label for="portal-password-current">
              <span>Contraseña actual</span>
              <input id="portal-password-current" name="portal-password-current" v-model="passwordForm.currentPassword" type="password" required />
            </label>
            <label for="portal-password-new">
              <span>Nueva contraseña</span>
              <input id="portal-password-new" name="portal-password-new" v-model="passwordForm.newPassword" type="password" required />
            </label>
            <button class="primary-button primary-button--soft" type="submit" :disabled="portalBusy === 'password'">
              {{ portalBusy === 'password' ? 'Actualizando...' : 'Actualizar contraseña' }}
            </button>
          </form>
        </section>
      </div>

      <section class="card">
        <div class="section-head">
          <h3>Push / FCM</h3>
          <span class="section-hint">Registra el token del navegador o del dispositivo.</span>
        </div>

        <form class="form-grid" @submit.prevent="registerFcm">
          <div class="two-cols">
            <label for="portal-fcm-token">
              <span>Token</span>
              <input id="portal-fcm-token" name="portal-fcm-token" v-model.trim="fcmForm.token" type="text" required />
            </label>
            <label for="portal-fcm-platform">
              <span>Plataforma</span>
              <select id="portal-fcm-platform" name="portal-fcm-platform" v-model="fcmForm.platform">
                <option value="web">Web</option>
                <option value="android">Android</option>
                <option value="ios">iOS</option>
              </select>
            </label>
          </div>
          <label for="portal-fcm-device-name">
            <span>Nombre del dispositivo</span>
            <input id="portal-fcm-device-name" name="portal-fcm-device-name" v-model.trim="fcmForm.deviceName" type="text" placeholder="Ej: Chrome en notebook" />
          </label>
          <button class="primary-button" type="submit" :disabled="portalBusy === 'fcm'">
            {{ portalBusy === 'fcm' ? 'Registrando...' : 'Registrar push' }}
          </button>
        </form>
      </section>
    </section>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { portalApi } from '../api/portal'
import {
  authTabs,
  cancelPortalAppointment,
  clearPortalViewSessionState,
  createPortalAppointment,
  createPortalPayment,
  extractPortalError,
  formatPortalDate,
  formatPortalDateTime,
  formatPortalMoney,
  loadPortalDashboard,
  loadPortalPetBundle,
  loginPortalOwner,
  logPortalViewError,
  markPortalNotificationAsRead,
  ownerLabelFrom,
  portalStatusClass,
  profileSummaryFrom,
  registerPortalFcmDevice,
  registerPortalOwner,
  requestPortalPasswordReset,
  savePortalProfile,
  sessionSummaryFrom,
  updatePortalPassword,
} from '../composables/portal/usePortalDomain'

const authMode = ref('login')
const authBusy = ref(false)
const loading = ref(false)
const portalBusy = ref('')
const notice = ref('')
const errorMessage = ref('')

const session = ref(portalApi.getSession())
const unsubscribePortalSession = portalApi.subscribeSession((nextSession) => {
  session.value = nextSession
})
const owner = ref(session.value.owner || null)
const profile = ref(null)

const pets = ref([])
const appointments = ref([])
const invoices = ref([])
const notifications = ref([])
const telemedicine = ref([])
const selectedPet = ref(null)
const petHistory = ref([])
const petVaccinations = ref([])
const petPrescriptions = ref([])
const invoicePaymentLinks = reactive({})

const loginForm = reactive({
  email: '',
  password: '',
})

const registerForm = reactive({
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  password: '',
})

const forgotForm = reactive({
  email: '',
})

const appointmentForm = reactive({
  patientId: '',
  appointmentDate: '',
  branchId: '',
  reason: '',
  notes: '',
})

const profileForm = reactive({
  firstName: '',
  lastName: '',
  phone: '',
  address: '',
  city: '',
})

const passwordForm = reactive({
  currentPassword: '',
  newPassword: '',
})

const fcmForm = reactive({
  token: '',
  platform: 'web',
  deviceName: '',
})

const isAuthenticated = computed(() => Boolean(session.value.accessToken))
const ownerLabel = computed(() => ownerLabelFrom(profile.value, owner.value, session.value.owner))
const sessionSummary = computed(() => sessionSummaryFrom(profile.value, owner.value, session.value.owner))
const profileSummary = computed(() => profileSummaryFrom(profile.value))
const unreadNotifications = computed(() => notifications.value.filter((item) => !item.read_at).length)

function resetMessage() {
  notice.value = ''
  errorMessage.value = ''
}

function showSuccess(message) {
  notice.value = message
  errorMessage.value = ''
}

function showError(error, fallback) {
  errorMessage.value = extractPortalError(error, fallback)
  notice.value = ''
  logPortalViewError('portal.view', error)
}

function showValidation(message) {
  errorMessage.value = message
  notice.value = ''
}

function isSafeUrl(url) {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function formatDate(value) {
  return formatPortalDate(value)
}

function formatDateTime(value) {
  return formatPortalDateTime(value)
}

function formatMoney(amount, currency = 'ARS') {
  return formatPortalMoney(amount, currency)
}

function statusClass(status) {
  return portalStatusClass(status)
}

function syncSession(nextSession) {
  session.value = portalApi.setSession(nextSession)
  owner.value = session.value.owner || owner.value
}

async function loadDashboard() {
  if (!isAuthenticated.value) return
  loading.value = true
  resetMessage()
  try {
    const payload = await loadPortalDashboard()

    profile.value = payload.profile
    owner.value = { ...owner.value, ...profile.value }
    pets.value = payload.pets
    appointments.value = payload.appointments
    invoices.value = payload.invoices
    notifications.value = payload.notifications
    telemedicine.value = payload.telemedicine

    if (pets.value.length) {
      await selectPet(pets.value[0], { quiet: true })
    } else {
      selectedPet.value = null
      petHistory.value = []
      petVaccinations.value = []
      petPrescriptions.value = []
    }

    if (profile.value) {
      profileForm.firstName = profile.value.first_name || profile.value.firstName || ''
      profileForm.lastName = profile.value.last_name || profile.value.lastName || ''
      profileForm.phone = profile.value.phone || ''
      profileForm.address = profile.value.address || ''
      profileForm.city = profile.value.city || ''
    }
    if (appointmentForm.patientId || pets.value[0]) {
      appointmentForm.patientId = appointmentForm.patientId || pets.value[0]?.id || ''
    }
  } catch (error) {
    showError(error, 'No se pudo cargar el portal')
  } finally {
    loading.value = false
  }
}

async function selectPet(pet, { quiet = false } = {}) {
  const candidate = pet && pet.id ? pet : pets.value.find((item) => item.id === pet)
  if (!candidate) return
  selectedPet.value = candidate
  appointmentForm.patientId = candidate.id
  if (!quiet) resetMessage()
  portalBusy.value = 'pet'
  try {
    const bundle = await loadPortalPetBundle(candidate.id)
    selectedPet.value = bundle.pet || candidate
    petHistory.value = bundle.history
    petVaccinations.value = bundle.vaccinations
    petPrescriptions.value = bundle.prescriptions
  } catch (error) {
    if (!quiet) showError(error, 'No se pudo cargar la mascota')
  } finally {
    portalBusy.value = ''
  }
}

async function handleLogin() {
  if (!loginForm.email || !loginForm.password) {
    showValidation('Ingresá email y contraseña para acceder.')
    return
  }
  authBusy.value = true
  resetMessage()
  try {
    const payload = await loginPortalOwner(loginForm)
    syncSession({
      accessToken: payload.accessToken,
      refreshToken: payload.refreshToken,
      owner: payload.owner || null,
    })
    await loadDashboard()
    showSuccess('Sesion iniciada correctamente')
  } catch (error) {
    showError(error, 'No se pudo iniciar sesión')
  } finally {
    authBusy.value = false
  }
}

async function handleRegister() {
  if (!registerForm.firstName || !registerForm.lastName || !registerForm.email || !registerForm.password) {
    showValidation('Completá nombre, apellido, email y contraseña.')
    return
  }
  authBusy.value = true
  resetMessage()
  try {
    const payload = await registerPortalOwner(registerForm)
    syncSession({
      accessToken: payload.accessToken,
      refreshToken: payload.refreshToken,
      owner: { firstName: registerForm.firstName, lastName: registerForm.lastName, email: registerForm.email },
    })
    await loadDashboard()
    showSuccess('Cuenta creada y sesión iniciada')
  } catch (error) {
    showError(error, 'No se pudo crear la cuenta')
  } finally {
    authBusy.value = false
  }
}

async function handleForgotPassword() {
  if (!forgotForm.email) {
    showValidation('Ingresá el email de la cuenta.')
    return
  }
  authBusy.value = true
  resetMessage()
  try {
    const payload = await requestPortalPasswordReset(forgotForm.email)
    showSuccess(payload?.message || 'Si el email existe, recibira un enlace de recuperacion')
  } catch (error) {
    showError(error, 'No se pudo enviar la recuperacion')
  } finally {
    authBusy.value = false
  }
}

async function createAppointment() {
  if (!appointmentForm.patientId) {
    showValidation('Seleccioná una mascota antes de solicitar un turno.')
    return
  }
  if (!appointmentForm.appointmentDate || !appointmentForm.reason) {
    showValidation('Completá fecha, hora y motivo del turno.')
    return
  }

  portalBusy.value = 'appointment'
  resetMessage()
  try {
    const payload = await createPortalAppointment(appointmentForm)
    showSuccess(payload?.message || 'Solicitud de turno enviada')
    appointmentForm.reason = ''
    appointmentForm.notes = ''
    await loadDashboard()
  } catch (error) {
    showError(error, 'No se pudo solicitar el turno')
  } finally {
    portalBusy.value = ''
  }
}

async function cancelAppointment(item) {
  portalBusy.value = `cancel-${item.id}`
  resetMessage()
  try {
    await cancelPortalAppointment(item.id)
    showSuccess('Turno cancelado')
    await loadDashboard()
  } catch (error) {
    showError(error, 'No se pudo cancelar el turno')
  } finally {
    portalBusy.value = ''
  }
}

async function payInvoice(invoice) {
  portalBusy.value = `invoice-${invoice.id}`
  resetMessage()
  try {
    const payload = await createPortalPayment(invoice.id)
    const link = payload?.init_point || payload?.sandbox_init_point || payload?.url || null
    if (link) {
      invoicePaymentLinks[invoice.id] = link
      showSuccess('Se genero el enlace de pago')
    } else {
      showSuccess('Pago solicitado')
    }
  } catch (error) {
    showError(error, 'No se pudo generar el pago')
  } finally {
    portalBusy.value = ''
  }
}

async function markNotification(note) {
  portalBusy.value = `notification-${note.id}`
  resetMessage()
  try {
    await markPortalNotificationAsRead(note.id)
    showSuccess('Notificación marcada como leída')
    await loadDashboard()
  } catch (error) {
    showError(error, 'No se pudo actualizar la notificación')
  } finally {
    portalBusy.value = ''
  }
}

async function saveProfile() {
  if (!profileForm.firstName || !profileForm.lastName) {
    showValidation('Completá nombre y apellido del perfil.')
    return
  }
  portalBusy.value = 'profile'
  resetMessage()
  try {
    await savePortalProfile(profileForm)
    showSuccess('Perfil actualizado')
    await loadDashboard()
  } catch (error) {
    showError(error, 'No se pudo guardar el perfil')
  } finally {
    portalBusy.value = ''
  }
}

async function changePassword() {
  if (!passwordForm.currentPassword || !passwordForm.newPassword) {
    showValidation('Completá la contraseña actual y la nueva.')
    return
  }
  portalBusy.value = 'password'
  resetMessage()
  try {
    await updatePortalPassword(passwordForm)
    passwordForm.currentPassword = ''
    passwordForm.newPassword = ''
    showSuccess('Contraseña actualizada')
  } catch (error) {
    showError(error, 'No se pudo actualizar la contraseña')
  } finally {
    portalBusy.value = ''
  }
}

async function registerFcm() {
  if (!fcmForm.token) {
    showValidation('Ingresá el token del dispositivo.')
    return
  }
  portalBusy.value = 'fcm'
  resetMessage()
  try {
    await registerPortalFcmDevice(fcmForm)
    fcmForm.token = ''
    fcmForm.deviceName = ''
    showSuccess('Dispositivo registrado para push')
  } catch (error) {
    showError(error, 'No se pudo registrar el dispositivo')
  } finally {
    portalBusy.value = ''
  }
}

function handleLogout() {
  clearPortalViewSessionState({
    session,
    owner,
    profile,
    pets,
    appointments,
    invoices,
    notifications,
    telemedicine,
    selectedPet,
    petHistory,
    petVaccinations,
    petPrescriptions,
    notice,
    errorMessage,
  })
}

async function refreshAll() {
  if (!isAuthenticated.value) return
  loading.value = true
  resetMessage()
  try {
    await portalApi.refresh()
    await loadDashboard()
    showSuccess('Portal sincronizado')
  } catch (error) {
    showError(error, 'No se pudo refrescar la sesión')
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  if (isAuthenticated.value) {
    await loadDashboard()
  }
})

onBeforeUnmount(unsubscribePortalSession)
</script>

<style scoped>
.portal-shell {
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-height: 100%;
  background:
    radial-gradient(circle at top left, rgba(26, 158, 127, 0.12), transparent 30%),
    radial-gradient(circle at right 20%, rgba(255, 183, 3, 0.08), transparent 26%),
    var(--bg);
}

.portal-hero {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(320px, 0.9fr);
  gap: 18px;
}

.portal-hero__copy,
.portal-hero__status,
.card {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  background: var(--surface);
}

.portal-hero__copy {
  padding: 28px;
  background: linear-gradient(135deg, #f8fcfb 0%, #edf7f1 100%);
}

.eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.18em;
  font-size: 0.76rem;
  color: var(--text-3);
  margin-bottom: 10px;
}

.portal-hero h1 {
  font-size: clamp(1.9rem, 4vw, 3rem);
  line-height: 1.05;
  max-width: 14ch;
}

.hero-copy {
  margin-top: 14px;
  max-width: 64ch;
  color: var(--text-2);
  line-height: 1.65;
}

.hero-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 18px;
}

.hero-chips span,
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  padding: 8px 12px;
  background: var(--primary-xlight);
  color: var(--primary);
  font-size: 0.82rem;
  font-weight: 700;
}

.status-pill--ok {
  background: rgba(6, 214, 160, 0.14);
  color: #0f8f6f;
}

.status-pill--warn {
  background: rgba(255, 183, 3, 0.14);
  color: #8c6100;
}

.status-pill--bad {
  background: rgba(239, 83, 80, 0.14);
  color: #b02825;
}

.portal-hero__status {
  padding: 22px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.portal-hero__status h2 {
  font-size: 1.4rem;
}

.portal-hero__status p {
  color: var(--text-2);
  line-height: 1.6;
}

.status-grid,
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.status-grid div,
.stat-card {
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--bg);
  padding: 12px;
}

.status-grid strong,
.stat-card strong {
  display: block;
  font-size: 1.15rem;
}

.status-grid span,
.stat-card span,
.stat-card small {
  color: var(--text-2);
  font-size: 0.82rem;
}

.ghost-button,
.primary-button,
.danger-button {
  border: none;
  border-radius: var(--radius);
  padding: 11px 14px;
  font-weight: 700;
  cursor: pointer;
  transition: transform var(--transition), background var(--transition), color var(--transition), opacity var(--transition);
}

.ghost-button {
  background: var(--surface-2);
  color: var(--primary);
}

.primary-button {
  background: linear-gradient(135deg, var(--primary) 0%, var(--primary-hover) 100%);
  color: var(--white);
}

.primary-button--soft {
  background: rgba(26, 158, 127, 0.12);
  color: var(--primary);
}

.danger-button {
  background: var(--danger-light);
  color: var(--danger);
}

.ghost-button:hover,
.primary-button:hover,
.danger-button:hover,
.tab-button:hover,
.pet-card:hover {
  transform: translateY(-1px);
}

.auth-grid,
.dashboard-grid {
  display: grid;
  gap: 18px;
}

.auth-grid {
  grid-template-columns: minmax(0, 1.2fr) minmax(280px, 0.8fr);
}

.card {
  padding: 20px;
}

.auth-card,
.info-card,
.profile-banner {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.tab-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.tab-button {
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 9px 14px;
  background: var(--bg);
  color: var(--text-2);
  cursor: pointer;
  font-weight: 700;
}

.tab-button--active {
  background: var(--primary-xlight);
  color: var(--primary);
  border-color: rgba(26, 158, 127, 0.2);
}

.form-grid {
  display: grid;
  gap: 14px;
}

.form-grid--spaced {
  padding-top: 10px;
  border-top: 1px dashed var(--border);
}

.two-cols {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

label {
  display: grid;
  gap: 7px;
}

label span,
.section-hint {
  font-size: 0.82rem;
  color: var(--text-3);
}

input,
select,
textarea {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 11px 12px;
  background: var(--white);
  color: var(--text);
  outline: none;
}

input:focus,
select:focus,
textarea:focus {
  border-color: rgba(26, 158, 127, 0.55);
  box-shadow: 0 0 0 3px rgba(26, 158, 127, 0.1);
}

.bullet-list {
  padding-left: 18px;
  color: var(--text-2);
  line-height: 1.75;
}

.notice {
  padding: 14px 16px;
  border-radius: var(--radius);
  border: 1px solid transparent;
}

.notice--success {
  background: rgba(6, 214, 160, 0.12);
  border-color: rgba(6, 214, 160, 0.2);
  color: #0f8f6f;
}

.notice--error {
  background: rgba(239, 83, 80, 0.12);
  border-color: rgba(239, 83, 80, 0.2);
  color: #b02825;
}

.dashboard-grid {
  grid-template-columns: minmax(0, 1fr);
}

.content-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.content-grid--wide {
  align-items: start;
}

.profile-banner {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 14px;
  background: linear-gradient(135deg, #f8fcfb 0%, #edf7f1 100%);
}

.banner-copy {
  margin-top: 8px;
  color: var(--text-2);
  line-height: 1.6;
}

.banner-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.section-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 14px;
}

.section-head h3,
.section-head h4 {
  color: var(--text);
}

.pet-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}

.pet-card {
  display: grid;
  gap: 6px;
  text-align: left;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px;
  background: var(--bg);
  cursor: pointer;
}

.pet-card--active {
  border-color: rgba(26, 158, 127, 0.4);
  background: rgba(26, 158, 127, 0.08);
}

.pet-card__top {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.pet-card__top span,
.pet-card small,
.mini-list p,
.list-item p,
.invoice-row p,
.empty-state {
  color: var(--text-2);
}

.selected-pet {
  margin-top: 18px;
  padding-top: 18px;
  border-top: 1px dashed var(--border);
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
}

.detail-grid div,
.mini-list article {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px;
  background: var(--white);
}

.detail-grid span,
.mini-list small,
.invoice-row small,
.list-item small {
  display: block;
  color: var(--text-3);
  margin-bottom: 4px;
  font-size: 0.78rem;
}

.subgrid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
  margin-top: 14px;
}

.subgrid h5 {
  margin-bottom: 10px;
}

.mini-list {
  display: grid;
  gap: 10px;
}

.list-block {
  display: grid;
  gap: 12px;
}

.list-item,
.invoice-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
}

.list-item__right,
.invoice-row__right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.empty-state {
  padding: 10px 0 0;
}

@media (max-width: 1080px) {
  .portal-hero,
  .auth-grid,
  .content-grid {
    grid-template-columns: 1fr;
  }

  .status-grid,
  .stats-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .portal-hero__copy,
  .portal-hero__status,
  .card {
    padding: 18px;
  }

  .profile-banner,
  .section-head,
  .list-item,
  .invoice-row {
    flex-direction: column;
    align-items: flex-start;
  }

  .banner-actions,
  .list-item__right,
  .invoice-row__right {
    width: 100%;
    justify-content: flex-start;
  }

  .two-cols,
  .status-grid,
  .stats-grid {
    grid-template-columns: 1fr;
  }
}
</style>
