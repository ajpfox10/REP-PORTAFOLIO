<template>
  <div class="landing">
    <header class="nav" :class="{ 'nav--scrolled': scrolled }">
      <div class="container nav__inner">
        <RouterLink to="/" class="nav__brand" aria-label="Andromeda, inicio"><AppLogo size="sm" /></RouterLink>
        <nav class="nav__links" aria-label="Secciones">
          <a href="#funciones">Funciones</a>
          <a href="#precios">Precios</a>
          <a href="#seguridad">Seguridad</a>
          <a href="#preguntas">Preguntas</a>
        </nav>
        <div class="nav__actions">
          <RouterLink to="/login" class="btn btn--ghost">Iniciar sesión</RouterLink>
          <RouterLink to="/registro" class="btn btn--primary">Probar gratis</RouterLink>
        </div>
      </div>
    </header>

    <main>
      <!-- Hero -->
      <section class="hero">
        <div class="container hero__inner">
          <div class="hero__copy">
            <span class="eyebrow"><AppIcon name="sparkles" :size="15" /> {{ trialDays }} días gratis, sin tarjeta</span>
            <h1>La gestión de tu veterinaria, en un solo lugar.</h1>
            <p class="hero__lead">
              Turnos, historia clínica, vacunas, internación, facturación y reportes.
              Pensado para clínicas argentinas: cobrás con MercadoPago y facturás con AFIP.
            </p>
            <div class="hero__cta">
              <RouterLink to="/registro" class="btn btn--primary btn--lg">
                Crear mi clínica <AppIcon name="arrowRight" :size="18" />
              </RouterLink>
              <a href="#precios" class="btn btn--ghost btn--lg">Ver precios</a>
            </div>
            <ul class="hero__trust">
              <li><AppIcon name="check" :size="16" /> Listo en 2 minutos</li>
              <li><AppIcon name="check" :size="16" /> Datos cifrados</li>
              <li><AppIcon name="check" :size="16" /> Cancelás cuando quieras</li>
            </ul>
          </div>

          <!-- Vista previa del producto, armada con HTML para que se adapte al tema -->
          <div class="preview" aria-hidden="true">
            <div class="preview__bar"><span /><span /><span /></div>
            <div class="preview__body">
              <div class="preview__kpis">
                <div v-for="kpi in PREVIEW_KPIS" :key="kpi.label" class="preview__kpi">
                  <AppIcon :name="kpi.icon" :size="16" />
                  <strong>{{ kpi.value }}</strong>
                  <span>{{ kpi.label }}</span>
                </div>
              </div>
              <div class="preview__panel">
                <p class="preview__title">Turnos de hoy</p>
                <div v-for="appt in PREVIEW_APPOINTMENTS" :key="appt.time" class="preview__row">
                  <span class="preview__time">{{ appt.time }}</span>
                  <SpeciesIcon :species="appt.species" :size="16" />
                  <span class="preview__name">{{ appt.patient }}</span>
                  <span class="preview__reason">{{ appt.reason }}</span>
                  <span class="chip" :class="`chip--${appt.tone}`">{{ appt.status }}</span>
                </div>
              </div>
              <div class="preview__chart">
                <p class="preview__title">Facturación del mes</p>
                <div class="preview__bars">
                  <span v-for="(h, i) in PREVIEW_BARS" :key="i" :style="{ height: h + '%' }" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Funciones -->
      <section id="funciones" class="section">
        <div class="container">
          <div class="section__head">
            <h2>Todo lo que pasa en la clínica, conectado</h2>
            <p>Cada módulo comparte la misma ficha del paciente: lo que carga recepción lo ve el veterinario, y lo que factura administración sale de la consulta.</p>
          </div>
          <div class="features">
            <article v-for="feature in FEATURES" :key="feature.title" class="feature">
              <span class="feature__icon"><AppIcon :name="feature.icon" :size="20" /></span>
              <h3>{{ feature.title }}</h3>
              <p>{{ feature.text }}</p>
            </article>
          </div>
        </div>
      </section>

      <!-- Pasos -->
      <section class="section section--tinted">
        <div class="container">
          <div class="section__head">
            <h2>Empezás hoy, sin instalar nada</h2>
          </div>
          <ol class="steps">
            <li v-for="(step, index) in STEPS" :key="step.title" class="step">
              <span class="step__number">{{ index + 1 }}</span>
              <h3>{{ step.title }}</h3>
              <p>{{ step.text }}</p>
            </li>
          </ol>
        </div>
      </section>

      <!-- Precios -->
      <section id="precios" class="section">
        <div class="container">
          <div class="section__head">
            <h2>Precios simples, en pesos</h2>
            <p>Todos los planes incluyen {{ trialDays }} días de prueba con las funciones del plan Profesional.</p>
          </div>
          <div class="pricing">
            <article
              v-for="plan in plans"
              :key="plan.id"
              class="plan"
              :class="{ 'plan--featured': plan.recommended }"
            >
              <span v-if="plan.recommended" class="plan__badge">Más elegido</span>
              <h3>{{ plan.name }}</h3>
              <p class="plan__desc">{{ plan.description }}</p>
              <p class="plan__price">
                <strong>{{ formatPrice(plan.monthlyPrice, plan.currency) }}</strong>
                <span>/ mes + IVA</span>
              </p>
              <RouterLink to="/registro" class="btn btn--block" :class="plan.recommended ? 'btn--primary' : 'btn--outline'">
                Empezar prueba gratis
              </RouterLink>
              <ul class="plan__list">
                <li v-for="item in plan.highlights" :key="item"><AppIcon name="check" :size="16" /> {{ item }}</li>
              </ul>
            </article>
          </div>
        </div>
      </section>

      <!-- Seguridad -->
      <section id="seguridad" class="section section--tinted">
        <div class="container security">
          <div class="security__copy">
            <h2>La información clínica, protegida como corresponde</h2>
            <p>Historias clínicas, recetas y datos de los dueños viajan y se guardan cifrados. Cada clínica ve únicamente sus datos.</p>
          </div>
          <ul class="security__list">
            <li v-for="item in SECURITY" :key="item.title">
              <span class="feature__icon"><AppIcon :name="item.icon" :size="18" /></span>
              <div>
                <strong>{{ item.title }}</strong>
                <p>{{ item.text }}</p>
              </div>
            </li>
          </ul>
        </div>
      </section>

      <!-- Preguntas -->
      <section id="preguntas" class="section">
        <div class="container faq">
          <div class="section__head">
            <h2>Preguntas frecuentes</h2>
          </div>
          <details v-for="item in FAQ" :key="item.q" class="faq__item">
            <summary>{{ item.q }} <AppIcon name="chevronDown" :size="18" /></summary>
            <p>{{ item.a }}</p>
          </details>
        </div>
      </section>

      <!-- Cierre -->
      <section class="section">
        <div class="container">
          <div class="closing">
            <h2>Probalo con tu equipo esta semana</h2>
            <p>{{ trialDays }} días gratis con todas las funciones. Si no te sirve, no pagás nada.</p>
            <RouterLink to="/registro" class="btn btn--light btn--lg">Crear mi clínica gratis</RouterLink>
          </div>
        </div>
      </section>
    </main>

    <footer class="footer">
      <div class="container footer__inner">
        <AppLogo size="sm" />
        <p>© {{ year }} Andromeda · Software de gestión veterinaria</p>
        <div class="footer__links">
          <RouterLink to="/login">Iniciar sesión</RouterLink>
          <RouterLink to="/portal">Portal de dueños</RouterLink>
        </div>
      </div>
    </footer>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import AppLogo from '../components/AppLogo.vue'
import AppIcon from '../components/AppIcon.vue'
import SpeciesIcon from '../components/SpeciesIcon.vue'
import { authApi } from '../api/auth'
import { logError } from '../utils/errors'

// Se usan mientras carga el catálogo (o si el backend no responde).
const FALLBACK_PLANS = [
  { id: 'basic', name: 'Esencial', description: 'Para consultorios con un equipo chico.', monthlyPrice: 29900, currency: 'ARS',
    highlights: ['1 sucursal y hasta 3 usuarios', 'Turnos, historia clínica y vacunas', 'Facturación y cobros con MercadoPago', 'Reportes esenciales'] },
  { id: 'pro', name: 'Profesional', description: 'Para clínicas con varias áreas y equipo completo.', monthlyPrice: 59900, currency: 'ARS', recommended: true,
    highlights: ['Hasta 3 sucursales y 15 usuarios', 'Laboratorio, imágenes, cirugías e internación', 'Telemedicina y portal para dueños', 'Reportes avanzados y envíos programados', 'Asistente de IA'] },
  { id: 'enterprise', name: 'Red de clínicas', description: 'Para redes y hospitales veterinarios.', monthlyPrice: 119900, currency: 'ARS',
    highlights: ['Sucursales y usuarios ilimitados', 'Inventario y transferencias entre sucursales', 'SSO, auditoría exportable y API', 'Soporte prioritario'] },
]

const FEATURES = [
  { icon: 'appointments', title: 'Agenda y turnos', text: 'Agenda por profesional, confirmaciones y recordatorios por WhatsApp y email.' },
  { icon: 'evolutions', title: 'Historia clínica', text: 'Anamnesis, examen físico, diagnósticos y recetas en una ficha única por paciente.' },
  { icon: 'vaccines', title: 'Vacunas y desparasitación', text: 'Calendario sanitario con alertas de vencimiento para avisar a los dueños.' },
  { icon: 'hospitalization', title: 'Internación y cirugías', text: 'Tablero de internados, monitoreo, medicación y registro anestésico.' },
  { icon: 'lab', title: 'Laboratorio e imágenes', text: 'Órdenes, resultados y estudios vinculados a cada consulta.' },
  { icon: 'billing', title: 'Facturación y cobros', text: 'Factura electrónica AFIP, cobros con MercadoPago y cuenta corriente.' },
  { icon: 'inventory', title: 'Stock e insumos', text: 'Lotes, vencimientos, proveedores y alertas de stock mínimo por sucursal.' },
  { icon: 'reports', title: 'Reportes', text: 'Ingresos, turnos, diagnósticos y cumplimiento de vacunación, exportables a Excel y PDF.' },
]

const STEPS = [
  { title: 'Creá tu cuenta', text: 'Nombre de la clínica, tu email y una contraseña. Sin tarjeta.' },
  { title: 'Cargá tus pacientes', text: 'Registrá dueños y mascotas a medida que llegan a la clínica.' },
  { title: 'Sumá a tu equipo', text: 'Invitá a veterinarios y recepción, cada uno con los permisos de su rol.' },
]

const SECURITY = [
  { icon: 'lock', title: 'Cifrado de datos sensibles', text: 'Historia clínica, recetas y datos personales cifrados con AES-256.' },
  { icon: 'shield', title: 'Acceso por roles', text: 'Cada persona ve solo lo que su rol permite, con auditoría de cada cambio.' },
  { icon: 'verified', title: 'Sesiones seguras', text: 'Cookies httpOnly, protección CSRF, 2FA y bloqueo ante intentos repetidos.' },
]

const FAQ = [
  { q: '¿Necesito tarjeta para la prueba gratuita?', a: 'No. Creás la cuenta con tu email y usás todo durante la prueba. Al final elegís un plan si querés seguir.' },
  { q: '¿Cómo se cobra la suscripción?', a: 'Con débito automático de MercadoPago, mes a mes. Podés cancelar cuando quieras desde la misma aplicación.' },
  { q: '¿Qué pasa con mis datos si cancelo?', a: 'Mantenés el acceso hasta el fin del período pago y podés exportar tus reportes. Los datos no se comparten con terceros.' },
  { q: '¿Sirve para más de una sucursal?', a: 'Sí. Los planes Profesional y Red de clínicas manejan varias sucursales, con stock y pacientes compartidos.' },
  { q: '¿Funciona en el celular?', a: 'Sí, la aplicación se adapta a cualquier pantalla y los dueños tienen su propio portal para ver turnos y vacunas.' },
]

const PREVIEW_KPIS = [
  { icon: 'appointments', value: '18', label: 'Turnos hoy' },
  { icon: 'hospitalization', value: '4', label: 'Internados' },
  { icon: 'vaccines', value: '9', label: 'Vacunas a vencer' },
]
const PREVIEW_APPOINTMENTS = [
  { time: '09:30', species: 'perro', patient: 'Toby', reason: 'Control anual', status: 'Atendido', tone: 'success' },
  { time: '10:00', species: 'gato', patient: 'Mora', reason: 'Vacunación', status: 'En sala', tone: 'info' },
  { time: '10:30', species: 'conejo', patient: 'Copito', reason: 'Consulta', status: 'Confirmado', tone: 'neutral' },
]
const PREVIEW_BARS = [38, 52, 46, 64, 58, 72, 81, 69, 88]

const plans = ref(FALLBACK_PLANS)
const trialDays = ref(14)
const scrolled = ref(false)
const year = new Date().getFullYear()

function formatPrice(amount, currency = 'ARS') {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount)
}

function onScroll() {
  scrolled.value = window.scrollY > 8
}

onMounted(async () => {
  window.addEventListener('scroll', onScroll, { passive: true })
  try {
    const res = await authApi.plans()
    const data = res.data?.data || res.data
    if (Array.isArray(data?.plans) && data.plans.length) plans.value = data.plans
    if (data?.trialDays) trialDays.value = data.trialDays
  } catch (error) {
    logError('landing.plans', error)
  }
})

onBeforeUnmount(() => window.removeEventListener('scroll', onScroll))
</script>

<style scoped>
.landing {
  min-height: 100vh;
  background: var(--bg);
  color: var(--text);
}

.container {
  width: min(1160px, 100%);
  margin: 0 auto;
  padding: 0 24px;
}

/* ── Botones ─────────────────────────────────────────────────────────────── */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 9px 16px;
  border-radius: var(--radius);
  font-weight: 600;
  font-size: 0.92rem;
  border: 1px solid transparent;
  transition: background var(--transition), border-color var(--transition), color var(--transition);
  white-space: nowrap;
}

.btn--lg {
  padding: 12px 20px;
  font-size: 1rem;
}

.btn--block {
  width: 100%;
}

.btn--primary {
  background: var(--primary);
  color: var(--primary-contrast);
}

.btn--primary:hover {
  background: var(--primary-hover);
  color: var(--primary-contrast);
}

.btn--ghost {
  color: var(--text);
}

.btn--ghost:hover {
  background: var(--surface-3);
  color: var(--text);
}

.btn--outline {
  border-color: var(--border-strong);
  color: var(--text);
  background: var(--surface);
}

.btn--outline:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.btn--light {
  background: #FFFFFF;
  color: #0B6457;
}

.btn--light:hover {
  background: #E3F4F0;
  color: #0B6457;
}

/* ── Navegación ──────────────────────────────────────────────────────────── */
.nav {
  position: sticky;
  top: 0;
  z-index: 50;
  background: color-mix(in srgb, var(--bg) 85%, transparent);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid transparent;
  transition: border-color var(--transition);
}

.nav--scrolled {
  border-bottom-color: var(--border);
}

.nav__inner {
  height: 68px;
  display: flex;
  align-items: center;
  gap: 24px;
}

.nav__brand {
  color: inherit;
}

.nav__links {
  flex: 1;
  display: flex;
  justify-content: center;
  gap: 28px;
}

.nav__links a {
  color: var(--text-2);
  font-weight: 500;
  font-size: 0.92rem;
}

.nav__links a:hover {
  color: var(--text);
}

.nav__actions {
  display: flex;
  gap: 8px;
}

/* ── Hero ────────────────────────────────────────────────────────────────── */
.hero {
  padding: 56px 0 72px;
}

.hero__inner {
  display: grid;
  grid-template-columns: 1.05fr 1fr;
  gap: 48px;
  align-items: center;
}

.eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 999px;
  background: var(--primary-xlight);
  color: var(--primary);
  font-size: 0.82rem;
  font-weight: 600;
}

.hero h1 {
  margin: 18px 0 16px;
  font-size: clamp(2.1rem, 4.4vw, 3.3rem);
  line-height: 1.08;
  letter-spacing: -0.035em;
  font-weight: 800;
}

.hero__lead {
  font-size: 1.12rem;
  line-height: 1.6;
  color: var(--text-2);
  max-width: 540px;
}

.hero__cta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 28px 0 22px;
}

.hero__trust {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
  color: var(--text-2);
  font-size: 0.9rem;
}

.hero__trust li {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.hero__trust :deep(svg) {
  color: var(--primary);
}

/* Vista previa */
.preview {
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--surface);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.preview__bar {
  display: flex;
  gap: 6px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-2);
}

.preview__bar span {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--border-strong);
}

.preview__body {
  padding: 18px;
  display: grid;
  gap: 14px;
}

.preview__kpis {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.preview__kpi {
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: var(--primary);
}

.preview__kpi strong {
  font-size: 1.4rem;
  color: var(--text);
}

.preview__kpi span {
  font-size: 0.76rem;
  color: var(--text-3);
}

.preview__panel,
.preview__chart {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 12px 14px;
}

.preview__title {
  font-size: 0.8rem;
  font-weight: 700;
  margin-bottom: 8px;
}

.preview__row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-top: 1px solid var(--border);
  font-size: 0.84rem;
  color: var(--text-2);
}

.preview__time {
  font-variant-numeric: tabular-nums;
  color: var(--text-3);
}

.preview__name {
  font-weight: 600;
  color: var(--text);
}

.preview__reason {
  flex: 1;
}

.chip {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 600;
}

.chip--success { background: var(--success-light); color: var(--success); }
.chip--info { background: var(--info-light); color: var(--info); }
.chip--neutral { background: var(--surface-3); color: var(--text-2); }

.preview__bars {
  height: 84px;
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

.preview__bars span {
  flex: 1;
  border-radius: 4px 4px 0 0;
  background: var(--primary);
  opacity: 0.85;
}

.preview__bars span:last-child {
  opacity: 1;
}

/* ── Secciones ───────────────────────────────────────────────────────────── */
.section {
  padding: 72px 0;
}

.section--tinted {
  background: var(--surface-2);
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}

.section__head {
  max-width: 680px;
  margin: 0 auto 40px;
  text-align: center;
}

.section h2 {
  font-size: clamp(1.6rem, 3vw, 2.2rem);
  letter-spacing: -0.025em;
  line-height: 1.15;
  font-weight: 800;
}

.section__head p {
  margin-top: 12px;
  color: var(--text-2);
  font-size: 1.04rem;
  line-height: 1.6;
}

.features {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}

.feature {
  padding: 22px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
}

.feature__icon {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius);
  background: var(--primary-xlight);
  color: var(--primary);
}

.feature h3 {
  margin: 14px 0 6px;
  font-size: 1rem;
}

.feature p {
  color: var(--text-2);
  font-size: 0.9rem;
  line-height: 1.55;
}

.steps {
  list-style: none;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}

.step {
  padding: 24px;
  border-radius: var(--radius-lg);
  background: var(--surface);
  border: 1px solid var(--border);
}

.step__number {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--primary);
  color: var(--primary-contrast);
  font-weight: 700;
}

.step h3 {
  margin: 14px 0 6px;
  font-size: 1.04rem;
}

.step p {
  color: var(--text-2);
  line-height: 1.55;
}

/* Precios */
.pricing {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
  align-items: start;
}

.plan {
  position: relative;
  padding: 28px;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--surface);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.plan--featured {
  border: 2px solid var(--primary);
  box-shadow: var(--shadow);
}

.plan__badge {
  position: absolute;
  top: -12px;
  left: 28px;
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--primary);
  color: var(--primary-contrast);
  font-size: 0.76rem;
  font-weight: 700;
}

.plan h3 {
  font-size: 1.14rem;
}

.plan__desc {
  color: var(--text-2);
  font-size: 0.9rem;
  min-height: 2.8em;
}

.plan__price strong {
  font-size: 2rem;
  letter-spacing: -0.03em;
}

.plan__price span {
  color: var(--text-3);
  font-size: 0.88rem;
}

.plan__list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 6px;
  border-top: 1px solid var(--border);
}

.plan__list li {
  display: flex;
  gap: 8px;
  font-size: 0.9rem;
  color: var(--text-2);
}

.plan__list :deep(svg) {
  color: var(--primary);
  margin-top: 2px;
}

/* Seguridad */
.security {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 48px;
  align-items: center;
}

.security__copy p {
  margin-top: 14px;
  color: var(--text-2);
  line-height: 1.6;
  font-size: 1.04rem;
}

.security__list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.security__list li {
  display: flex;
  gap: 14px;
}

.security__list p {
  margin-top: 2px;
  color: var(--text-2);
  font-size: 0.92rem;
  line-height: 1.5;
}

/* FAQ */
.faq {
  max-width: 780px;
}

.faq__item {
  border-bottom: 1px solid var(--border);
}

.faq__item summary {
  list-style: none;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 18px 0;
  font-weight: 600;
}

.faq__item summary::-webkit-details-marker {
  display: none;
}

.faq__item[open] summary :deep(svg) {
  transform: rotate(180deg);
}

.faq__item p {
  padding-bottom: 18px;
  color: var(--text-2);
  line-height: 1.6;
}

/* Cierre */
.closing {
  padding: 48px 32px;
  border-radius: var(--radius-xl);
  background: linear-gradient(135deg, #0E7C6B, #0B6457);
  color: #FFFFFF;
  text-align: center;
}

.closing h2 {
  color: #FFFFFF;
}

.closing p {
  margin: 12px 0 24px;
  color: rgba(255, 255, 255, 0.85);
  font-size: 1.04rem;
}

/* Footer */
.footer {
  border-top: 1px solid var(--border);
  padding: 28px 0;
}

.footer__inner {
  display: flex;
  align-items: center;
  gap: 24px;
  flex-wrap: wrap;
}

.footer__inner p {
  flex: 1;
  color: var(--text-3);
  font-size: 0.86rem;
}

.footer__links {
  display: flex;
  gap: 18px;
  font-size: 0.88rem;
}

/* ── Responsive ──────────────────────────────────────────────────────────── */
@media (max-width: 1024px) {
  .features { grid-template-columns: repeat(2, 1fr); }
  .hero__inner, .security { grid-template-columns: 1fr; }
  .preview { max-width: 620px; }
}

@media (max-width: 760px) {
  .container { padding: 0 16px; }
  .nav__links { display: none; }
  .nav__inner { justify-content: space-between; }
  .nav__actions .btn--ghost { display: none; }
  .hero { padding: 32px 0 48px; }
  .section { padding: 52px 0; }
  .features, .steps, .pricing { grid-template-columns: 1fr; }
  .preview__kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .preview__reason { display: none; }
}
</style>
