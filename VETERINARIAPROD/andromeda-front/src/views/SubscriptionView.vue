<template>
  <div class="page subscription">
    <div class="page-header">
      <div class="page-header__left">
        <span class="page-icon" aria-hidden="true"><AppIcon name="subscription" :size="22" /></span>
        <div>
          <h2 class="page-title">Suscripción y plan</h2>
          <p class="page-sub">Tu plan, el consumo del mes y la facturación de Andromeda.</p>
        </div>
      </div>
      <button type="button" class="btn-ghost" :disabled="store.loading" @click="reload">
        <AppIcon name="refresh" :size="16" /> Actualizar
      </button>
    </div>

    <div v-if="store.loading && !data" class="loading-state" role="status"><span class="spin spin--dark" /> Cargando suscripción…</div>
    <div v-else-if="store.error && !data" class="alert alert--error" role="alert">
      No pudimos cargar la suscripción. Probá actualizar en unos segundos.
    </div>

    <template v-else-if="data">
      <!-- Estado -->
      <section class="status-card" :class="`status-card--${statusTone}`">
        <div class="status-card__main">
          <span class="status-badge" :class="`status-badge--${statusTone}`">{{ statusLabel }}</span>
          <h3>{{ headline }}</h3>
          <p>{{ statusDetail }}</p>
          <div v-if="summary.status === 'trialing'" class="trial-bar" role="progressbar"
            :aria-valuenow="trialUsedDays" aria-valuemin="0" :aria-valuemax="data.trialDays">
            <span :style="{ width: trialPercent + '%' }" />
          </div>
        </div>
        <dl class="status-card__facts">
          <div>
            <dt>Plan en uso</dt>
            <dd>{{ PLAN_LABELS[summary.effectiveTier] || summary.effectiveTier }}</dd>
          </div>
          <div v-if="summary.currentPeriodEnd">
            <dt>{{ summary.status === 'cancelled' ? 'Acceso hasta' : 'Próxima renovación' }}</dt>
            <dd>{{ formatDate(summary.currentPeriodEnd) }}</dd>
          </div>
          <div>
            <dt>Equipo</dt>
            <dd>{{ data.seats.users }} {{ data.seats.users === 1 ? 'usuario' : 'usuarios' }} · {{ data.seats.branches }} {{ data.seats.branches === 1 ? 'sucursal' : 'sucursales' }}</dd>
          </div>
          <div v-if="summary.billingEmail">
            <dt>Facturación a</dt>
            <dd>{{ summary.billingEmail }}</dd>
          </div>
        </dl>
      </section>

      <div v-if="data.checkout.demoMode" class="alert alert--warning" role="note">
        Modo demo: MercadoPago no está configurado en este entorno, así que al elegir un plan se activa sin cobrar.
      </div>

      <!-- Planes -->
      <section class="plans" aria-labelledby="plans-title">
        <h3 id="plans-title" class="section-title">Planes</h3>
        <div class="plans__grid">
          <article v-for="plan in data.plans" :key="plan.id" class="plan" :class="{ 'plan--current': isCurrent(plan), 'plan--featured': plan.recommended && !isCurrent(plan) }">
            <div class="plan__head">
              <h4>{{ plan.name }}</h4>
              <span v-if="isCurrent(plan)" class="status-badge status-badge--success">Plan actual</span>
              <span v-else-if="plan.recommended" class="status-badge status-badge--info">Recomendado</span>
            </div>
            <p class="plan__price"><strong>{{ formatMoney(plan.monthlyPrice, plan.currency) }}</strong> / mes + IVA</p>
            <ul>
              <li v-for="item in plan.highlights" :key="item"><AppIcon name="check" :size="15" /> {{ item }}</li>
            </ul>
            <button
              type="button"
              class="plan__action"
              :class="isCurrent(plan) ? 'btn-ghost' : 'btn-primary'"
              :disabled="isCurrent(plan) || checkoutPlan !== null"
              @click="choosePlan(plan)"
            >
              <span v-if="checkoutPlan === plan.id" class="spin" aria-hidden="true" />
              {{ isCurrent(plan) ? 'Tu plan' : actionLabel(plan) }}
            </button>
          </article>
        </div>
        <p class="plans__note"><AppIcon name="lock" :size="14" /> El cobro es mensual con débito automático de MercadoPago. Podés cancelar cuando quieras.</p>
      </section>

      <!-- Consumo -->
      <section class="usage" aria-labelledby="usage-title">
        <h3 id="usage-title" class="section-title">Consumo de este mes</h3>
        <div class="usage__grid">
          <div v-for="item in data.usage" :key="item.feature" class="meter">
            <div class="meter__head">
              <span><AppIcon :name="USAGE_META[item.feature]?.icon || 'activity'" :size="16" /> {{ USAGE_META[item.feature]?.label || item.feature }}</span>
              <strong>{{ formatUsage(item) }}</strong>
            </div>
            <div class="meter__track" :class="{ 'meter__track--unlimited': item.limit === null }">
              <span :class="meterTone(item)" :style="{ width: meterPercent(item) + '%' }" />
            </div>
          </div>
        </div>
      </section>

      <!-- Historial -->
      <section v-if="data.events.length" class="history" aria-labelledby="history-title">
        <h3 id="history-title" class="section-title">Movimientos</h3>
        <ul>
          <li v-for="event in data.events" :key="event.id">
            <span>{{ EVENT_LABELS[event.event_type] || event.event_type }}</span>
            <time :datetime="event.created_at">{{ formatDate(event.created_at, true) }}</time>
          </li>
        </ul>
      </section>

      <div v-if="canCancel" class="danger-zone">
        <div>
          <strong>Cancelar suscripción</strong>
          <p>Dejás de pagar desde el próximo período. Mantenés el plan hasta {{ summary.currentPeriodEnd ? formatDate(summary.currentPeriodEnd) : 'el fin del período pago' }}.</p>
        </div>
        <button type="button" class="btn-ghost danger-zone__button" :disabled="cancelling" @click="cancel">
          {{ cancelling ? 'Cancelando…' : 'Cancelar suscripción' }}
        </button>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import { useSubscriptionStore, PLAN_LABELS } from '../stores/subscription'
import { subscriptionApi } from '../api/subscription'
import { useUiFeedback } from '../composables/useUiFeedback'

const USAGE_META = {
  pdf_reports: { label: 'Reportes PDF', icon: 'file' },
  telemedicine: { label: 'Teleconsultas', icon: 'telemedicine' },
  ai_diagnosis: { label: 'Diagnósticos con IA', icon: 'ai' },
  ai_chatbot: { label: 'Mensajes al asistente', icon: 'sparkles' },
  sms_notifications: { label: 'SMS', icon: 'phone' },
  whatsapp_notify: { label: 'WhatsApp', icon: 'send' },
  storage_mb: { label: 'Almacenamiento', icon: 'folder' },
}
const EVENT_LABELS = {
  'subscription.activated': 'Plan activado',
  'subscription.checkout_started': 'Se inició el pago en MercadoPago',
  'subscription.active': 'Débito automático autorizado',
  'subscription.payment_approved': 'Cobro aprobado',
  'subscription.payment_failed': 'Cobro rechazado',
  'subscription.past_due': 'Pago pendiente',
  'subscription.cancelled': 'Suscripción cancelada',
}
const PLAN_ORDER = ['free', 'basic', 'pro', 'enterprise']

const store = useSubscriptionStore()
const route = useRoute()
const router = useRouter()
const { success, info, confirm, notifyError } = useUiFeedback()

const checkoutPlan = ref(null)
const cancelling = ref(false)

const data = computed(() => store.data)
const summary = computed(() => store.summary || {})

const statusTone = computed(() => ({
  trialing: 'info', active: 'success', past_due: 'danger', expired: 'danger', cancelled: 'warning', legacy: 'success',
}[summary.value.status] || 'info'))

const statusLabel = computed(() => ({
  trialing: 'Prueba gratuita', active: 'Activa', past_due: 'Pago pendiente', expired: 'Prueba finalizada',
  cancelled: 'Cancelada', legacy: 'Activa',
}[summary.value.status] || summary.value.status))

const headline = computed(() => {
  const s = summary.value
  if (s.status === 'trialing') return s.trialDaysLeft === 1 ? 'Te queda 1 día de prueba' : `Te quedan ${s.trialDaysLeft} días de prueba`
  if (s.status === 'expired') return 'Tu prueba gratuita terminó'
  if (s.status === 'past_due') return 'No pudimos cobrar la última cuota'
  if (s.status === 'cancelled') return `Plan ${PLAN_LABELS[s.plan] || ''} cancelado`
  return `Plan ${PLAN_LABELS[s.plan] || PLAN_LABELS[s.effectiveTier] || ''}`
})

const statusDetail = computed(() => {
  const s = summary.value
  if (s.status === 'trialing') return `Estás usando las funciones del plan Profesional hasta el ${formatDate(s.trialEndsAt)}. Elegí un plan para no perder nada.`
  if (s.status === 'expired') return 'Algunas funciones quedaron limitadas. Elegí un plan para recuperarlas: tus datos siguen intactos.'
  if (s.status === 'past_due') return 'Revisá el medio de pago en MercadoPago. Mantenés el plan unos días mientras se regulariza.'
  if (s.status === 'cancelled') return 'La suscripción no se renovará. Podés volver a activarla eligiendo un plan.'
  return 'Tu suscripción está al día.'
})

const trialUsedDays = computed(() => Math.max(0, (data.value?.trialDays || 14) - (summary.value.trialDaysLeft || 0)))
const trialPercent = computed(() => Math.min(100, Math.max(3, (trialUsedDays.value / (data.value?.trialDays || 14)) * 100)))
const canCancel = computed(() => ['active', 'past_due'].includes(summary.value.status))

function isCurrent(plan) {
  return ['active', 'past_due'].includes(summary.value.status) && summary.value.plan === plan.id
}

function actionLabel(plan) {
  const current = ['active', 'past_due', 'cancelled'].includes(summary.value.status) ? summary.value.plan : null
  if (!current) return `Elegir ${plan.name}`
  return PLAN_ORDER.indexOf(plan.id) > PLAN_ORDER.indexOf(current) ? `Mejorar a ${plan.name}` : `Cambiar a ${plan.name}`
}

function formatMoney(amount, currency = 'ARS') {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount)
}

function formatDate(value, withTime = false) {
  if (!value) return '—'
  const options = withTime
    ? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'long', year: 'numeric' }
  return new Intl.DateTimeFormat('es-AR', options).format(new Date(value))
}

function formatUsage(item) {
  const unit = item.feature === 'storage_mb' ? ' MB' : ''
  const current = new Intl.NumberFormat('es-AR').format(item.current)
  if (item.limit === null) return `${current}${unit} · sin límite`
  return `${current} / ${new Intl.NumberFormat('es-AR').format(item.limit)}${unit}`
}

function meterPercent(item) {
  if (item.limit === null) return 100
  if (!item.limit) return item.current > 0 ? 100 : 0
  return Math.min(100, (item.current / item.limit) * 100)
}

function meterTone(item) {
  if (item.limit === null) return 'meter__fill meter__fill--unlimited'
  const pct = meterPercent(item)
  return `meter__fill ${pct >= 90 ? 'meter__fill--danger' : pct >= 70 ? 'meter__fill--warning' : ''}`
}

async function reload() {
  await store.load({ force: true })
}

async function choosePlan(plan) {
  checkoutPlan.value = plan.id
  try {
    const res = await subscriptionApi.checkout(plan.id)
    const result = res.data?.data || res.data
    if (result.initPoint) {
      info('Te llevamos a MercadoPago para autorizar el débito automático.')
      window.location.assign(result.initPoint)
      return
    }
    await reload()
    success(`Activaste el plan ${plan.name}.`, { title: 'Plan actualizado' })
  } catch (err) {
    notifyError('subscription.checkout', err, 'No pudimos iniciar el cambio de plan.')
  } finally {
    checkoutPlan.value = null
  }
}

async function cancel() {
  const ok = await confirm({
    title: 'Cancelar suscripción',
    message: 'Se cancela la renovación automática. Mantenés el plan hasta el fin del período pago.',
    confirmText: 'Cancelar suscripción',
    cancelText: 'Volver',
    variant: 'danger',
  })
  if (!ok) return
  cancelling.value = true
  try {
    await subscriptionApi.cancel()
    await reload()
    success('La suscripción no se renovará.', { title: 'Suscripción cancelada' })
  } catch (err) {
    notifyError('subscription.cancel', err, 'No pudimos cancelar la suscripción.')
  } finally {
    cancelling.value = false
  }
}

onMounted(async () => {
  await store.load({ force: true })
  // Vuelta desde MercadoPago: el webhook puede tardar unos segundos en confirmar.
  if (route.query.resultado === 'mp') {
    info('Estamos confirmando el pago con MercadoPago. El plan se actualiza apenas llegue la confirmación.')
    router.replace({ query: {} })
  }
})
</script>

<style scoped>
.subscription {
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 1120px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.page-header__left {
  display: flex;
  align-items: center;
  gap: 14px;
}

.btn-ghost,
.btn-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.status-card {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 24px;
  padding: 24px;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--surface);
}

.status-card--danger {
  border-color: color-mix(in srgb, var(--danger) 40%, var(--border));
}

.status-card__main h3 {
  margin: 10px 0 6px;
  font-size: 1.35rem;
  letter-spacing: -0.02em;
}

.status-card__main p {
  color: var(--text-2);
  line-height: 1.55;
  max-width: 560px;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 0.76rem;
  font-weight: 700;
}

.status-badge--info { background: var(--info-light); color: var(--info); }
.status-badge--success { background: var(--success-light); color: var(--success); }
.status-badge--warning { background: var(--warning-light); color: var(--warning); }
.status-badge--danger { background: var(--danger-light); color: var(--danger); }

.trial-bar {
  margin-top: 16px;
  height: 8px;
  border-radius: 999px;
  background: var(--surface-3);
  overflow: hidden;
}

.trial-bar span {
  display: block;
  height: 100%;
  background: var(--primary);
  border-radius: inherit;
}

.status-card__facts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  align-content: start;
  padding-left: 24px;
  border-left: 1px solid var(--border);
}

.status-card__facts dt {
  font-size: 0.76rem;
  font-weight: 600;
  color: var(--text-3);
}

.status-card__facts dd {
  margin-top: 2px;
  font-weight: 600;
  word-break: break-word;
}

.section-title {
  font-size: 1rem;
  font-weight: 700;
  margin-bottom: 12px;
}

.plans__grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.plan {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
}

.plan--current {
  border: 2px solid var(--success);
}

.plan--featured {
  border: 2px solid var(--primary);
}

.plan__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.plan__head h4 {
  font-size: 1.05rem;
}

.plan__price {
  color: var(--text-3);
  font-size: 0.86rem;
}

.plan__price strong {
  font-size: 1.5rem;
  color: var(--text);
  letter-spacing: -0.02em;
}

.plan ul {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
}

.plan li {
  display: flex;
  gap: 8px;
  font-size: 0.86rem;
  color: var(--text-2);
}

.plan li :deep(svg) {
  color: var(--primary);
  margin-top: 2px;
}

.plan__action {
  width: 100%;
  min-height: 40px;
}

.plans__note {
  margin-top: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.82rem;
  color: var(--text-3);
}

.usage__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}

.meter {
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
}

.meter__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 0.86rem;
  margin-bottom: 10px;
}

.meter__head span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-2);
}

.meter__head strong {
  font-variant-numeric: tabular-nums;
  font-size: 0.84rem;
}

.meter__track {
  height: 6px;
  border-radius: 999px;
  background: var(--surface-3);
  overflow: hidden;
}

.meter__fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--primary);
  min-width: 2px;
}

.meter__fill--warning { background: var(--warning); }
.meter__fill--danger { background: var(--danger); }
.meter__fill--unlimited {
  background: repeating-linear-gradient(90deg, var(--primary-xlight) 0 8px, transparent 8px 14px);
}

.history ul {
  list-style: none;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
}

.history li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  font-size: 0.88rem;
}

.history li + li {
  border-top: 1px solid var(--border);
}

.history time {
  color: var(--text-3);
  white-space: nowrap;
}

.danger-zone {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 18px 20px;
  border: 1px solid color-mix(in srgb, var(--danger) 35%, var(--border));
  border-radius: var(--radius-lg);
  background: var(--surface);
}

.danger-zone p {
  margin-top: 4px;
  font-size: 0.86rem;
  color: var(--text-2);
}

.danger-zone__button {
  color: var(--danger);
  white-space: nowrap;
}

.spin {
  width: 14px;
  height: 14px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 900px) {
  .status-card { grid-template-columns: 1fr; }
  .status-card__facts { padding-left: 0; border-left: none; border-top: 1px solid var(--border); padding-top: 16px; }
  .plans__grid { grid-template-columns: 1fr; }
  .danger-zone { flex-direction: column; align-items: flex-start; }
}
</style>
