import { Loader2, CheckCircle2, AlertCircle, CircleDashed } from 'lucide-react'

interface AgentStatusBadgeProps {
  isActive: boolean
  isProcessing: boolean
  pendingCount: number
  size?: 'sm' | 'md'
}

export function AgentStatusBadge({ isActive, isProcessing, pendingCount, size = 'sm' }: AgentStatusBadgeProps) {
  if (!isActive) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
        <CircleDashed size={size === 'md' ? 12 : 10} />
        idle
      </span>
    )
  }

  if (isProcessing) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-amber-400">
        <Loader2 size={size === 'md' ? 12 : 10} className="animate-spin" />
        busy
      </span>
    )
  }

  if (pendingCount > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-blue-400">
        <AlertCircle size={size === 'md' ? 12 : 10} />
        {pendingCount} pending
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400">
      <CheckCircle2 size={size === 'md' ? 12 : 10} />
      active
    </span>
  )
}
