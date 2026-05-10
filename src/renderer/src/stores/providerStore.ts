import { create } from 'zustand'

export interface ProviderInfo {
  meta: {
    id: string
    name: string
    binary: string
    vendor: string
    models: Array<{
      id: string
      name: string
      contextWindow: number
      maxOutputTokens?: number
    }>
    permissionFlags: Record<string, string[]>
    supportsStreamJson: boolean
    supportsInteractive: boolean
  }
  installed: boolean
  version: string | null
  hasApiKey: boolean
}

interface ProviderStore {
  providers: ProviderInfo[]
  isLoading: boolean

  loadProviders: () => Promise<void>
  setApiKey: (providerId: string, key: string) => Promise<void>
  testConnection: (providerId: string) => Promise<{ ok: boolean; version: string | null }>
  refreshModels: (providerId: string) => Promise<{ updated: boolean; count: number }>
}

export const useProviderStore = create<ProviderStore>((set, get) => ({
  providers: [],
  isLoading: false,

  loadProviders: async () => {
    if (get().isLoading) return
    set({ isLoading: true })
    try {
      const providers = await window.api.provider.list()
      set({ providers })
    } finally {
      set({ isLoading: false })
    }
  },

  setApiKey: async (providerId, key) => {
    await window.api.provider.setApiKey(providerId, key)
    const providers = get().providers.map((p) =>
      p.meta.id === providerId ? { ...p, hasApiKey: true } : p
    )
    set({ providers })
  },

  testConnection: async (providerId) => {
    return window.api.provider.testConnection(providerId)
  },

  refreshModels: async (providerId) => {
    const before = get().providers.find((p) => p.meta.id === providerId)
    const beforeCount = before?.meta.models.length ?? 0
    try {
      const result = await window.api.provider.refreshModels([providerId])
      const refreshed = result[providerId]
      if (!refreshed) return
      const afterCount = refreshed.length
      set((state) => ({
        providers: state.providers.map((p) =>
          p.meta.id === providerId
            ? { ...p, meta: { ...p.meta, models: refreshed } }
            : p
        ),
      }))
      // Return info about whether models actually changed
      return { updated: afterCount !== beforeCount, count: afterCount }
    } catch {
      // Ignore refresh errors — static models remain
      return { updated: false, count: beforeCount }
    }
  },
}))
