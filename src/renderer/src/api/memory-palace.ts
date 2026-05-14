/**
 * Memory Palace Module API — HTTP client for memory-palace endpoints.
 *
 * Mirrors window.api.memoryPalace with per-module migration flag support.
 * Falls back to IPC when flag is false or unset.
 *
 * Data model: flat structure — both preload and HTTP use the same
 * flat MemoryEntry format (category, title, content, tags).
 * Only field name mapping: workspaceId → workspace_id.
 *
 * ADR-019: Renderer HTTP Migration
 */

import { apiFetch } from './client'

function shouldUseHttp(): boolean {
  return window.__BYTRO_USE_HTTP_MEMORY_PALACE__ ?? window.__BYTRO_USE_HTTP__ ?? false
}

export const memoryPalaceApi = {
  list: async (workspaceId: string, category?: string): Promise<MemoryEntry[]> => {
    if (shouldUseHttp()) {
      const params = new URLSearchParams({ workspaceId })
      if (category) params.set('category', category)
      const res = await apiFetch<{ ok: boolean; data: MemoryEntry[] }>(`/api/memory-palace?${params.toString()}`)
      return res.data ?? []
    }
    return window.api.memoryPalace.list(workspaceId, category) as Promise<MemoryEntry[]>
  },

  create: async (workspaceId: string, entry: { category: string; title: string; content: string; tags?: string[]; sourceDoc?: string }): Promise<MemoryEntry> => {
    if (shouldUseHttp()) {
      const res = await apiFetch<{ ok: boolean; data: MemoryEntry }>('/api/memory-palace', {
        method: 'POST',
        body: JSON.stringify({
          workspace_id: workspaceId,
          category: entry.category,
          title: entry.title,
          content: entry.content,
          tags: entry.tags,
          sourceDoc: entry.sourceDoc,
        }),
      })
      return res.data
    }
    return window.api.memoryPalace.create(workspaceId, entry) as Promise<MemoryEntry>
  },

  update: async (id: string, patch: { title?: string; content?: string; category?: string; tags?: string[]; sourceDoc?: string }): Promise<MemoryEntry> => {
    if (shouldUseHttp()) {
      const res = await apiFetch<{ ok: boolean; data: MemoryEntry }>(`/api/memory-palace/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      })
      return res.data
    }
    return window.api.memoryPalace.update(id, patch) as Promise<MemoryEntry>
  },

  delete: async (id: string): Promise<void> => {
    if (shouldUseHttp()) {
      await apiFetch<{ ok: boolean; success: boolean }>(`/api/memory-palace/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      return
    }
    return window.api.memoryPalace.delete(id)
  },

  export: async (workspaceId: string, filePath: string): Promise<{ path: string; count: number; content?: string }> => {
    if (shouldUseHttp()) {
      const res = await apiFetch<{ ok: boolean; content: string; count: number }>(`/api/memory-palace/export?workspaceId=${encodeURIComponent(workspaceId)}`)
      return { path: filePath, count: res.count ?? 0, content: res.content }
    }
    return window.api.memoryPalace.export(workspaceId, filePath)
  },

  import: async (workspaceId: string, filePath: string): Promise<{ imported: number; skipped: number; error?: string }> => {
    if (shouldUseHttp()) {
      // HTTP import requires content in body, not a file path.
      // Store layer should read the file content first, then call importContent().
      // This path is kept for IPC fallback compatibility — HTTP mode returns an error
      // directing the caller to use importContent() instead.
      return { imported: 0, skipped: 0, error: 'Use importContent() for HTTP mode — file path not supported over HTTP' }
    }
    return window.api.memoryPalace.import(workspaceId, filePath)
  },

  /**
   * Import memory palace entries from content string (HTTP mode).
   * Store layer should read the file content first, then call this method.
   * Falls back to IPC import(filePath) when HTTP mode is not active.
   */
  importContent: async (workspaceId: string, content: string): Promise<{ imported: number; skipped: number; error?: string }> => {
    if (shouldUseHttp()) {
      const res = await apiFetch<{ ok: boolean; imported: number; skipped: number; error?: string }>('/api/memory-palace/import', {
        method: 'POST',
        body: JSON.stringify({ workspace_id: workspaceId, content }),
      })
      return { imported: res.imported ?? 0, skipped: res.skipped ?? 0, error: res.error }
    }
    // IPC mode: importContent is not applicable — use import(workspaceId, filePath) instead
    return { imported: 0, skipped: 0, error: 'importContent() is only for HTTP mode — use import(workspaceId, filePath) for IPC' }
  },
}