import { ipcMain, app, BrowserWindow } from 'electron'
import { safeOpenExternal } from '../utils/external'
import { Secrets } from '../core/secrets'
import { getDb } from '../core/db'
import { providerRegistry } from '../ai/provider-registry'
import type { ProviderConfig } from '../ai/provider'

function loadProviderConfigs(): void {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM provider_configs').all() as Array<{
    id: string
    enabled: number
    binary_path: string | null
    extra_env: string
  }>
  for (const row of rows) {
    const provider = providerRegistry.get(row.id)
    if (provider) {
      provider.initialize({
        enabled: row.enabled !== 0,
        binaryPath: row.binary_path || undefined,
        extraEnv: JSON.parse(row.extra_env || '{}')
      })
    }
  }
}

export function registerSystemIpc(): void {
  loadProviderConfigs()
  ipcMain.handle('system:getVersion', () => {
    return app.getVersion()
  })

  ipcMain.handle('system:showWindow', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      win.show()
      win.focus()
    }
  })

  ipcMain.handle('system:hideWindow', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) win.hide()
  })

  ipcMain.handle('system:openExternal', async (_event, url: string) => {
    return safeOpenExternal(url)
  })

  ipcMain.handle('system:getPaths', () => {
    return {
      home: app.getPath('home'),
      userData: app.getPath('userData'),
      documents: app.getPath('documents'),
      desktop: app.getPath('desktop'),
      downloads: app.getPath('downloads')
    }
  })

  // ─── Provider handlers ───

  ipcMain.handle('provider:list', async () => {
    const providers = providerRegistry.getAll()
    let detections: Map<string, string | null> = new Map()
    try {
      detections = await providerRegistry.detectAll()
    } catch (err) {
      console.error('provider:list detectAll failed:', err)
    }
    return providers.map((p) => {
      let hasApiKey = false
      try {
        hasApiKey = Secrets.has(p.meta.id)
      } catch {
        // ignore — secrets DB may not be ready yet
      }
      return {
        meta: p.meta,
        installed: detections.get(p.meta.id) !== null,
        version: detections.get(p.meta.id) ?? null,
        hasApiKey
      }
    })
  })

  ipcMain.handle('provider:detectAll', async () => {
    const detections = await providerRegistry.detectAll()
    return Object.fromEntries(detections)
  })

  ipcMain.handle('provider:configure', async (_event, id: string, config: ProviderConfig) => {
    const provider = providerRegistry.get(id)
    if (!provider) throw new Error(`Provider ${id} not found`)
    await provider.initialize(config)

    const db = getDb()
    db.prepare(`
      INSERT INTO provider_configs (id, enabled, binary_path, extra_env, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        enabled = excluded.enabled,
        binary_path = excluded.binary_path,
        extra_env = excluded.extra_env,
        updated_at = datetime('now')
    `).run(id, config.enabled ? 1 : 0, config.binaryPath || null, JSON.stringify(config.extraEnv || {}))

    return { ok: true }
  })

  ipcMain.handle('provider:setApiKey', async (_event, providerId: string, apiKey: string) => {
    if (typeof providerId !== 'string' || !providerId.trim()) {
      throw new Error('Invalid providerId')
    }
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      throw new Error('Invalid apiKey')
    }
    Secrets.set(providerId.trim(), apiKey)
    return { ok: true }
  })

  ipcMain.handle('provider:hasApiKey', async (_event, providerId: string) => {
    return Secrets.has(assertProviderId(providerId))
  })

  ipcMain.handle('provider:testConnection', async (_event, id: string) => {
    const provider = providerRegistry.get(id)
    if (!provider) throw new Error(`Provider ${id} not found`)
    const version = await provider.detect()
    return { ok: version !== null, version }
  })

  ipcMain.handle('provider:refreshModels', async (_event, providerIds?: string[]) => {
    const results = await providerRegistry.refreshModels(providerIds)
    const output: Record<string, Array<{ id: string; name: string; contextWindow: number; maxOutputTokens?: number }>> = {}
    results.forEach((models, providerId) => {
      output[providerId] = models
    })
    return output
  })
}

function assertProviderId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Invalid providerId')
  }
  return value.trim()
}
