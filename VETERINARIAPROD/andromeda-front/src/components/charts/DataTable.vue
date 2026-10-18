<template>
  <div class="data-table">
    <p v-if="!rows.length" class="data-table__empty">{{ emptyText }}</p>
    <div v-else class="data-table__scroll">
      <table>
        <thead>
          <tr>
            <th v-for="col in columns" :key="col.key" scope="col" :class="{ right: col.align === 'right' }">{{ col.label }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in rows" :key="row.id ?? index">
            <td v-for="col in columns" :key="col.key" :class="{ right: col.align === 'right' }">{{ display(row[col.key], col) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
// Tabla simple para reportes: también es la vista accesible de cada gráfico.
defineProps({
  columns: { type: Array, required: true },   // [{ key, label, align?, money? }]
  rows: { type: Array, default: () => [] },
  emptyText: { type: String, default: 'Sin datos para el período elegido.' },
})

function display(value, col) {
  if (value === null || value === undefined || value === '') return '—'
  if (col.money) return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(Number(value) || 0)
  if (col.align === 'right' && !Number.isNaN(Number(value))) return new Intl.NumberFormat('es-AR').format(Number(value))
  return value
}
</script>

<style scoped>
.data-table__scroll {
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.86rem;
}

th {
  padding: 8px 10px;
  text-align: left;
  font-size: 0.76rem;
  font-weight: 600;
  color: var(--text-3);
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}

td {
  padding: 10px;
  border-bottom: 1px solid var(--border);
  color: var(--text);
}

tbody tr:last-child td {
  border-bottom: none;
}

tbody tr:hover td {
  background: var(--surface-2);
}

.right {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.data-table__empty {
  padding: 24px 0;
  text-align: center;
  color: var(--text-3);
  font-size: 0.88rem;
}
</style>
