/**
 * Conversations Module API — HTTP client for conversation endpoints.
 *
 * Mirrors window.api.conversation with per-module migration flag support.
 * Falls back to IPC when flag is false or unset.
 * ADR-019: Renderer HTTP Migration
 */

import { apiFetch } from './client'

function shouldUseHttp(): boolean {
  return window.__BYTRO_USE_HTTP_CONVERSATIONS__ ?? window.__BYTRO_USE_HTTP__ ?? false
}

export const conversationApi = {
  list: async (workspaceId?: string, status?: string): Promise<ConversationItem[]> => {
    if (shouldUseHttp()) {
      const params = new URLSearchParams()
      if (workspaceId) params.set('workspaceId', workspaceId)
      if (status) params.set('status', status)
      const query = params.toString()
      const res = await apiFetch<{ conversations: ConversationItem[] }>(`/api/conversations${query ? '?' + query : ''}`)
      return res.conversations
    }
    return window.api.conversation.list(workspaceId, status)
  },

  get: async (id: string): Promise<ConversationItem | null> => {
    if (shouldUseHttp()) {
      const res = await apiFetch<{ conversation: ConversationItem; messages: MessageItem[] }>(`/api/conversations/${id}`)
      return { ...res.conversation, messages: res.messages }
    }
    return window.api.conversation.get(id)
  },

  create: async (data: {
    workspace_id?: string
    title?: string
    model?: string
    provider?: string
    agent_profile_id?: string
    team_id?: string
    task_id?: string
    is_draft?: number
  }): Promise<ConversationItem> => {
    if (shouldUseHttp()) {
      const res = await apiFetch<{ conversation: ConversationItem }>('/api/conversations', {
        method: 'POST',
        body: JSON.stringify(data),
      })
      return res.conversation
    }
    return window.api.conversation.create(data)
  },

  update: async (id: string, data: Record<string, unknown>): Promise<ConversationItem> => {
    if (shouldUseHttp()) {
      await apiFetch<{ id: string }>(`/api/conversations/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      })
      // HTTP endpoint returns { ok, id }; refetch to match IPC return type
      const refetch = await apiFetch<{ conversation: ConversationItem; messages: MessageItem[] }>(`/api/conversations/${id}`)
      return { ...refetch.conversation, messages: refetch.messages }
    }
    return window.api.conversation.update(id, data)
  },

  promoteDraft: async (id: string): Promise<ConversationItem> => {
    if (shouldUseHttp()) {
      const res = await apiFetch<{ conversation: ConversationItem }>(`/api/conversations/${id}/promote-draft`, {
        method: 'POST',
      })
      return res.conversation
    }
    return window.api.conversation.promoteDraft(id)
  },

  delete: async (id: string): Promise<{ success: boolean }> => {
    if (shouldUseHttp()) {
      await apiFetch<{ id: string }>(`/api/conversations/${id}`, {
        method: 'DELETE',
      })
      return { success: true }
    }
    return window.api.conversation.delete(id)
  },

  updateStatus: async (id: string, status: string): Promise<ConversationItem> => {
    if (shouldUseHttp()) {
      const res = await apiFetch<{ conversation: ConversationItem }>(`/api/conversations/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      })
      return res.conversation
    }
    return window.api.conversation.updateStatus(id, status)
  },

  search: async (query: string): Promise<ConversationSearchResult[]> => {
    if (shouldUseHttp()) {
      const res = await apiFetch<{ results: ConversationSearchResult[] }>(`/api/conversations/search?q=${encodeURIComponent(query)}`)
      return res.results
    }
    return window.api.conversation.search(query)
  },

  autoTitle: async (id: string, title: string): Promise<{ success: boolean }> => {
    if (shouldUseHttp()) {
      await apiFetch(`/api/conversations/${id}/auto-title`, {
        method: 'POST',
        body: JSON.stringify({ title }),
      })
      return { success: true }
    }
    return window.api.conversation.autoTitle(id, title)
  },

  setTitle: async (id: string, title: string): Promise<{ success: boolean }> => {
    if (shouldUseHttp()) {
      await apiFetch(`/api/conversations/${id}/set-title`, {
        method: 'POST',
        body: JSON.stringify({ title }),
      })
      return { success: true }
    }
    return window.api.conversation.setTitle(id, title)
  },

  incrementAgentCount: async (id: string): Promise<{ agent_count: number } | undefined> => {
    if (shouldUseHttp()) {
      const res = await apiFetch<{ agentCount: number }>(`/api/conversations/${id}/increment-agent-count`, {
        method: 'POST',
      })
      return { agent_count: res.agentCount }
    }
    return window.api.conversation.incrementAgentCount(id)
  },

  export: async (
    id: string,
    format: 'markdown' | 'json',
    options?: {
      includeThinking?: boolean
      includeToolCalls?: boolean
      includeSystemMessages?: boolean
      includeUsage?: boolean
    }
  ): Promise<{ success: boolean; path?: string; content?: string; filename?: string; reason?: string }> => {
    if (shouldUseHttp()) {
      const res = await apiFetch<{ content: string; filename: string }>('/api/conversations/export', {
        method: 'POST',
        body: JSON.stringify({ conversationId: id, format, options }),
      })
      return { success: true, content: res.content, filename: res.filename }
    }
    return window.api.conversation.export(id, format, options)
  },
}
