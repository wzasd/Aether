/**
 * 异步与防抖节流工具函数
 */

/**
 * 创建一个防抖函数，在最后一次调用后的指定延迟后执行
 * @param fn 要防抖的函数
 * @param delayMs 延迟毫秒数
 * @returns 防抖后的函数，附带 cancel 方法
 */
export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delayMs: number,
): { (...args: Parameters<T>): void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null

  const debounced = (...args: Parameters<T>): void => {
    if (timer !== null) {
      clearTimeout(timer)
    }
    timer = setTimeout(() => {
      timer = null
      fn(...args)
    }, delayMs)
  }

  debounced.cancel = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  return debounced
}

/**
 * 创建一个节流函数，在指定间隔内最多执行一次
 * @param fn 要节流的函数
 * @param intervalMs 间隔毫秒数
 * @returns 节流后的函数
 */
export function throttle<T extends (...args: unknown[]) => void>(
  fn: T,
  intervalMs: number,
): (...args: Parameters<T>) => void {
  let lastCallTime = 0
  let pendingCall: ReturnType<typeof setTimeout> | null = null

  return (...args: Parameters<T>): void => {
    const now = Date.now()
    const elapsed = now - lastCallTime

    if (elapsed >= intervalMs) {
      lastCallTime = now
      fn(...args)
    } else if (pendingCall === null) {
      pendingCall = setTimeout(() => {
        lastCallTime = Date.now()
        pendingCall = null
        fn(...args)
      }, intervalMs - elapsed)
    }
  }
}
