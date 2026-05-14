/**
 * System Module API — HTTP client for system endpoints.
 *
 * Mirrors window.api.system with per-module migration flag support.
 * Falls back to IPC when flag is false or unset.
 * ADR-019: Renderer HTTP Migration
 */

import { apiFetch } from './client'
import { subscribe } from './events'

function shouldUseHttp(): boolean {
  return window.__BYTRO_USE_HTTP_SYSTEM__ ?? window.__BYTRO_USE_HTTP__ ?? false
}

export const systemApi = {
  getVersion: async (): Promise<string> => {
    if (shouldUseHttp()) {
      const res = await apiFetch<{ version: string }>('/api/system/version')
      return res.version
    }
    return window.api.system.getVersion()
  },

  showWindow: async (): Promise<void> => {
    // Electron-only: HTTP endpoint always returns 501,
    // so always use IPC for window management during migration
    return window.api.system.showWindow()
  },

  hideWindow: async (): Promise<void> => {
    // Electron-only: HTTP endpoint always returns 501
    return window.api.system.hideWindow()
  },

  openExternal: async (url: string): Promise<boolean> => {
    if (shouldUseHttp()) {
      const res = await apiFetch<{ ok: boolean }>('/api/system/open-external', {
        method: 'POST',
        body: JSON.stringify({ url }),
      })
      return res.ok
    }
    return window.api.system.openExternal(url)
  },

  getPaths: async (): Promise<Record<string, string>> => {
    if (shouldUseHttp()) {
      const res = await apiFetch<{ paths: Record<string, string> }>('/api/system/paths')
      return res.paths
    }
    return window.api.system.getPaths()
  },

  checkUpdate: async (): Promise<UpdateInfo> => {
    if (shouldUseHttp()) {
      const res = await apiFetch<{
        hasUpdate: boolean
        currentVersion: string
        latestVersion: string | null
        releaseUrl: string | null
        releaseNotes: string | null
        publishedAt: string | null
      }>('/api/system/update')
      return res
    }
    return window.api.system.checkUpdate()
  },

  onUpdateAvailable: (callback: (info: UpdateInfo) => void): (() => void) => {
    if (shouldUseHttp()) {
      return subscribe('update:available', (data) => {
        callback(data as UpdateInfo)
      })
    }
    return window.api.system.onUpdateAvailable(callback)
  },
}
