/**
 * ProviderTokenTracker — lightweight per-provider token usage tracking.
 *
 * Records input/output tokens from AIEvent.complete usage data.
 * In-memory only (resets on app restart). Aligns with Multica Cost column.
 */

interface UsageEntry {
  inputTokens: number
  outputTokens: number
  timestamp: number
}

const usageLog = new Map<string, UsageEntry[]>() // providerId -> entries
const MAX_ENTRIES = 10000 // Prevent unbounded growth

export function recordProviderUsage(providerId: string, inputTokens: number, outputTokens: number): void {
  const entries = usageLog.get(providerId) ?? []
  entries.push({ inputTokens, outputTokens, timestamp: Date.now() })
  // Trim old entries if exceeding max
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES)
  }
  usageLog.set(providerId, entries)
}

export function getProviderUsage(providerId: string, days = 7): { inputTokens: number; outputTokens: number; totalTokens: number } {
  const entries = usageLog.get(providerId) ?? []
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  let inputTokens = 0
  let outputTokens = 0
  for (const entry of entries) {
    if (entry.timestamp >= cutoff) {
      inputTokens += entry.inputTokens
      outputTokens += entry.outputTokens
    }
  }
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens }
}

export function getAllProviderUsage(days = 7): Map<string, { inputTokens: number; outputTokens: number; totalTokens: number }> {
  const result = new Map<string, { inputTokens: number; outputTokens: number; totalTokens: number }>()
  usageLog.forEach((_entries, providerId) => {
    result.set(providerId, getProviderUsage(providerId, days))
  })
  return result
}
