import { create } from 'zustand'

export interface FileChange {
  id: string
  conversation_id: string
  agent_id: string | null
  path: string
  status: 'modified' | 'added' | 'deleted'
  additions: number
  deletions: number
  diff_text: string | null
  tool_call_id: string | null
  created_at: number
  updated_at: number
}

interface ChangeState {
  changes: Record<string, FileChange[]>

  recordChange: (data: {
    conversation_id: string
    agent_id?: string
    path: string
    status: string
    additions?: number
    deletions?: number
    diff_text?: string
    tool_call_id?: string
  }) => Promise<void>
  loadChangesForConversation: (conversationId: string) => Promise<void>
  getAggregatedChanges: (conversationId: string) => FileChange[]
}

export const useChangeStore = create<ChangeState>((set, get) => ({
  changes: {},

  recordChange: async (data) => {
    try {
      const record = await window.api.change.record(data)

      // Deduplicate by path: update existing entry for same file
      set((state) => {
        const existing = state.changes[data.conversation_id] ?? []
        const filtered = existing.filter((c) => c.path !== data.path)
        return {
          changes: {
            ...state.changes,
            [data.conversation_id]: [record as FileChange, ...filtered]
          }
        }
      })
    } catch {
      // best-effort: also update local state optimistically
      const optimistic: FileChange = {
        id: `optimistic-${Date.now()}`,
        conversation_id: data.conversation_id,
        agent_id: data.agent_id ?? null,
        path: data.path,
        status: data.status as FileChange['status'],
        additions: data.additions ?? 0,
        deletions: data.deletions ?? 0,
        diff_text: data.diff_text ?? null,
        tool_call_id: data.tool_call_id ?? null,
        created_at: Math.floor(Date.now() / 1000),
        updated_at: Math.floor(Date.now() / 1000)
      }

      set((state) => {
        const existing = state.changes[data.conversation_id] ?? []
        const filtered = existing.filter((c) => c.path !== data.path)
        return {
          changes: {
            ...state.changes,
            [data.conversation_id]: [optimistic, ...filtered]
          }
        }
      })
    }
  },

  loadChangesForConversation: async (conversationId) => {
    try {
      const records = await window.api.change.listForConversation(conversationId)
      set((state) => ({
        changes: {
          ...state.changes,
          [conversationId]: records as FileChange[]
        }
      }))
    } catch {
      // keep existing state
    }
  },

  getAggregatedChanges: (conversationId) => {
    const all = get().changes[conversationId] ?? []
    const seen = new Map<string, FileChange>()
    // Latest entry per path wins (first in array = most recent)
    for (const change of all) {
      if (!seen.has(change.path)) {
        seen.set(change.path, change)
      }
    }
    return Array.from(seen.values())
  }
}))
