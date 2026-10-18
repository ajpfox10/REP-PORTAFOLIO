<template>
  <div class="column-chart">
    <div v-if="!items.length" class="column-chart__empty">{{ emptyText }}</div>
    <div v-else ref="wrapRef" class="column-chart__plot" @mouseleave="hover = null">
      <svg :viewBox="`0 0 ${width} ${height}`" :height="height" :width="width" role="img" :aria-label="ariaLabel">
        <!-- Grilla: hairline sólida, recesiva -->
        <g v-for="tick in ticks" :key="tick.value">
          <line :x1="padLeft" :x2="width" :y1="tick.y" :y2="tick.y" class="grid" />
        </g>
        <!-- Columnas: ≤24px, punta redondeada 4px, base recta -->
        <g v-for="(bar, index) in bars" :key="bar.label">
          <rect
            :x="bar.slotX" :y="0" :width="bar.slotWidth" :height="plotBottom"
            class="hit"
            tabindex="0"
            :aria-label="`${bar.label}: ${format(bar.value)}`"
            @mouseenter="hover = index"
            @focus="hover = index"
            @blur="hover = null"
          />
          <path :d="bar.path" class="bar" :class="{ 'bar--dim': hover !== null && hover !== index }" />
        </g>
      </svg>
      <!-- Ejes en HTML para que el texto no se deforme con el viewBox -->
      <div class="column-chart__yaxis" :style="{ height: plotBottom + 'px' }">
        <span v-for="tick in ticks" :key="tick.value" :style="{ top: tick.y + 'px' }">{{ compact(tick.value) }}</span>
      </div>
      <div class="column-chart__xaxis">
        <span v-for="(bar, index) in bars" :key="bar.label" :style="{ left: pct(bar.center) }" :class="{ hidden: !showXLabel(index) }">
          {{ bar.short }}
        </span>
      </div>
      <div v-if="hover !== null" class="tooltip" :style="tooltipStyle" role="status">
        <strong>{{ bars[hover].label }}</strong>
        <span>{{ format(bars[hover].value) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  items: { type: Array, default: () => [] },          // [{ label, short?, value }]
  format: { type: Function, default: (v) => String(v) },
  height: { type: Number, default: 220 },
  ariaLabel: { type: String, default: 'Gráfico de columnas' },
  emptyText: { type: String, default: 'Sin datos para el período elegido.' },
})

const width = ref(720)
const padLeft = 44
const plotBottom = computed(() => props.height - 24)
const hover = ref(null)
const wrapRef = ref(null)

// El SVG usa el ancho real del contenedor: así las columnas no se estiran.
let observer = null
function observe(el) {
  observer?.disconnect()
  if (!el || typeof ResizeObserver === 'undefined') return
  observer = new ResizeObserver(([entry]) => {
    width.value = Math.max(240, Math.round(entry.contentRect.width))
  })
  observer.observe(el)
}
onMounted(() => observe(wrapRef.value))
watch(wrapRef, (el) => observe(el))
onBeforeUnmount(() => observer?.disconnect())

function niceMax(max) {
  if (max <= 0) return 1
  const exp = 10 ** Math.floor(Math.log10(max))
  const step = [1, 2, 2.5, 5, 10].find((m) => m * exp >= max / 1) || 10
  return step * exp
}

const maxValue = computed(() => niceMax(Math.max(...props.items.map((i) => Number(i.value) || 0), 0)))

const ticks = computed(() => [0, 0.5, 1].map((f) => ({
  value: maxValue.value * f,
  y: plotBottom.value - f * (plotBottom.value - 8),
})))

const bars = computed(() => {
  const n = props.items.length
  const slot = (width.value - padLeft) / Math.max(n, 1)
  const barWidth = Math.min(24, slot * 0.6)
  return props.items.map((item, index) => {
    const value = Number(item.value) || 0
    const h = (value / maxValue.value) * (plotBottom.value - 8)
    const x = padLeft + index * slot + (slot - barWidth) / 2
    const y = plotBottom.value - h
    const r = Math.min(4, h, barWidth / 2)
    // Punta redondeada arriba, base recta sobre el eje
    const path = h <= 0 ? '' : `M${x},${plotBottom.value} V${y + r} Q${x},${y} ${x + r},${y} H${x + barWidth - r} Q${x + barWidth},${y} ${x + barWidth},${y + r} V${plotBottom.value} Z`
    return {
      label: item.label,
      short: item.short || item.label,
      value,
      path,
      slotX: padLeft + index * slot,
      slotWidth: slot,
      center: padLeft + index * slot + slot / 2,
      top: y,
    }
  })
})

function pct(x) {
  return `${(x / width.value) * 100}%`
}

// Con muchas columnas se etiqueta una de cada N para que no se pisen
function showXLabel(index) {
  const n = bars.value.length
  const every = n > 16 ? Math.ceil(n / 8) : n > 8 ? 2 : 1
  return index % every === 0 || index === n - 1
}

function compact(value) {
  return new Intl.NumberFormat('es-AR', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

const tooltipStyle = computed(() => {
  const bar = bars.value[hover.value]
  if (!bar) return {}
  return { left: pct(bar.center), top: `${Math.max(0, bar.top - 8)}px` }
})
</script>

<style scoped>
.column-chart__plot {
  position: relative;
  padding-bottom: 22px;
}

svg {
  display: block;
  overflow: visible;
}

.grid {
  stroke: var(--chart-grid);
  stroke-width: 1;
}

.bar {
  fill: var(--chart-series);
  transition: opacity var(--transition);
}

.bar--dim {
  opacity: 0.45;
}

.hit {
  fill: transparent;
  cursor: default;
  outline: none;
}

.column-chart__yaxis {
  position: absolute;
  left: 0;
  top: 0;
  width: 40px;
  pointer-events: none;
}

.column-chart__yaxis span {
  position: absolute;
  right: 0;
  transform: translateY(-50%);
  font-size: 0.72rem;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}

.column-chart__xaxis {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 20px;
  pointer-events: none;
}

.column-chart__xaxis span {
  position: absolute;
  transform: translateX(-50%);
  font-size: 0.72rem;
  color: var(--text-3);
  white-space: nowrap;
}

.column-chart__xaxis span.hidden {
  visibility: hidden;
}

.tooltip {
  position: absolute;
  transform: translate(-50%, -100%);
  padding: 6px 10px;
  border-radius: var(--radius);
  background: var(--text);
  color: var(--bg);
  font-size: 0.78rem;
  display: flex;
  flex-direction: column;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: var(--shadow);
}

.tooltip span {
  font-variant-numeric: tabular-nums;
}

.column-chart__empty {
  padding: 40px 0;
  text-align: center;
  color: var(--text-3);
  font-size: 0.88rem;
}
</style>
