<template>
  <Teleport to="body">
    <Transition name="palette">
      <div v-if="open" class="palette-backdrop" @click.self="close">
        <div class="palette" role="dialog" aria-modal="true" aria-label="Ir a una sección">
          <div class="palette__search">
            <AppIcon name="search" :size="18" />
            <input
              ref="inputRef"
              v-model="query"
              type="text"
              placeholder="Buscar una sección… (turnos, pacientes, reportes)"
              aria-label="Buscar una sección"
              @keydown.down.prevent="move(1)"
              @keydown.up.prevent="move(-1)"
              @keydown.enter.prevent="go(results[active])"
              @keydown.esc.prevent="close"
            />
            <kbd>Esc</kbd>
          </div>

          <ul v-if="results.length" class="palette__list" role="listbox">
            <li
              v-for="(item, index) in results"
              :key="item.key"
              role="option"
              :aria-selected="index === active"
              class="palette__item"
              :class="{ 'palette__item--active': index === active }"
              @mouseenter="active = index"
              @click="go(item)"
            >
              <span class="palette__icon"><AppIcon :name="item.icon" :size="17" /></span>
              <span class="palette__label">{{ item.label }}</span>
              <span class="palette__section">{{ item.section }}</span>
            </li>
          </ul>
          <p v-else class="palette__empty">No hay secciones que coincidan con “{{ query }}”.</p>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import AppIcon from './AppIcon.vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

const props = defineProps({
  items: { type: Array, default: () => [] },
})

const router = useRouter()
const open = ref(false)
const query = ref('')
const active = ref(0)
const inputRef = ref(null)

function normalize(text) {
  return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

const results = computed(() => {
  const q = normalize(query.value).trim()
  if (!q) return props.items
  return props.items.filter((item) => normalize(`${item.label} ${item.section}`).includes(q))
})

watch(query, () => { active.value = 0 })

function move(delta) {
  if (!results.value.length) return
  active.value = (active.value + delta + results.value.length) % results.value.length
}

async function show() {
  open.value = true
  query.value = ''
  active.value = 0
  await nextTick()
  inputRef.value?.focus()
}

function close() {
  open.value = false
}

function go(item) {
  if (!item) return
  close()
  router.push(item.to)
}

function onKeydown(event) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    if (open.value) close()
    else show()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

defineExpose({ show, close })
</script>

<style scoped>
.palette-backdrop {
  position: fixed;
  inset: 0;
  z-index: 400;
  background: var(--overlay);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 12vh 16px 16px;
}

.palette {
  width: min(560px, 100%);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.palette__search {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
  color: var(--text-3);
}

.palette__search input {
  flex: 1;
  border: none;
  background: transparent;
  min-height: 28px;
  font-size: 0.98rem;
  color: var(--text);
}

.palette__search input:focus {
  outline: none;
}

kbd {
  font: inherit;
  font-size: 0.72rem;
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-3);
  background: var(--surface-2);
}

.palette__list {
  list-style: none;
  max-height: min(380px, 55vh);
  overflow-y: auto;
  padding: 6px;
}

.palette__item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: var(--radius);
  cursor: pointer;
  color: var(--text);
}

.palette__item--active {
  background: var(--primary-xlight);
}

.palette__icon {
  display: inline-flex;
  color: var(--primary);
}

.palette__label {
  flex: 1;
  font-weight: 600;
}

.palette__section {
  font-size: 0.78rem;
  color: var(--text-3);
}

.palette__empty {
  padding: 24px 16px;
  text-align: center;
  color: var(--text-3);
}

.palette-enter-active,
.palette-leave-active {
  transition: opacity 0.14s ease;
}

.palette-enter-from,
.palette-leave-to {
  opacity: 0;
}
</style>
