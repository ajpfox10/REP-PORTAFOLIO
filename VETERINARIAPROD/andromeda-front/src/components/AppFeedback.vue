<template>
  <teleport to="body">
    <div class="feedback-toasts" aria-live="polite" aria-atomic="false">
      <article
        v-for="toast in feedback.toasts"
        :key="toast.id"
        class="feedback-toast"
        :class="`feedback-toast--${toast.type}`"
        role="status"
      >
        <div class="feedback-toast__icon" aria-hidden="true">{{ iconFor(toast.type) }}</div>
        <div class="feedback-toast__body">
          <strong v-if="toast.title">{{ toast.title }}</strong>
          <p>{{ toast.message }}</p>
          <small v-if="toast.detail">{{ toast.detail }}</small>
        </div>
        <button type="button" class="feedback-toast__close" aria-label="Cerrar aviso" @click="feedback.dismiss(toast.id)">
          &times;
        </button>
      </article>
    </div>

    <div v-if="feedback.confirmRequest" class="confirm-backdrop" @click.self="feedback.resolveConfirm(false)">
      <section class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <div class="confirm-dialog__icon" :class="`confirm-dialog__icon--${feedback.confirmRequest.variant}`" aria-hidden="true">
          {{ feedback.confirmRequest.variant === 'danger' ? '!' : '?' }}
        </div>
        <div class="confirm-dialog__body">
          <h2 id="confirm-title">{{ feedback.confirmRequest.title }}</h2>
          <p>{{ feedback.confirmRequest.message }}</p>
        </div>
        <div class="confirm-dialog__actions">
          <button type="button" class="confirm-dialog__button confirm-dialog__button--ghost" @click="feedback.resolveConfirm(false)">
            {{ feedback.confirmRequest.cancelText }}
          </button>
          <button
            type="button"
            class="confirm-dialog__button"
            :class="`confirm-dialog__button--${feedback.confirmRequest.variant}`"
            @click="feedback.resolveConfirm(true)"
          >
            {{ feedback.confirmRequest.confirmText }}
          </button>
        </div>
      </section>
    </div>
  </teleport>
</template>

<script setup>
import { useUiFeedbackStore } from '../stores/uiFeedback'

const feedback = useUiFeedbackStore()

function iconFor(type) {
  return {
    success: 'OK',
    error: '!',
    warning: '!',
    info: 'i',
  }[type] || 'i'
}
</script>

<style scoped>
.feedback-toasts {
  position: fixed;
  top: 18px;
  right: 18px;
  z-index: 2200;
  width: min(420px, calc(100vw - 32px));
  display: flex;
  flex-direction: column;
  gap: 10px;
  pointer-events: none;
}

.feedback-toast {
  display: grid;
  grid-template-columns: 34px 1fr 30px;
  gap: 10px;
  align-items: start;
  padding: 12px;
  border: 1px solid var(--border);
  border-left-width: 4px;
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: var(--shadow-lg);
  pointer-events: auto;
}

.feedback-toast--success { border-left-color: var(--success); }
.feedback-toast--error { border-left-color: var(--danger); }
.feedback-toast--warning { border-left-color: var(--warning); }
.feedback-toast--info { border-left-color: var(--info); }

.feedback-toast__icon {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 0.78rem;
  font-weight: 900;
  color: var(--white);
  background: var(--info);
}

.feedback-toast--success .feedback-toast__icon { background: var(--success); }
.feedback-toast--error .feedback-toast__icon { background: var(--danger); }
.feedback-toast--warning .feedback-toast__icon { background: var(--warning); }

.feedback-toast__body {
  display: grid;
  gap: 3px;
}

.feedback-toast__body strong {
  font-size: 0.88rem;
  color: var(--text);
}

.feedback-toast__body p {
  margin: 0;
  color: var(--text-2);
  font-size: 0.88rem;
  line-height: 1.35;
}

.feedback-toast__body small {
  color: var(--text-3);
  font-size: 0.76rem;
}

.feedback-toast__close {
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  font-size: 1.25rem;
  line-height: 1;
}

.feedback-toast__close:hover {
  background: var(--surface-2);
  color: var(--text);
}

.confirm-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2100;
  display: grid;
  place-items: center;
  padding: 18px;
  background: rgba(15, 23, 42, 0.48);
}

.confirm-dialog {
  width: min(460px, 100%);
  display: grid;
  grid-template-columns: 44px 1fr;
  gap: 14px;
  padding: 20px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: var(--shadow-lg);
}

.confirm-dialog__icon {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-weight: 900;
  background: var(--info-light);
  color: var(--info);
}

.confirm-dialog__icon--danger {
  background: var(--danger-light);
  color: var(--danger);
}

.confirm-dialog__body h2 {
  margin: 0 0 6px;
  font-size: 1.05rem;
}

.confirm-dialog__body p {
  margin: 0;
  color: var(--text-2);
  line-height: 1.45;
}

.confirm-dialog__actions {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 6px;
}

.confirm-dialog__button {
  min-height: 38px;
  padding: 9px 14px;
  border-radius: var(--radius);
  border: 1px solid var(--primary);
  background: var(--primary);
  color: var(--white);
  font-weight: 800;
  cursor: pointer;
}

.confirm-dialog__button--danger {
  border-color: var(--danger);
  background: var(--danger);
}

.confirm-dialog__button--ghost {
  border-color: var(--border);
  background: var(--surface);
  color: var(--text);
}

@media (max-width: 640px) {
  .feedback-toasts {
    top: 10px;
    right: 10px;
    width: calc(100vw - 20px);
  }

  .confirm-dialog__actions {
    flex-direction: column-reverse;
  }

  .confirm-dialog__button {
    width: 100%;
  }
}
</style>
