/**
 * API Client Layer — unified fetch wrapper for Renderer ↔ Daemon HTTP communication.
 *
 * Replaces ipcRenderer.invoke() with fetch() + SSE EventSource.
 * ADR-019: Renderer HTTP Migration
 */

const BASE_URL = `http://127.0.0.1:${window.__BYTRO_PORT__ ?? 5175}`

/** Number of retries for transient network errors */
const MAX_RETRIES = 1

/** Delay between retries in ms */
const RETRY_DELAY_MS = 1000

/** Structured error for HTTP API failures */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/** Global error hooks (set by app bootstrap if needed) */
let globalAuthErrorHandler: (() => void) | null = null
let globalServerErrorHandler: ((status: number, message: string) => void) | null = null

export function setGlobalAuthErrorHandler(handler: () => void): void {
  globalAuthErrorHandler = handler
}

export function setGlobalServerErrorHandler(handler: (status: number, message: string) => void): void {
  globalServerErrorHandler = handler
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Generic fetch wrapper with:
 * - credentials: 'include' (session cookie)
 * - JSON Content-Type
 * - auto-retry on network errors (1 retry)
 * - structured ApiError on HTTP error status
 */
export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${BASE_URL}${path}`
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const hasBody = options?.body !== undefined
      const res = await fetch(url, {
        credentials: 'include',
        headers: {
          ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
          ...options?.headers,
        },
        ...options,
      })

      if (!res.ok) {
        const text = await res.text()
        if (res.status === 401 && globalAuthErrorHandler) {
          globalAuthErrorHandler()
        } else if (res.status === 501 && globalServerErrorHandler) {
          globalServerErrorHandler(res.status, text)
        }
        throw new ApiError(res.status, text)
      }

      return (await res.json()) as T
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      // Don't retry on 4xx client errors (except 429 which is handled by normal retry)
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
        throw err
      }
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS)
      }
    }
  }

  throw lastError ?? new Error('Unknown fetch error')
}

/**
 * Create an SSE EventSource with credentials.
 */
export function createEventSource(path: string): EventSource {
  return new EventSource(`${BASE_URL}${path}`, { withCredentials: true })
}
