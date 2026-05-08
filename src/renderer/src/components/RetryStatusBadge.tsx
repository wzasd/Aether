import { type RetryPhase } from '../hooks/useRetry'

const phaseLabel: Record<RetryPhase, string> = {
  idle: '待执行',
  retrying: '重试中',
  done: '已完成',
  cancelled: '已取消',
  failed: '失败',
}

interface RetryStatusBadgeProps {
  phase: RetryPhase
  attempt: number
}

export function RetryStatusBadge({ phase, attempt }: RetryStatusBadgeProps) {
  const label = phaseLabel[phase]
  const showAttempt = phase === 'retrying' && attempt > 0

  return (
    <span
      role="status"
      aria-label={`重试状态: ${label}${showAttempt ? `，第 ${attempt} 次尝试` : ''}`}
      data-retry-phase={phase}
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium
        bg-neutral-100 text-neutral-600
        data-[retry-phase=retrying]:bg-amber-50 data-[retry-phase=retrying]:text-amber-700
        data-[retry-phase=done]:bg-green-50 data-[retry-phase=done]:text-green-700
        data-[retry-phase=cancelled]:bg-gray-100 data-[retry-phase=cancelled]:text-gray-500
        data-[retry-phase=failed]:bg-red-50 data-[retry-phase=failed]:text-red-700"
    >
      {phase === 'retrying' && (
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-500" />
      )}
      {phase === 'done' && (
        <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
      )}
      {phase === 'failed' && (
        <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
      )}
      {label}
      {showAttempt && (
        <span className="tabular-nums">({attempt})</span>
      )}
    </span>
  )
}
