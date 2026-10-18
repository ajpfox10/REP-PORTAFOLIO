<template>
  <div class="bar-list">
    <p v-if="!rows.length" class="bar-list__empty">{{ emptyText }}</p>
    <ul v-else>
      <li v-for="row in rows" :key="row.label" class="bar-list__row" :title="`${row.label}: ${format(row.value)}`">
        <span class="bar-list__label">{{ row.label }}</span>
        <span class="bar-list__track" aria-hidden="true">
          <span class="bar-list__bar" :style="{ width: row.width + '%' }" />
        </span>
        <span class="bar-list__value">{{ format(row.value) }}<small v-if="row.pct !== null"> · {{ row.pct }}%</small></span>
      </li>
    </ul>
  </div>
</template>

<script setup>
import { computed } from 'vue'

// Barras horizontales de una sola serie, ordenadas de mayor a menor (ranking).
const props = defineProps({
  items: { type: Array, default: () => [] },   // [{ label, value, pct? }]
  format: { type: Function, default: (v) => new Intl.NumberFormat('es-AR').format(v) },
  limit: { type: Number, default: 8 },
  emptyText: { type: String, default: 'Sin datos para el período elegido.' },
})

const rows = computed(() => {
  const sorted = props.items
    .map((item) => ({ ...item, value: Number(item.value) || 0 }))
    .sort((a, b) => b.value - a.value)
  // Más de `limit` categorías se agrupan en "Otros" en lugar de inventar colores o filas.
  const top = sorted.slice(0, props.limit)
  const rest = sorted.slice(props.limit)
  if (rest.length) top.push({ label: 'Otros', value: rest.reduce((s, r) => s + r.value, 0), pct: null })
  const max = Math.max(...top.map((r) => r.value), 0) || 1
  return top.map((row) => ({
    label: row.label || 'Sin dato',
    value: row.value,
    pct: row.pct !== undefined && row.pct !== null ? Math.round(Number(row.pct)) : null,
    width: Math.max(1.5, (row.value / max) * 100),
  }))
})
</script>

<style scoped>
ul {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.bar-list__row {
  display: grid;
  grid-template-columns: minmax(90px, 0.9fr) 2fr auto;
  align-items: center;
  gap: 12px;
  font-size: 0.86rem;
}

.bar-list__label {
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bar-list__track {
  height: 12px;
  display: flex;
  align-items: center;
}

.bar-list__bar {
  display: block;
  height: 12px;
  border-radius: 0 4px 4px 0;
  background: var(--chart-series);
}

.bar-list__value {
  min-width: 64px;
  text-align: right;
  font-weight: 600;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.bar-list__value small {
  font-weight: 400;
  color: var(--text-3);
}

.bar-list__empty {
  padding: 24px 0;
  text-align: center;
  color: var(--text-3);
  font-size: 0.88rem;
}
</style>
