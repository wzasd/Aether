/**
 * Chat Module API — HTTP client for chat session endpoints.
 *
 * Mirrors window.api.chat with per-module migration flag support.
 * Falls back to IPC when flag is false or unset.
 * ADR-019: Renderer HTTP Migration
 */

import { apiFetch } from './client'
import { subscribe } from './events'
import type { SessionConfig, AIEvent, ConfigOption, AvailableModel } from './types'

function shouldUseHttp(): boolean {
  return window.__BYTRO_USE_HTTP_CHAT__ ?? window.__BYTRO_USE_HTTP__ ?? false
}

export const chatApi = {
  startSession: async (config: SessionConfig): Promise<{ id: string }> => {
    if (shouldUseHttp()) {
      const res = await apiFetch<{ ok: boolean; session: { id: string } }>('/api/chat/sessions', {
        method: 'POST',
        body: JSON.stringify(config),
      })
      return res.session
    }
    return window.api.chat.startSession(config)
  },

  sendMessage: async (sessionId: string, content: string): Promise<void> => {
    if (shouldUseHttp()) {
      await apiFetch<{ ok: boolean }>(`/api/chat/sessions/${encodeURIComponent(sessionId)}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      })
      return
    }
    return window.api.chat.sendMessage(sessionId, content)
  },

  respondPermission: async (sessionId: string, approved: boolean): Promise<void> => {
    if (shouldUseHttp()) {
      await apiFetch<{ ok: boolean }>(`/api/chat/sessions/${encodeURIComponent(sessionId)}/permission`, {
        method: 'POST',
        body: JSON.stringify({ approved }),
      })
      return
    }
    return window.api.chat.respondPermission(sessionId, approved)
  },

  respondQuestion: async (sessionId: string, answer: string): Promise<void> => {
    if (shouldUseHttp()) {
      await apiFetch<{ ok: boolean }>(`/api/chat/sessions/${encodeURIComponent(sessionId)}/question`, {
        method: 'POST',
        body: JSON.stringify({ answer }),
      })
      return
    }
    return window.api.chat.respondQuestion(sessionId, answer)
  },

  abort: async (sessionId: string): Promise<void> => {
    if (shouldUseHttp()) {
      await apiFetch<{ ok: boolean }>(`/api/chat/sessions/${encodeURIComponent(sessionId)}/abort`, {
        method: 'POST',
      })
      return
    }
    return window.api.chat.abort(sessionId)
  },

  endSession: async (sessionId: string): Promise<void> => {
    if (shouldUseHttp()) {
      await apiFetch<{ ok: boolean }>(`/api/chat/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
      })
      return
    }
    return window.api.chat.endSession(sessionId)
  },

  onEvent: (callback: (event: AIEvent) => void): (() => void) => {
    if (shouldUseHttp()) {
      return subscribe('ai:event', (data) => callback(data as AIEvent))
    }
    return window.api.chat.onEvent(callback)
  },

  getAvailableModels: async (sessionId: string): Promise<AvailableModel[]> => {
    if (shouldUseHttp()) {
      const res = await apiFetch<{ ok: boolean; data: AvailableModel[] }>(
        `/api/chat/sessions/${encodeURIComponent(sessionId)}/models`
      )
      return res.data ?? []
    }
    return window.api.chat.getAvailableModels(sessionId)
  },

  setModel: async (sessionId: string, modelId: string): Promise<void> => {
    if (shouldUseHttp()) {
      await apiFetch<{ ok: boolean }>(`/api/chat/sessions/${encodeURIComponent(sessionId)}/model`, {
        method: 'PUT',
        body: JSON.stringify({ modelId }),
      })
      return
    }
    return window.api.chat.setModel(sessionId, modelId)
  },

  getConfigOptions: async (sessionId: string): Promise<ConfigOption[]> => {
    if (shouldUseHttp()) {
      const res = await apiFetch<{ ok: boolean; data: ConfigOption[] }>(
        `/api/chat/sessions/${encodeURIComponent(sessionId)}/config`
      )
      return res.data ?? []
    }
    return window.api.chat.getConfigOptions(sessionId)
  },

  setConfigOption: async (sessionId: string, optionId: string, value: string): Promise<void> => {
    if (shouldUseHttp()) {
      await apiFetch<{ ok: boolean }>(`/api/chat/sessions/${encodeURIComponent(sessionId)}/config`, {
        method: 'PUT',
        body: JSON.stringify({ optionId, value }),
      })
      return
    }
    return window.api.chat.setConfigOption(sessionId, optionId, value)
  },
}