import { useUiFeedbackStore } from '../stores/uiFeedback'
import { buildUserErrorMessage, getErrorInfo, logError } from '../utils/errors'

export function useUiFeedback() {
  const feedback = useUiFeedbackStore()

  function notifyError(scope, error, fallback, options = {}) {
    const info = getErrorInfo(error, fallback)
    logError(scope, error, options.meta)
    feedback.error(buildUserErrorMessage(info, fallback, options), {
      title: options.title || 'No se pudo completar la accion',
      detail: options.detail || '',
    })
    return info.message
  }

  return {
    feedback,
    notify: feedback.notify,
    success: feedback.success,
    info: feedback.info,
    warning: feedback.warning,
    error: feedback.error,
    confirm: feedback.confirm,
    notifyError,
  }
}
