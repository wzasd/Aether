/**
 * MCP Module API — HTTP client for MCP server management endpoints.
 *
 * Mirrors window.api.mcp with per-module migration flag support.
 * Falls back to IPC when flag is false or unset.
 * ADR-019: Renderer HTTP Migration
 */

import { apiFetch } from './client'

function shouldUseHttp(): boolean {
  return window.__BYTRO_USE_HTTP_MCP__ ?? window.__BYTRO_USE_HTTP__ ?? false
}

export const mcpApi = {
  list: async (): Promise<McpServerConfig[]> => {
    if (shouldUseHttp()) {
      const res = await apiFetch<{ ok: boolean; servers: McpServerConfig[] }>('/api/mcp/servers')
      return res.servers ?? []
    }
    return window.api.mcp.list()
  },

  add: async (server: { name: string; command: string; args?: string[]; env?: Record<string, string> }): Promise<{ ok: boolean }> => {
    if (shouldUseHttp()) {
      const res = await apiFetch<{ ok: boolean }>('/api/mcp/servers', {
        method: 'POST',
        body: JSON.stringify(server),
      })
      return { ok: res.ok }
    }
    return window.api.mcp.add(server)
  },

  update: async (name: string, patch: { command?: string; args?: string[]; env?: Record<string, string> }): Promise<{ ok: boolean }> => {
    if (shouldUseHttp()) {
      const res = await apiFetch<{ ok: boolean }>(`/api/mcp/servers/${encodeURIComponent(name)}`, {
        method: 'PUT',
        body: JSON.stringify(patch),
      })
      return { ok: res.ok }
    }
    return window.api.mcp.update(name, patch)
  },

  remove: async (name: string): Promise<{ ok: boolean }> => {
    if (shouldUseHttp()) {
      const res = await apiFetch<{ ok: boolean }>(`/api/mcp/servers/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      })
      return { ok: res.ok }
    }
    return window.api.mcp.remove(name)
  },

  toggle: async (name: string, enabled: boolean): Promise<{ ok: boolean }> => {
    if (shouldUseHttp()) {
      const res = await apiFetch<{ ok: boolean }>(`/api/mcp/servers/${encodeURIComponent(name)}/toggle`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled }),
      })
      return { ok: res.ok }
    }
    return window.api.mcp.toggle(name, enabled)
  },

  discoverProject: async (workspaceDir: string): Promise<Array<{ name: string; command: string; args: string[]; env: Record<string, string>; source: string; sourcePath?: string }>> => {
    if (shouldUseHttp()) {
      const res = await apiFetch<{ ok: boolean; servers: Array<{ name: string; command: string; args: string[]; env: Record<string, string>; source: string; sourcePath?: string }> }>(`/api/mcp/discover?workspaceDir=${encodeURIComponent(workspaceDir)}`)
      return res.servers ?? []
    }
    return window.api.mcp.discoverProject(workspaceDir)
  },

  getProjectMcpEnabled: async (): Promise<boolean> => {
    if (shouldUseHttp()) {
      const res = await apiFetch<{ ok: boolean; enabled: boolean }>('/api/mcp/project/enabled')
      return res.enabled ?? false
    }
    return window.api.mcp.getProjectMcpEnabled()
  },

  setProjectMcpEnabled: async (enabled: boolean): Promise<{ ok: boolean }> => {
    if (shouldUseHttp()) {
      const res = await apiFetch<{ ok: boolean }>('/api/mcp/project/enabled', {
        method: 'PUT',
        body: JSON.stringify({ enabled }),
      })
      return { ok: res.ok }
    }
    return window.api.mcp.setProjectMcpEnabled(enabled)
  },

  testConnection: async (name: string): Promise<McpTestResult> => {
    if (shouldUseHttp()) {
      const res = await apiFetch<{ ok: boolean; result: McpTestResult }>(`/api/mcp/servers/${encodeURIComponent(name)}/test`, {
        method: 'POST',
      })
      return res.result
    }
    return window.api.mcp.testConnection(name)
  },

  getMarketplaceUrls: async (): Promise<string[]> => {
    if (shouldUseHttp()) {
      const res = await apiFetch<{ ok: boolean; urls: string[] }>('/api/mcp/marketplace/urls')
      return res.urls ?? []
    }
    return window.api.mcp.getMarketplaceUrls()
  },

  addMarketplaceUrl: async (url: string): Promise<{ ok: boolean }> => {
    if (shouldUseHttp()) {
      const res = await apiFetch<{ ok: boolean }>('/api/mcp/marketplace/urls', {
        method: 'POST',
        body: JSON.stringify({ url }),
      })
      return { ok: res.ok }
    }
    return window.api.mcp.addMarketplaceUrl(url)
  },

  removeMarketplaceUrl: async (url: string): Promise<{ ok: boolean }> => {
    if (shouldUseHttp()) {
      const res = await apiFetch<{ ok: boolean }>(`/api/mcp/marketplace/urls/${encodeURIComponent(url)}`, {
        method: 'DELETE',
      })
      return { ok: res.ok }
    }
    return window.api.mcp.removeMarketplaceUrl(url)
  },

  resetMarketplaceUrls: async (): Promise<{ ok: boolean }> => {
    if (shouldUseHttp()) {
      const res = await apiFetch<{ ok: boolean }>('/api/mcp/marketplace/urls/reset', {
        method: 'POST',
      })
      return { ok: res.ok }
    }
    return window.api.mcp.resetMarketplaceUrls()
  },
}