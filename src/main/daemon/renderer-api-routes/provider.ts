/**
 * Provider route handlers for Renderer API.
 *
 * Extracted from system.ts to separate provider management from system utilities.
 */

import type { ServerResponse } from 'http'
import { Secrets } from '../../core/secrets'
import { getDb } from '../../core/db'
import { providerRegistry } from '../../ai/provider-registry'
import type { ProviderConfig } from '../../ai/provider'

// ─── Provider ──────────────────────────────────────────────────────────────

export async function handleListProviders(res: ServerResponse): Promise<void> {
  const providers = providerRegistry.getAll()
  let detections: Map<string, string | null> = new Map()
  try {
    detections = await providerRegistry.detectAll()
  } catch (err) {
    console.error('provider:list detectAll failed:', err)
  }
  const result = providers.map((p) => {
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
      hasApiKey,
    }
  })
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, providers: result }))
}

export async function handleDetectAllProviders(res: ServerResponse): Promise<void> {
  const detections = await providerRegistry.detectAll()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, detections: Object.fromEntries(detections) }))
}

export async function handleConfigureProvider(body: unknown, res: ServerResponse): Promise<void> {
  const data = body as Record<string, unknown> | null
  const id = data?.id as string | undefined
  const config = data?.config as ProviderConfig | undefined
  if (!id || typeof id !== 'string') {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'id is required' }))
    return
  }

  const provider = providerRegistry.get(id)
  if (!provider) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: `Provider ${id} not found` }))
    return
  }

  await provider.initialize(config ?? { enabled: true })

  const db = getDb()
  db.prepare(`
    INSERT INTO provider_configs (id, enabled, binary_path, extra_env, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      enabled = excluded.enabled,
      binary_path = excluded.binary_path,
      extra_env = excluded.extra_env,
      updated_at = datetime('now')
  `).run(id, config?.enabled ? 1 : 0, config?.binaryPath || null, JSON.stringify(config?.extraEnv || {}))

  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true }))
}

export async function handleSetProviderApiKey(body: unknown, res: ServerResponse): Promise<void> {
  const data = body as Record<string, unknown> | null
  const providerId = data?.provider_id as string | undefined
  const apiKey = data?.api_key as string | undefined

  if (!providerId || typeof providerId !== 'string' || !providerId.trim()) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'Invalid provider_id' }))
    return
  }
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'Invalid api_key' }))
    return
  }

  Secrets.set(providerId.trim(), apiKey)
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true }))
}

export async function handleHasProviderApiKey(body: unknown, res: ServerResponse): Promise<void> {
  const data = body as Record<string, unknown> | null
  const providerId = data?.provider_id as string | undefined
  if (!providerId || typeof providerId !== 'string' || !providerId.trim()) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'Invalid provider_id' }))
    return
  }

  const has = Secrets.has(providerId.trim())
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, has }))
}

export async function handleTestProviderConnection(body: unknown, res: ServerResponse): Promise<void> {
  const data = body as Record<string, unknown> | null
  const id = data?.id as string | undefined
  if (!id || typeof id !== 'string') {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'id is required' }))
    return
  }

  const provider = providerRegistry.get(id)
  if (!provider) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: `Provider ${id} not found` }))
    return
  }

  const version = await provider.detect()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: version !== null, version }))
}

export async function handleRefreshProviderModels(body: unknown, res: ServerResponse): Promise<void> {
  const data = body as Record<string, unknown> | null
  const providerIds = data?.provider_ids as string[] | undefined
  const results = await providerRegistry.refreshModels(providerIds)
  const output: Record<string, Array<{ id: string; name: string; contextWindow: number; maxOutputTokens?: number }>> = {}
  results.forEach((models, providerId) => {
    output[providerId] = models
  })
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, models: output }))
}
