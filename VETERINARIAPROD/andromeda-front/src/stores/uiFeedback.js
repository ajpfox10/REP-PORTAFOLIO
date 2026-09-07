import { defineStore } from 'pinia'

let nextToastId = 1
let nextConfirmId = 1

export const useUiFeedbackStore = defineStore('uiFeedback', {
  state: () => ({
    toasts: [],
    confirmRequest: null,
  }),
  actions: {
    notify(payload = {}) {
      const id = nextToastId++
      const toast = {
        id,
        type: payload.type || 'info',
        title: payload.title || '',
        message: payload.message || '',
        detail: payload.detail || '',
        timeout: payload.timeout ?? 6500,
      }
      this.toasts.push(toast)
      if (toast.timeout > 0) {
        window.setTimeout(() => this.dismiss(id), toast.timeout)
      }
      return id
    },
    success(message, options = {}) {
      return this.notify({ ...options, message, type: 'success' })
    },
    info(message, options = {}) {
      return this.notify({ ...options, message, type: 'info' })
    },
    warning(message, options = {}) {
      return this.notify({ ...options, message, type: 'warning' })
    },
    error(message, options = {}) {
      return this.notify({ ...options, message, type: 'error', timeout: options.timeout ?? 9000 })
    },
    dismiss(id) {
      this.toasts = this.toasts.filter((toast) => toast.id !== id)
    },
    confirm(options = {}) {
      return new Promise((resolve) => {
        this.confirmRequest = {
          id: nextConfirmId++,
          title: options.title || 'Confirmar accion',
          message: options.message || 'Esta accion requiere confirmacion.',
          confirmText: options.confirmText || 'Confirmar',
          cancelText: options.cancelText || 'Cancelar',
          variant: options.variant || 'danger',
          resolve,
        }
      })
    },
    resolveConfirm(value) {
      if (!this.confirmRequest) return
      const resolver = this.confirmRequest.resolve
      this.confirmRequest = null
      resolver(Boolean(value))
    },
  },
})
