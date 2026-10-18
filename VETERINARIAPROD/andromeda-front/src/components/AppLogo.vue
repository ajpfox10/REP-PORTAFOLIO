<template>
  <div class="logo" :class="[`logo--${size}`]">
    <svg
      class="logo__mark"
      :width="dims" :height="dims"
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect width="40" height="40" rx="11" fill="var(--brand-mark-bg)" />
      <ellipse cx="20" cy="24.5" rx="7.2" ry="5.8" fill="var(--brand-mark-fg)" />
      <ellipse cx="12.4" cy="17.6" rx="2.7" ry="3.4" transform="rotate(-18 12.4 17.6)" fill="var(--brand-mark-fg)" />
      <ellipse cx="16.8" cy="13" rx="2.6" ry="3.3" transform="rotate(-6 16.8 13)" fill="var(--brand-mark-fg)" />
      <ellipse cx="23.2" cy="13" rx="2.6" ry="3.3" transform="rotate(6 23.2 13)" fill="var(--brand-mark-fg)" />
      <ellipse cx="27.6" cy="17.6" rx="2.7" ry="3.4" transform="rotate(18 27.6 17.6)" fill="var(--brand-mark-fg)" />
      <path d="M31.5 6.5l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z" fill="var(--brand-mark-accent)" />
    </svg>

    <div v-if="showText" class="logo__text">
      <span class="logo__name">Andromeda</span>
      <span class="logo__tagline">Gestión veterinaria</span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  size:     { type: String,  default: 'md' },
  showText: { type: Boolean, default: true },
})

const SIZES = { sm: 32, md: 40, lg: 48, xl: 56 }
const dims  = computed(() => SIZES[props.size] || 40)
</script>

<style scoped>
.logo {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.logo__mark { flex-shrink: 0; }

.logo__text {
  display: flex;
  flex-direction: column;
  line-height: 1.1;
  user-select: none;
}

.logo__name {
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text);
}

.logo__tagline {
  font-size: 0.7rem;
  font-weight: 500;
  color: var(--text-3);
}

.logo--lg .logo__name,
.logo--xl .logo__name { font-size: 1.35rem; }

.logo--lg .logo__tagline,
.logo--xl .logo__tagline { font-size: 0.78rem; }
</style>
