<template>
  <section class="branches" aria-labelledby="branches-title">
    <header class="branches__head">
      <div>
        <h3 id="branches-title">Sucursales</h3>
        <p>{{ subtitle }}</p>
      </div>
      <button type="button" class="btn-primary" :disabled="atLimit" :title="atLimit ? limitText : ''" @click="openForm()">
        <AppIcon name="plus" :size="16" /> Nueva sucursal
      </button>
    </header>

    <p v-if="atLimit" class="branches__limit">
      <AppIcon name="info" :size="15" /> {{ limitText }}
      <RouterLink to="/suscripcion">Ver planes</RouterLink>
    </p>

    <div v-if="loading" class="branches__loading" role="status">Cargando sucursales…</div>
    <ul v-else class="branches__list">
      <li v-for="branch in branches" :key="branch.id" class="branch" :class="{ 'branch--inactive': !branch.is_active }">
        <span class="branch__icon"><AppIcon name="branch" :size="18" /></span>
        <div class="branch__info">
          <strong>{{ branch.name }}</strong>
          <span>{{ [branch.address, branch.phone].filter(Boolean).join(' · ') || 'Sin datos de contacto' }}</span>
          <span class="branch__meta">{{ branch.staff_count }} {{ Number(branch.staff_count) === 1 ? 'persona' : 'personas' }} · {{ branch.client_count }} clientes</span>
        </div>
        <span class="badge" :class="branch.is_active ? 'badge--ok' : 'badge--muted'">{{ branch.is_active ? 'Activa' : 'Inactiva' }}</span>
        <div class="branch__actions">
          <button type="button" class="icon-btn" title="Editar" aria-label="Editar sucursal" @click="openForm(branch)"><AppIcon name="edit" :size="16" /></button>
          <button type="button" class="icon-btn" :title="branch.is_active ? 'Desactivar' : 'Activar'"
            :aria-label="branch.is_active ? 'Desactivar sucursal' : 'Activar sucursal'" @click="toggle(branch)">
            <AppIcon :name="branch.is_active ? 'close' : 'check'" :size="16" />
          </button>
        </div>
      </li>
    </ul>

    <div v-if="form.open" class="modal-backdrop" @click.self="form.open = false">
      <form class="modal" role="dialog" aria-modal="true" aria-labelledby="branch-form-title" @submit.prevent="save">
        <div class="modal__header">
          <h3 id="branch-form-title">{{ form.id ? 'Editar sucursal' : 'Nueva sucursal' }}</h3>
          <button type="button" class="modal__close" aria-label="Cerrar" @click="form.open = false"><AppIcon name="close" :size="18" /></button>
        </div>
        <div class="form-body">
          <div class="field">
            <label for="br-name">Nombre</label>
            <input id="br-name" v-model.trim="form.name" required minlength="2" maxlength="120" placeholder="Sede Palermo" />
          </div>
          <div class="field">
            <label for="br-address">Dirección</label>
            <input id="br-address" v-model.trim="form.address" maxlength="255" />
          </div>
          <div class="form-grid">
            <div class="field">
              <label for="br-phone">Teléfono</label>
              <input id="br-phone" v-model.trim="form.phone" type="tel" maxlength="40" />
            </div>
            <div class="field">
              <label for="br-email">Email</label>
              <input id="br-email" v-model.trim="form.email" type="email" maxlength="191" />
            </div>
          </div>
          <p v-if="form.error" class="field-error">{{ form.error }}</p>
        </div>
        <div class="modal__actions">
          <button type="button" class="btn-ghost" @click="form.open = false">Cancelar</button>
          <button type="submit" class="btn-primary" :disabled="form.saving">{{ form.saving ? 'Guardando…' : 'Guardar' }}</button>
        </div>
      </form>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import AppIcon from '../AppIcon.vue'
import { adminApi } from '../../api'
import { useSubscriptionStore } from '../../stores/subscription'
import { useUiFeedback } from '../../composables/useUiFeedback'
import { extractDetailedErrorMessage } from '../../utils/errors'

const subscription = useSubscriptionStore()
const { success, notifyError } = useUiFeedback()

const branches = ref([])
const loading = ref(true)
const form = reactive({ open: false, saving: false, error: '', id: null, name: '', address: '', phone: '', email: '' })

// Cupo de sucursales según el plan en uso (null = sin límite)
const SEATS = { free: 1, basic: 1, pro: 3, enterprise: null }
const limit = computed(() => {
  const tier = subscription.summary?.effectiveTier
  if (!tier || subscription.summary?.status === 'legacy') return null
  return tier in SEATS ? SEATS[tier] : null
})
const activeCount = computed(() => branches.value.filter((b) => b.is_active).length)
const atLimit = computed(() => limit.value !== null && activeCount.value >= limit.value)
const limitText = computed(() => `Tu plan incluye ${limit.value === 1 ? '1 sucursal' : `${limit.value} sucursales`}. Para sumar otra, pasá a un plan superior.`)
const subtitle = computed(() => (limit.value === null
  ? `${activeCount.value} activas`
  : `${activeCount.value} de ${limit.value} activas en tu plan`))

async function load() {
  loading.value = true
  try {
    const res = await adminApi.branches.list()
    branches.value = res.data?.data || res.data || []
  } catch (err) {
    notifyError('admin.branches.load', err, 'No pudimos cargar las sucursales.')
  } finally {
    loading.value = false
  }
}

function openForm(branch = null) {
  Object.assign(form, {
    open: true, saving: false, error: '',
    id: branch?.id || null,
    name: branch?.name || '',
    address: branch?.address || '',
    phone: branch?.phone || '',
    email: branch?.email || '',
  })
}

async function save() {
  form.saving = true
  form.error = ''
  const payload = { name: form.name, address: form.address || null, phone: form.phone || null, email: form.email || null }
  try {
    if (form.id) await adminApi.branches.update(form.id, payload)
    else await adminApi.branches.create(payload)
    form.open = false
    success(form.id ? 'Sucursal actualizada.' : 'Sucursal creada.')
    await load()
    subscription.load({ force: true })
  } catch (err) {
    form.error = extractDetailedErrorMessage(err, 'No pudimos guardar la sucursal.', { context: 'Sucursales' })
  } finally {
    form.saving = false
  }
}

async function toggle(branch) {
  try {
    await adminApi.branches.update(branch.id, { isActive: !branch.is_active })
    await load()
  } catch (err) {
    notifyError('admin.branches.toggle', err, 'No pudimos actualizar la sucursal.')
  }
}

onMounted(() => {
  load()
  subscription.load()
})
</script>

<style scoped>
.branches {
  padding: 18px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
}

.branches__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 14px;
}

.branches__head h3 {
  font-size: 1rem;
}

.branches__head p {
  margin-top: 2px;
  font-size: 0.84rem;
  color: var(--text-3);
}

.branches__limit {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 12px;
  padding: 10px 12px;
  border-radius: var(--radius);
  background: var(--info-light);
  font-size: 0.86rem;
  color: var(--text);
}

.branches__limit a {
  margin-left: auto;
  font-weight: 600;
}

.branches__loading {
  color: var(--text-3);
  font-size: 0.88rem;
}

.branches__list {
  list-style: none;
}

.branch {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
}

.branch + .branch {
  border-top: 1px solid var(--border);
}

.branch--inactive .branch__info {
  opacity: 0.6;
}

.branch__icon {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius);
  background: var(--primary-xlight);
  color: var(--primary);
}

.branch__info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
  font-size: 0.86rem;
  color: var(--text-2);
}

.branch__info strong {
  color: var(--text);
}

.branch__meta {
  font-size: 0.78rem;
  color: var(--text-3);
}

.badge {
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 0.74rem;
  font-weight: 600;
}

.badge--ok { background: var(--success-light); color: var(--success); }
.badge--muted { background: var(--surface-3); color: var(--text-3); }

.branch__actions {
  display: flex;
  gap: 4px;
}

.icon-btn {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text-2);
  cursor: pointer;
}

.icon-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
}
</style>
