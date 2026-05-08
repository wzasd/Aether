import { create } from 'zustand'

export interface UsageRecord {
  conversationId: string
  model: string
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  costUsd: number
  timestamp: number
}

interface UsageState {
  currentUsage: Record<string, UsageRecord>
}

export const useUsageStore = create<UsageState & {
  updateFromComplete: (conversationId: string, event: { usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheCreationTokens?: number }; costUsd?: number; model?: string }) => void
  loadFromDB: (conversationId: string, records: Array<{ model: string; input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_creation_tokens: number; cost_usd: number }>) => void
  getConversationTotal: (conversationId: string) => UsageRecord | null
  clearCurrent: (conversationId: string) => void
}>((set, get) => ({
  currentUsage: {},
  updateFromComplete: (conversationId, event) => {
    const existing = get().currentUsage[conversationId]
    const usage = event.usage
    if (!usage) return
    set({
      currentUsage: {
        ...get().currentUsage,
        [conversationId]: {
          conversationId,
          model: event.model || 'unknown',
          inputTokens: (existing?.inputTokens || 0) + usage.inputTokens,
          outputTokens: (existing?.outputTokens || 0) + usage.outputTokens,
          cacheCreationTokens: (existing?.cacheCreationTokens || 0) + (usage.cacheCreationTokens || 0),
          cacheReadTokens: (existing?.cacheReadTokens || 0) + (usage.cacheReadTokens || 0),
          costUsd: (existing?.costUsd || 0) + (event.costUsd || 0),
          timestamp: Date.now()
        }
      }
    })
  },
  loadFromDB: (conversationId, records) => {
    if (records.length === 0) return
    // Pick model with most total tokens for display
    const modelTotals = new Map<string, number>()
    for (const r of records) {
      modelTotals.set(r.model, (modelTotals.get(r.model) || 0) + r.input_tokens + r.output_tokens)
    }
    let dominantModel = records[0].model
    let maxTokens = 0
    modelTotals.forEach((tokens, model) => {
      if (tokens > maxTokens) { maxTokens = tokens; dominantModel = model }
    })
    const acc = records.reduce((sum, r) => ({
      conversationId,
      model: dominantModel,
      inputTokens: sum.inputTokens + r.input_tokens,
      outputTokens: sum.outputTokens + r.output_tokens,
      cacheCreationTokens: sum.cacheCreationTokens + r.cache_creation_tokens,
      cacheReadTokens: sum.cacheReadTokens + r.cache_read_tokens,
      costUsd: sum.costUsd + r.cost_usd,
      timestamp: Date.now()
    }), { conversationId, model: dominantModel, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, costUsd: 0, timestamp: 0 } as UsageRecord)
    set({ currentUsage: { ...get().currentUsage, [conversationId]: acc } })
  },
  getConversationTotal: (conversationId) => {
    return get().currentUsage[conversationId] ?? null
  },
  clearCurrent: (conversationId) => {
    set((state) => {
      const { [conversationId]: _, ...rest } = state.currentUsage
      return { currentUsage: rest }
    })
  }
}))
