// Cliente HTTP: misma sesión por cookie httpOnly y token CSRF en cada mutación.

export class ApiError extends Error {
  status: number
  code: string
  details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }

  get fields(): Record<string, string> {
    const d = this.details
    return d && typeof d === 'object' && !Array.isArray(d) ? (d as Record<string, string>) : {}
  }
}

let csrfToken: string | null = null

async function ensureCsrf(): Promise<string> {
  if (csrfToken) return csrfToken
  const res = await fetch('/api/csrf', { credentials: 'same-origin' })
  csrfToken = (await res.json()).csrfToken as string
  return csrfToken
}

async function request<T>(method: string, url: string, body?: unknown, retried = false): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json'
    headers['X-CSRF-Token'] = await ensureCsrf()
  }
  let res: Response
  try {
    res = await fetch(`/api${url}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'NETWORK', 'No pudimos conectarnos. Revisá tu conexión.')
  }

  const data = res.status === 204 ? null : await res.json().catch(() => null)
  if (!res.ok) {
    const error = data?.error ?? {}
    // El token CSRF pudo haber vencido: se pide uno nuevo y se reintenta una vez
    if (error.code === 'CSRF_INVALID' && !retried) {
      csrfToken = null
      return request<T>(method, url, body, true)
    }
    throw new ApiError(res.status, error.code ?? 'ERROR', error.message ?? 'Ocurrió un error inesperado', error.details)
  }
  return data as T
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body ?? {}),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body ?? {}),
}

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '' && value !== false) search.set(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}
