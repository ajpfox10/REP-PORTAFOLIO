<template>
  <button
    :type="type"
    class="base-button"
    :class="[`base-button--${variant}`, `base-button--${size}`, { 'base-button--block': block }]"
    :disabled="disabled"
    v-bind="$attrs"
  >
    <slot />
  </button>
</template>

<script setup>
defineProps({
  type: { type: String, default: 'button' },
  variant: { type: String, default: 'primary' },
  block: { type: Boolean, default: false },
  size: { type: String, default: 'md' },
  disabled: { type: Boolean, default: false },
})
</script>

<style scoped>
.base-button {
  min-height: 38px;
  padding: 10px 16px;
  border-radius: var(--radius);
  border: 1px solid transparent;
  cursor: pointer;
  font-weight: 700;
  letter-spacing: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  white-space: nowrap;
  transition: background var(--transition), border-color var(--transition), color var(--transition), box-shadow var(--transition);
}

.base-button--primary {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--white);
  box-shadow: 0 1px 2px rgba(15, 118, 110, 0.18);
}

.base-button--primary:hover:not(:disabled) {
  background: var(--primary-hover);
  border-color: var(--primary-hover);
}

.base-button--secondary {
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text);
}

.base-button--secondary:hover:not(:disabled),
.base-button--ghost:hover:not(:disabled) {
  background: var(--surface-2);
  border-color: var(--border-strong);
}

.base-button--ghost {
  background: transparent;
  border-color: transparent;
  color: var(--text-2);
}

.base-button--danger {
  background: var(--danger);
  border-color: var(--danger);
  color: var(--white);
}

.base-button--danger:hover:not(:disabled) {
  background: #B91C1C;
  border-color: #B91C1C;
}

.base-button--sm {
  min-height: 32px;
  padding: 7px 12px;
  font-size: 0.85rem;
}

.base-button--md {
  min-height: 38px;
  padding: 10px 16px;
  font-size: 0.9rem;
}

.base-button--lg {
  min-height: 44px;
  padding: 12px 20px;
  font-size: 1rem;
}

.base-button--block {
  width: 100%;
}

.base-button:hover:not(:disabled) {
  box-shadow: var(--shadow-sm);
}

.base-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
