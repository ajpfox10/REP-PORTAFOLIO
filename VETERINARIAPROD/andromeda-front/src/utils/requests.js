export function unwrapData(response) {
  return response?.data?.data ?? response?.data ?? response
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function getWithRetry(requestFn, options = {}) {
  const attempts = options.attempts ?? 2
  const delayMs = options.delayMs ?? 250
  const shouldRetry = options.shouldRetry || ((error, attempt) => {
    const status = error?.response?.status
    return attempt < attempts && (!status || [408, 409, 425, 429, 502, 503, 504].includes(status))
  })

  let lastError = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await requestFn()
    } catch (error) {
      lastError = error
      if (!shouldRetry(error, attempt, attempts)) throw error
      await sleep(delayMs)
    }
  }

  throw lastError
}
