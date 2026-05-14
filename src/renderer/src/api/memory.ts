/**
 * Memory Module API — HTTP client for memory endpoints.
 *
 * Mirrors window.api.memory with per-module migration flag support.
 * Falls back to IPC when flag is false or unset.
 * ADR-019: Renderer HTTP Migration
 */

import { apiFetch } from './client'

function shouldUseHttp(): boolean {
  return window.__BYTRO_USE_HTTP_MEMORY__ ?? window.__BYTRO_USE_HTTP__ ?? false
}

export const memoryApi = {
  recall: async (query: string, options: { scope?: string; workspaceId?: string; conversationId?: string; limit?: number }): Promise<ProjectMemoryItem[]> => {
    if (shouldUseHttp()) {
      const res = await apiFetch<{ ok: boolean; data: ProjectMemoryItem[] }>('/api/memory/recall', {
        method: 'POST',
        body: JSON.stringify({ query, ...options }),
      })
      return res.data ?? []
    }
    return window.api.memory.recall(query, options)
  },

  readProjectMemory: async (workspaceId: string): Promise<string | null> => {
    if (shouldUseHttp()) {
      const res = await apiFetch<{ ok: boolean; data: string | null }>(`/api/memory/project?workspaceId=${encodeURIComponent(workspaceId)}`)
      return res.data ?? null
    }
    return window.api.memory.readProjectMemory(workspaceId)
  },

  writeProjectMemory: async (workspaceId: string, content: string): Promise<void> => {
    if (shouldUseHttp()) {
      await apiFetch<{ ok: boolean }>('/api/memory/project', {
        method: 'PUT',
        body: JSON.stringify({ workspaceId, content }),
      })
      return
    }
    return window.api.memory.writeProjectMemory(workspaceId, content)
  },

  appendProjectMemory: async (workspaceId: string, section: string, entry: string): Promise<void> => {
    if (shouldUseHttp()) {
      await apiFetch<{ ok: boolean }>('/api/memory/project/append', {
        method: 'POST',
        body: JSON.stringify({ workspaceId, section, entry }),
      })
      return
    }
    return window.api.memory.appendProjectMemory(workspaceId, section, entry)
  },

  readAgentMemory: async (workspaceId: string, agentId: string): Promise<string | null> => {
    if (shouldUseHttp()) {
      const res = await apiFetch<{ ok: boolean; data: string | null }>(`/api/memory/agent/${encodeURIComponent(agentId)}?workspaceId=${encodeURIComponent(workspaceId)}`)
      return res.data ?? null
    }
    return window.api.memory.readAgentMemory(workspaceId, agentId)
  },

  writeAgentMemory: async (workspaceId: string, agentId: string, content: string): Promise<void> => {
    if (shouldUseHttp()) {
      await apiFetch<{ ok: boolean }>(`/api/memory/agent/${encodeURIComponent(agentId)}`, {
        method: 'PUT',
        body: JSON.stringify({ workspaceId, content }),
      })
      return
    }
    return window.api.memory.writeAgentMemory(workspaceId, agentId, content)
  },

  createCandidate: async (data: { workspace_id: string; kind: string; title: string; content: string; source_conversation_id?: string; source_message_id?: string; confidence: string }): Promise<{ id: string }> => {
    if (shouldUseHttp()) {
      const res = await apiFetch<{ ok: boolean; id: string }>('/api/memory/candidates', {
        method: 'POST',
        body: JSON.stringify(data),
      })
      return { id: res.id }
    }
    return window.api.memory.createCandidate(data)
  },

  updateCandidateStatus: async (id: string, status: string): Promise<{ success: boolean }> => {
    if (shouldUseHttp()) {
      await apiFetch<{ ok: boolean; success: boolean }>(`/api/memory/candidates/${encodeURIComponent(id)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      })
      return { success: true }
    }
    return window.api.memory.updateCandidateStatus(id, status)
  },

  listCandidates: async (workspaceId: string, status?: string): Promise<MemoryCandidate[]> => {
    if (shouldUseHttp()) {
      const params = new URLSearchParams({ workspaceId })
      if (status) params.set('status', status)
      const res = await apiFetch<{ ok: boolean; data: MemoryCandidate[] }>(`/api/memory/candidates?${params.toString()}`)
      return res.data ?? []
    }
    return window.api.memory.listCandidates(workspaceId, status)
  },

  listProjectItems: async (workspaceId: string): Promise<ProjectMemoryItem[]> => {
    if (shouldUseHttp()) {
      const res = await apiFetch<{ ok: boolean; data: ProjectMemoryItem[] }>(`/api/memory/project/items?workspaceId=${encodeURIComponent(workspaceId)}`)
      return res.data ?? []
    }
    return window.api.memory.listProjectItems(workspaceId)
  },

  deleteProjectItem: async (id: string): Promise<{ success: boolean }> => {
    if (shouldUseHttp()) {
      await apiFetch<{ ok: boolean; success: boolean }>(`/api/memory/project/items/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      return { success: true }
    }
    return window.api.memory.deleteProjectItem(id)
  },

  listMarkers: async (workspaceId: string): Promise<string[]> => {
    if (shouldUseHttp()) {
      const res = await apiFetch<{ ok: boolean; data: string[] }>(`/api/memory/markers?workspaceId=${encodeURIComponent(workspaceId)}`)
      return res.data ?? []
    }
    return window.api.memory.listMarkers(workspaceId)
  },

  readMarker: async (workspaceId: string, name: string): Promise<string | null> => {
    if (shouldUseHttp()) {
      const res = await apiFetch<{ ok: boolean; data: string | null }>(`/api/memory/markers/${encodeURIComponent(name)}?workspaceId=${encodeURIComponent(workspaceId)}`)
      return res.data ?? null
    }
    return window.api.memory.readMarker(workspaceId, name)
  },

  writeMarker: async (workspaceId: string, name: string, content: string): Promise<void> => {
    if (shouldUseHttp()) {
      await apiFetch<{ ok: boolean }>(`/api/memory/markers/${encodeURIComponent(name)}`, {
        method: 'PUT',
        body: JSON.stringify({ workspaceId, content }),
      })
      return
    }
    return window.api.memory.writeMarker(workspaceId, name, content)
  },

  materializeCandidate: async (id: string): Promise<{ id: string }> => {
    if (shouldUseHttp()) {
      const res = await apiFetch<{ ok: boolean; id: string }>(`/api/memory/candidates/${encodeURIComponent(id)}/materialize`, {
        method: 'POST',
      })
      return { id: res.id }
    }
    return window.api.memory.materializeCandidate(id)
  },

  createAgentSession: async (data: { workspace_id: string; conversation_id: string; agent_id: string; provider: string; external_session_id?: string; seq?: number; status: string }): Promise<AgentSession> => {
    if (shouldUseHttp()) {
      const res = await apiFetch<{ ok: boolean; data: AgentSession }>('/api/memory/agent-sessions', {
        method: 'POST',
        body: JSON.stringify(data),
      })
      return res.data
    }
    return window.api.memory.createAgentSession(data)
  },

  endAgentSession: async (id: string): Promise<{ success: boolean }> => {
    if (shouldUseHttp()) {
      await apiFetch<{ ok: boolean; success: boolean }>(`/api/memory/agent-sessions/${encodeURIComponent(id)}/end`, {
        method: 'POST',
      })
      return { success: true }
    }
    return window.api.memory.endAgentSession(id)
  },

  endAgentSessionByExternalId: async (externalSessionId: string): Promise<{ success: boolean }> => {
    if (shouldUseHttp()) {
      await apiFetch<{ ok: boolean; success: boolean }>(`/api/memory/agent-sessions/external/${encodeURIComponent(externalSessionId)}/end`, {
        method: 'POST',
      })
      return { success: true }
    }
    return window.api.memory.endAgentSessionByExternalId(externalSessionId)
  },

  listAgentSessions: async (conversationId: string): Promise<AgentSession[]> => {
    if (shouldUseHttp()) {
      const res = await apiFetch<{ ok: boolean; data: AgentSession[] }>(`/api/memory/agent-sessions?conversationId=${encodeURIComponent(conversationId)}`)
      return res.data ?? []
    }
    return window.api.memory.listAgentSessions(conversationId)
  },

  getLatestSummary: async (conversationId: string): Promise<ConversationSummary | null> => {
    if (shouldUseHttp()) {
      const res = await apiFetch<{ ok: boolean; data: ConversationSummary | null }>(`/api/memory/summaries/latest?conversationId=${encodeURIComponent(conversationId)}`)
      return res.data ?? null
    }
    return window.api.memory.getLatestSummary(conversationId)
  },

  createSummary: async (data: { conversation_id: string; summary: string; completed_items?: string; pending_items?: string; changed_files?: string; risks?: string; next_steps?: string; from_message_id?: string; to_message_id?: string }): Promise<{ id: string }> => {
    if (shouldUseHttp()) {
      const res = await apiFetch<{ ok: boolean; id: string }>('/api/memory/summaries', {
        method: 'POST',
        body: JSON.stringify(data),
      })
      return { id: res.id }
    }
    return window.api.memory.createSummary(data)
  },

  upsertAgentProfile: async (data: { workspace_id?: string; agent_id: string; content: string; source_path?: string; source_hash?: string }): Promise<{ success: boolean }> => {
    if (shouldUseHttp()) {
      await apiFetch<{ ok: boolean; success: boolean }>(`/api/memory/agent-profiles/${encodeURIComponent(data.agent_id)}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      })
      return { success: true }
    }
    return window.api.memory.upsertAgentProfile(data)
  },

  getAgentProfile: async (workspaceId: string | null, agentId: string): Promise<AgentProfileCache | null> => {
    if (shouldUseHttp()) {
      const params = new URLSearchParams()
      if (workspaceId) params.set('workspaceId', workspaceId)
      const res = await apiFetch<{ ok: boolean; data: AgentProfileCache | null }>(`/api/memory/agent-profiles/${encodeURIComponent(agentId)}?${params.toString()}`)
      return res.data ?? null
    }
    return window.api.memory.getAgentProfile(workspaceId, agentId)
  },
}