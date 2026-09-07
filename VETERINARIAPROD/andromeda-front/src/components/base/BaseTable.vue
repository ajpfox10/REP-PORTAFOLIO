<template>
  <div class="base-table" role="region" :aria-label="label">
    <p v-if="caption" class="base-table__caption">{{ caption }}</p>
    <div class="base-table__content">
      <slot />
    </div>
  </div>
</template>

<script setup>
defineProps({
  label: { type: String, default: 'Tabla de datos' },
  caption: { type: String, default: '' },
})
</script>

<style scoped>
.base-table {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--white);
  box-shadow: var(--shadow-sm);
}

.base-table__content {
  min-width: 100%;
}

.base-table__caption {
  margin: 0;
  padding: 12px 16px 0;
  font-size: 0.82rem;
  color: var(--text-3);
}

</style>
