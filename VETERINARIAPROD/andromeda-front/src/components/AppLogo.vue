<template>
  <div class="logo" :class="[`logo--${size}`]">
    <svg
      :width="dims" :height="dims"
      viewBox="0 0 80 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <!-- Fondo circular con gradiente suave -->
      <circle cx="40" cy="40" r="38" fill="url(#bgCircle)"/>

      <!-- ── Pata central ────────────────────────────── -->
      <!-- Palma -->
      <ellipse cx="40" cy="47" rx="13" ry="10.5" fill="url(#palmGrad)"/>

      <!-- Dedo superior izquierdo -->
      <ellipse cx="26" cy="35" rx="5.2" ry="6.5" fill="url(#fingerGrad)" transform="rotate(-18 26 35)"/>
      <!-- Dedo superior derecho -->
      <ellipse cx="54" cy="35" rx="5.2" ry="6.5" fill="url(#fingerGrad)" transform="rotate(18 54 35)"/>
      <!-- Dedo izquierdo -->
      <ellipse cx="31" cy="30" rx="4.8" ry="6" fill="url(#fingerGrad)" transform="rotate(-8 31 30)"/>
      <!-- Dedo derecho -->
      <ellipse cx="49" cy="30" rx="4.8" ry="6" fill="url(#fingerGrad)" transform="rotate(8 49 30)"/>

      <!-- ── Destellos / Estrellas espaciales ────────── -->
      <!-- Estrella grande arriba derecha -->
      <g transform="translate(63, 18)">
        <path d="M0 -6 L1.4 -1.4 L6 0 L1.4 1.4 L0 6 L-1.4 1.4 L-6 0 L-1.4 -1.4 Z"
          fill="url(#starGold)" opacity="0.95"/>
      </g>
      <!-- Estrella pequeña arriba izquierda -->
      <g transform="translate(16, 14)">
        <path d="M0 -4 L0.9 -0.9 L4 0 L0.9 0.9 L0 4 L-0.9 0.9 L-4 0 L-0.9 -0.9 Z"
          fill="url(#starTeal)" opacity="0.9"/>
      </g>
      <!-- Estrella mediana izq abajo -->
      <g transform="translate(10, 54)">
        <path d="M0 -3.5 L0.8 -0.8 L3.5 0 L0.8 0.8 L0 3.5 L-0.8 0.8 L-3.5 0 L-0.8 -0.8 Z"
          fill="url(#starGold)" opacity="0.85"/>
      </g>
      <!-- Estrella pequeña der abajo -->
      <g transform="translate(68, 58)">
        <path d="M0 -3 L0.7 -0.7 L3 0 L0.7 0.7 L0 3 L-0.7 0.7 L-3 0 L-0.7 -0.7 Z"
          fill="url(#starTeal)" opacity="0.85"/>
      </g>

      <!-- Puntos de brillo -->
      <circle cx="58" cy="10" r="2"   fill="#FFD166" opacity="0.8"/>
      <circle cx="21" cy="62" r="1.5" fill="#06D6A0" opacity="0.75"/>
      <circle cx="70" cy="36" r="1.5" fill="#FFD166" opacity="0.7"/>
      <circle cx="12" cy="34" r="1.2" fill="#06D6A0" opacity="0.7"/>
      <circle cx="42" cy="9"  r="1.5" fill="#FFD166" opacity="0.65"/>
      <circle cx="64" cy="68" r="1.2" fill="#06D6A0" opacity="0.65"/>

      <!-- Arco orbital decorativo -->
      <ellipse cx="40" cy="40" rx="36" ry="12"
        stroke="url(#orbitGrad)" stroke-width="1"
        stroke-dasharray="4 3" fill="none" opacity="0.35"
        transform="rotate(-30 40 40)"/>

      <!-- Gradients -->
      <defs>
        <radialGradient id="bgCircle" cx="40%" cy="35%">
          <stop offset="0%"   stop-color="#E8FAF5"/>
          <stop offset="100%" stop-color="#D0F0E8"/>
        </radialGradient>
        <radialGradient id="palmGrad" cx="45%" cy="40%">
          <stop offset="0%"   stop-color="#2AB89A"/>
          <stop offset="100%" stop-color="#1A8870"/>
        </radialGradient>
        <radialGradient id="fingerGrad" cx="45%" cy="35%">
          <stop offset="0%"   stop-color="#34C9A8"/>
          <stop offset="100%" stop-color="#1E9E80"/>
        </radialGradient>
        <linearGradient id="starGold" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stop-color="#FFE066"/>
          <stop offset="100%" stop-color="#FFB703"/>
        </linearGradient>
        <linearGradient id="starTeal" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stop-color="#06D6A0"/>
          <stop offset="100%" stop-color="#059B74"/>
        </linearGradient>
        <linearGradient id="orbitGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stop-color="#34C9A8" stop-opacity="0"/>
          <stop offset="50%"  stop-color="#34C9A8"/>
          <stop offset="100%" stop-color="#34C9A8" stop-opacity="0"/>
        </linearGradient>
      </defs>
    </svg>

    <div v-if="showText" class="logo__text">
      <span class="logo__name">Sistema</span>
      <span class="logo__brand">Andromeda</span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  size:     { type: String,  default: 'md' },
  showText: { type: Boolean, default: true },
})

const SIZES = { sm: 40, md: 56, lg: 72, xl: 96 }
const dims  = computed(() => SIZES[props.size] || 56)
</script>

<style scoped>
.logo { display: flex; align-items: center; gap: 12px; }
.logo--sm { gap: 8px;  }
.logo--lg { gap: 14px; }
.logo--xl { gap: 16px; }

.logo__text { display: flex; flex-direction: column; line-height: 1.15; user-select: none; }

.logo__name {
  font-size: 0.7rem; font-weight: 600;
  color: var(--text-2);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.logo__brand {
  font-size: 1.45rem; font-weight: 800;
  color: var(--primary);
  letter-spacing: 0.01em;
}

.logo--sm .logo__name  { font-size: 0.62rem; }
.logo--sm .logo__brand { font-size: 1.05rem; }
.logo--lg .logo__brand { font-size: 1.75rem; }
.logo--xl .logo__name  { font-size: 0.78rem; }
.logo--xl .logo__brand { font-size: 2rem;    }
</style>
