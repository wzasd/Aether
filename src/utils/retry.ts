/**
 * 异步重试与指数退避工具
 */

export class RetryCancelledError extends Error {
  constructor() {
    super('Retry cancelled via AbortSignal')
    this.name = 'RetryCancelledError'
  }
}

export interface RetryOptions {
  /** 最大重试次数，默认 3 */
  maxRetries?: number
  /** 初始延迟毫秒数，默认 1000 */
  baseDelayMs?: number
  /** 退避倍数，默认 2（即延迟按 1s, 2s, 4s 递增） */
  backoffMultiplier?: number
  /** 最大延迟上限毫秒数，默认 30000 */
  maxDelayMs?: number
  /**
   * 判断错误是否可重试，默认全部可重试
   * @param error 捕获的错误
   * @param attempt 当前尝试次数（从 1 开始，与 fn 收到的 attempt 一致）
   */
  shouldRetry?: (error: unknown, attempt: number) => boolean
  /**
   * 每次重试时的回调，用于日志或监控
   * @param error 导致重试的错误
   * @param attempt 当前尝试次数
   * @param delayMs 本次等待的延迟毫秒数
   */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void
  /** AbortSignal 用于取消重试 */
  signal?: AbortSignal
}

/**
 * 可取消的延迟，正确处理 AbortSignal 监听器清理
 */
function delayWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new RetryCancelledError())
    }

    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new RetryCancelledError())
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)

    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * 带指数退避和抖动的异步重试执行器
 * @param fn 要重试的异步函数，接收当前尝试次数（从 1 开始）
 * @param options 重试配置
 * @returns fn 的返回值
 */
export async function retry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    backoffMultiplier = 2,
    maxDelayMs = 30000,
    shouldRetry = () => true,
    onRetry,
    signal,
  } = options

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    if (signal?.aborted) {
      throw new RetryCancelledError()
    }

    try {
      return await fn(attempt)
    } catch (error: unknown) {
      const isLastAttempt = attempt > maxRetries
      if (isLastAttempt || !shouldRetry(error, attempt)) {
        throw error
      }

      const delay = Math.min(
        baseDelayMs * Math.pow(backoffMultiplier, attempt - 1),
        maxDelayMs,
      )

      // Full jitter: 在 0 到计算延迟之间随机取值，避免惊群效应
      const jitteredDelay = Math.random() * delay

      onRetry?.(error, attempt, jitteredDelay)

      await delayWithAbort(jitteredDelay, signal)
    }
  }

  // 理论上不可达，作为防御性安全网保留
  throw new Error('Unexpected: retry loop exited without return or throw')
}
