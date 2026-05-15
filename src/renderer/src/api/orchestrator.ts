/**
 * Orchestrator Module API — HTTP client for orchestrator endpoints.
 *
 * Mirrors window.api.orchestrator with per-module migration flag support.
 * Falls back to IPC when flag is false or unset.
 *
 * ADR-019: Renderer HTTP Migration
 */

import { apiFetch } from './client'
import { subscribe } from './events'

function shouldUseHttp(): boolean {
  return window.__BYTRO_USE_HTTP_ORCHESTRATOR__ ?? window.__BYTRO_USE_HTTP__ ?? false
}

export const orchestratorApi = {
  sendMessage: async (payload: {
    conversationId: string
    profileId: string | null
    content: string
    sessionConfig: { providerType?: string; model: string; permissionMode: string; workingDir: string; sessionId?: string }
    executionMode: 'serial' | 'parallel'
    collaborationMode?: 'orchestrated' | 'open_floor'
    overrides?: { providerType?: string; model?: string }
    initialMentions?: string
  }): Promise<void> => {
    if (shouldUseHttp()) {
      await apiFetch<{ ok: boolean }>('/api/orchestrator/messages', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      return
    }
    return window.api.orchestrator.sendMessage(payload)
  },

  abort: async (conversationId: string): Promise<void> => {
    if (shouldUseHttp()) {
      await apiFetch<{ ok: boolean }>('/api/orchestrator/abort', {
        method: 'POST',
        body: JSON.stringify({ conversationId }),
      })
      return
    }
    return window.api.orchestrator.abort(conversationId)
  },

  stopOpenFloor: async (conversationId: string): Promise<void> => {
    if (shouldUseHttp()) {
      await apiFetch<{ ok: boolean }>('/api/orchestrator/stop-open-floor', {
        method: 'POST',
        body: JSON.stringify({ conversationId }),
      })
      return
    }
    return window.api.orchestrator.stopOpenFloor(conversationId)
  },

  respondPermission: async (
    conversationId: string,
    approved: boolean,
    profileId?: string,
    taskId?: string
  ): Promise<void> => {
    if (shouldUseHttp()) {
      await apiFetch<{ ok: boolean }>('/api/orchestrator/permission', {
        method: 'POST',
        body: JSON.stringify({ conversationId, approved, profileId, taskId }),
      })
      return
    }
    return window.api.orchestrator.respondPermission(conversationId, approved, profileId, taskId)
  },

  respondQuestion: async (
    conversationId: string,
    answer: string,
    profileId?: string,
    taskId?: string
  ): Promise<void> => {
    if (shouldUseHttp()) {
      await apiFetch<{ ok: boolean }>('/api/orchestrator/question', {
        method: 'POST',
        body: JSON.stringify({ conversationId, answer, profileId, taskId }),
      })
      return
    }
    return window.api.orchestrator.respondQuestion(conversationId, answer, profileId, taskId)
  },

  getActiveTasks: async (conversationId: string): Promise<unknown[]> => {
    if (shouldUseHttp()) {
      const res = await apiFetch<{ ok: boolean; data: unknown[] }>(
        `/api/orchestrator/tasks?conversationId=${encodeURIComponent(conversationId)}`
      )
      return res.data
    }
    return window.api.orchestrator.getActiveTasks(conversationId)
  },

  getActiveGraph: async (conversationId: string): Promise<{ nodes: unknown[]; edges: unknown[] }> => {
    if (shouldUseHttp()) {
      const res = await apiFetch<{ ok: boolean; data: { nodes: unknown[]; edges: unknown[] } }>(
        `/api/orchestrator/graph?conversationId=${encodeURIComponent(conversationId)}`
      )
      return res.data
    }
    return window.api.orchestrator.getActiveGraph(conversationId)
  },

  onA2ATaskCreated: (callback: (task: unknown) => void): (() => void) => {
    if (shouldUseHttp()) {
      return subscribe('a2a:taskCreated', callback)
    }
    return window.api.orchestrator.onA2ATaskCreated(callback)
  },

  onA2ATaskCompleted: (callback: (payload: unknown) => void): (() => void) => {
    if (shouldUseHttp()) {
      return subscribe('a2a:taskCompleted', callback)
    }
    return window.api.orchestrator.onA2ATaskCompleted(callback)
  },

  onA2ATaskQueued: (
    callback: (payload: { taskId: string; conversationId: string; position: number }) => void
  ): (() => void) => {
    if (shouldUseHttp()) {
      return subscribe('a2a:taskQueued', callback)
    }
    return window.api.orchestrator.onA2ATaskQueued(callback)
  },
}
