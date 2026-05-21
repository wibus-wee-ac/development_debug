export interface FetchRetryOptions {
  /** Max number of retries. Default 3. */
  maxRetries?: number
  /** Base delay in ms for exponential backoff. Default 1000. */
  baseDelay?: number
  /** Max delay in ms. Default 30000. */
  maxDelay?: number
  /** HTTP status codes that should trigger retry. Default [429, 500, 502, 503, 504]. */
  retryableStatuses?: number[]
}

const DEFAULT_RETRYABLE_STATUSES = [429, 500, 502, 503, 504]

function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  return (
    error.name === 'TypeError'
    || error.message.includes('ECONNREFUSED')
    || error.message.includes('ECONNRESET')
    || error.message.includes('ETIMEDOUT')
    || error.message.includes('ENOTFOUND')
    || error.message.includes('fetch failed')
  )
}

export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  options?: FetchRetryOptions,
): Promise<Response> {
  const maxRetries = options?.maxRetries ?? 3
  const baseDelay = options?.baseDelay ?? 1000
  const maxDelay = options?.maxDelay ?? 30_000
  const retryableStatuses = options?.retryableStatuses ?? DEFAULT_RETRYABLE_STATUSES
  const signal = init?.signal as AbortSignal | undefined

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, init)
      if (!retryableStatuses.includes(response.status) || attempt === maxRetries) {
        return response
      }
    }
    catch (error) {
      if (signal?.aborted) {
        throw error
      }
      if (!isNetworkError(error) || attempt === maxRetries) {
        throw error
      }
    }

    if (signal?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError')
    }

    const delay = Math.min(baseDelay * 2 ** attempt, maxDelay)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, delay)
      if (signal) {
        const onAbort = () => {
          clearTimeout(timer)
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        }
        signal.addEventListener('abort', onAbort, { once: true })
      }
    })
  }

  throw new Error('fetchWithRetry: exhausted all retries')
}
