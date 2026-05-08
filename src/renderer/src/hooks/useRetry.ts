import { useCallback, useRef, useState } from 'react'
import { retry, RetryCancelledError, type RetryOptions } from '../../../utils/retry'

export type RetryPhase = 'idle' | 'retrying' | 'done' | 'cancelled' | 'failed'

export interface UseRetryState {
  phase: RetryPhase
  attempt: number
  error: unknown
}

export function useRetry() {
  const [state, setState] = useState<UseRetryState>({
    phase: 'idle',
    attempt: 0,
    error: null,
  })

  const abortRef = useRef<AbortController | null>(null)

  const execute = useCallback(
    async <T>(
      fn: (attempt: number) => Promise<T>,
      options: Omit<RetryOptions, 'signal'> = {},
    ): Promise<T | undefined> => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setState({ phase: 'retrying', attempt: 1, error: null })

      try {
        const result = await retry(fn, {
          ...options,
          signal: controller.signal,
          onRetry: (error, attempt, delayMs) => {
            options.onRetry?.(error, attempt, delayMs)
            setState({ phase: 'retrying', attempt, error })
          },
        })
        setState({ phase: 'done', attempt: 0, error: null })
        return result
      } catch (error: unknown) {
        if (error instanceof RetryCancelledError) {
          setState((prev) => ({ ...prev, phase: 'cancelled' }))
        } else {
          setState({ phase: 'failed', attempt: 0, error })
        }
        return undefined
      }
    },
    [],
  )

  const cancel = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const reset = useCallback(() => {
    setState({ phase: 'idle', attempt: 0, error: null })
  }, [])

  return { ...state, execute, cancel, reset }
}
