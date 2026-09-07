function pickFirstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function sanitizeMeta(meta) {
  if (!meta || typeof meta !== 'object') return {}
  const blocked = /(authorization|password|token|secret|credential|email|name|search|query|settings|payload|body|data|patient|client|owner)/i
  const output = {}

  for (const [key, value] of Object.entries(meta)) {
    if (blocked.test(key)) {
      output[key] = '[redacted]'
      continue
    }
    if (value == null || ['number', 'boolean'].includes(typeof value)) {
      output[key] = value
      continue
    }
    if (typeof value === 'string') {
      output[key] = value.length > 120 ? `${value.slice(0, 117)}...` : value
      continue
    }
    output[key] = '[redacted]'
  }

  return output
}

function isTransportMessage(message) {
  return /^request failed with status code/i.test(String(message || '').trim())
}

export function getErrorInfo(error, fallback = 'Ocurrió un error inesperado.') {
  const response = error?.response
  const payload = response?.data
  const payloadError = payload?.error
  const headers = response?.headers || {}
  const requestId = pickFirstString(
    payloadError?.requestId,
    payload?.requestId,
    headers['x-request-id'],
  )
  const traceId = pickFirstString(
    payloadError?.traceId,
    payload?.traceId,
    headers['x-trace-id'],
  )
  const code = pickFirstString(payloadError?.code, payload?.code)
  let message = pickFirstString(
    payloadError?.message,
    payload?.message,
    fallback,
    error?.message,
  )
  if (isTransportMessage(message)) {
    message = fallback
  }

  return {
    message,
    code: code || null,
    requestId: requestId || null,
    traceId: traceId || null,
    status: response?.status ?? null,
    details: payloadError?.details || payload?.details || null,
  }
}

export function extractErrorMessage(error, fallback = 'Ocurrió un error inesperado.', options = {}) {
  const { includeRequestId = false } = options
  const info = getErrorInfo(error, fallback)
  if (includeRequestId && info.requestId) {
    return `${info.message} Ref: ${info.requestId}`
  }
  return info.message
}

export function buildUserErrorMessage(errorInfoOrError, fallback = 'Ocurrió un error inesperado.', options = {}) {
  const info = errorInfoOrError?.message && Object.prototype.hasOwnProperty.call(errorInfoOrError, 'status')
    ? errorInfoOrError
    : getErrorInfo(errorInfoOrError, fallback)

  const cleanMessage = isTransportMessage(info.message) ? fallback : (info.message || fallback)
  const parts = [cleanMessage]
  const context = pickFirstString(options.context, options.operation)
  if (context) parts.unshift(context)

  const refs = []
  if (info.status) refs.push(`HTTP ${info.status}`)
  if (info.code) refs.push(`código ${info.code}`)
  if (info.requestId) refs.push(`ref ${info.requestId}`)
  if (info.traceId && !info.requestId) refs.push(`trace ${info.traceId}`)

  return refs.length ? `${parts.join(': ')} (${refs.join(', ')})` : parts.join(': ')
}

export function extractDetailedErrorMessage(error, fallback = 'Ocurrió un error inesperado.', options = {}) {
  return buildUserErrorMessage(error, fallback, options)
}

export function logError(scope, error, meta) {
  const prefix = `[frontend][${scope}]`
  const info = getErrorInfo(error)

  // OT-102: Never log the raw error object — it may contain PII from response payloads
  // (e.g., email addresses in error messages, user data in axios response.config).
  // Log only the sanitized fields extracted by getErrorInfo().
  const sanitized = {
    message:   info.message   || 'Unknown error',
    code:      info.code      || undefined,
    status:    info.status    || undefined,
    requestId: info.requestId || undefined,
    traceId:   info.traceId   || undefined,
    ...sanitizeMeta(meta),
  }

  // Remove undefined keys to keep the log entry clean
  for (const key of Object.keys(sanitized)) {
    if (sanitized[key] === undefined) delete sanitized[key]
  }

  const entry = {
    scope,
    ...sanitized,
    at: new Date().toISOString(),
  }

  const diagnostics = globalThis.__ANDROMEDA_DIAGNOSTICS__ ||= []
  diagnostics.push(entry)
  if (diagnostics.length > 100) diagnostics.shift()

  const severity = meta?.severity || (scope === 'app' || scope === 'unhandledrejection' || scope === 'bootstrap' ? 'fatal' : 'handled')
  if (severity === 'fatal') {
    console.error(prefix, sanitized)
  }
}
