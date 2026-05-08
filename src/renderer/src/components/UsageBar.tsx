import { useUsageStore } from '../stores/usageStore'
import { useChatStore } from '../stores/chatStore'

export function UsageBar() {
  const currentConversation = useChatStore((s) => s.currentConversation)
  const getConversationTotal = useUsageStore((s) => s.getConversationTotal)

  if (!currentConversation) return null
  const usage = getConversationTotal(currentConversation.id)
  if (!usage) return null

  const hasCache = usage.cacheReadTokens > 0 || usage.cacheCreationTokens > 0

  return (
    <div className="flex items-center gap-3 px-4 py-1.5 text-xs text-muted-foreground border-t border-border bg-muted/20 flex-wrap">
      <span>输入 {usage.inputTokens.toLocaleString()}</span>
      <span>输出 {usage.outputTokens.toLocaleString()}</span>
      {hasCache && (
        <>
          {usage.cacheReadTokens > 0 && (
            <span className="text-emerald-500">
              缓存命中 {usage.cacheReadTokens.toLocaleString()}
            </span>
          )}
          {usage.cacheCreationTokens > 0 && (
            <span className="text-amber-400">
              缓存写入 {usage.cacheCreationTokens.toLocaleString()}
            </span>
          )}
        </>
      )}
      <span className="tabular-nums">
        费用 ${usage.costUsd.toFixed(4)}
      </span>
    </div>
  )
}
