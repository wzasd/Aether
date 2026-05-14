/**
 * Renderer API Routes — MCP server management endpoints
 *
 * Migrates 13 IPC handlers from ipc/mcp.ts to HTTP endpoints.
 * ADR-016: Renderer API Server
 */

import type { ServerResponse } from 'http'
import { getDb } from '../../core/db.js'
import { writeMcpConfigFile, discoverProjectMcpConfig, isProjectMcpEnabled, setProjectMcpEnabled } from '../../mcp/config-file.js'
import { testMcpConnection } from '../../mcp/connector.js'
import type { McpServerRow } from '../../mcp/types.js'
import { safeParseJson } from '../../mcp/types.js'
import { writeObservabilityEvent } from '../../core/logging'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function jsonResponse(res: ServerResponse, statusCode: number, data: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

function assertString(val: unknown, label: string): asserts val is string {
  if (typeof val !== 'string' || val.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }
}

function assertArgs(val: unknown): asserts val is string[] {
  if (val === undefined || val === null) return
  if (!Array.isArray(val)) throw new Error('args must be an array')
  for (const a of val) {
    if (typeof a !== 'string') throw new Error('args elements must be strings')
  }
}

function assertEnv(val: unknown): asserts val is Record<string, string> {
  if (val === undefined || val === null) return
  if (typeof val !== 'object' || Array.isArray(val)) throw new Error('env must be an object')
  for (const [, v] of Object.entries(val as Record<string, unknown>)) {
    if (typeof v !== 'string') throw new Error('env values must be strings')
  }
}

// ─── Marketplace URL Helpers ──────────────────────────────────────────────────

const MKT_URLS_KEY = 'mcp.marketplaceUrls'
const DEFAULT_MKT_URLS = [
  'https://registry.npmjs.org/-/v1/search?text=keywords:mcp%20modelcontextprotocol&size=50'
]

function getMarketplaceUrls(): string[] {
  const db = getDb()
  const row = db.prepare('SELECT value FROM user_preferences WHERE key = ?').get(MKT_URLS_KEY) as { value: string } | undefined
  if (!row) return DEFAULT_MKT_URLS
  try {
    const parsed = JSON.parse(row.value)
    if (Array.isArray(parsed) && parsed.every((u): u is string => typeof u === 'string')) return parsed
  } catch { /* fall through */ }
  return DEFAULT_MKT_URLS
}

// ─── Route Handlers ──────────────────────────────────────────────────────────

/** GET /api/mcp/servers — List MCP servers */
export async function handleListMcpServers(res: ServerResponse): Promise<void> {
  const db = getDb()
  const rows = db.prepare('SELECT name, command, args, env, enabled FROM mcp_servers ORDER BY name').all() as McpServerRow[]

  const servers = rows.map((r) => ({
    name: r.name,
    command: r.command,
    args: safeParseJson<string[]>(r.args || '[]', []),
    env: safeParseJson<Record<string, string>>(r.env || '{}', {}),
    enabled: r.enabled === 1
  }))

  return jsonResponse(res, 200, { ok: true, servers })
}

/** POST /api/mcp/servers — Add MCP server */
export async function handleAddMcpServer(body: unknown, res: ServerResponse): Promise<void> {
  const data = body as { name?: string; command?: string; args?: string[]; env?: Record<string, string> } | null
  if (!data?.name || !data?.command) {
    return jsonResponse(res, 400, { ok: false, error: 'name and command are required' })
  }

  assertString(data.name, 'name')
  assertString(data.command, 'command')
  assertArgs(data.args)
  assertEnv(data.env)

  const db = getDb()
  const existing = db.prepare('SELECT name FROM mcp_servers WHERE name = ?').get(data.name)
  if (existing) {
    return jsonResponse(res, 409, { ok: false, error: `MCP server "${data.name}" already exists` })
  }

  db.prepare('INSERT INTO mcp_servers (name, command, args, env, enabled) VALUES (?, ?, ?, ?, 1)').run(
    data.name,
    data.command,
    JSON.stringify(data.args || []),
    JSON.stringify(data.env || {})
  )

  writeMcpConfigFile()
  writeObservabilityEvent('renderer_api:mcp_server_added', { name: data.name })
  return jsonResponse(res, 201, { ok: true })
}

/** PUT /api/mcp/servers/:name — Update MCP server */
export async function handleUpdateMcpServer(name: string, body: unknown, res: ServerResponse): Promise<void> {
  assertString(name, 'name')
  const data = body as { command?: string; args?: string[]; env?: Record<string, string> } | null
  if (!data) {
    return jsonResponse(res, 400, { ok: false, error: 'Request body is required' })
  }

  assertArgs(data.args)
  assertEnv(data.env)

  const db = getDb()
  const existing = db.prepare('SELECT name FROM mcp_servers WHERE name = ?').get(name)
  if (!existing) {
    return jsonResponse(res, 404, { ok: false, error: `MCP server "${name}" not found` })
  }

  if (data.command !== undefined) {
    assertString(data.command, 'command')
    db.prepare('UPDATE mcp_servers SET command = ? WHERE name = ?').run(data.command, name)
  }
  if (data.args !== undefined) {
    db.prepare('UPDATE mcp_servers SET args = ? WHERE name = ?').run(JSON.stringify(data.args), name)
  }
  if (data.env !== undefined) {
    db.prepare('UPDATE mcp_servers SET env = ? WHERE name = ?').run(JSON.stringify(data.env), name)
  }

  writeMcpConfigFile()
  return jsonResponse(res, 200, { ok: true })
}

/** DELETE /api/mcp/servers/:name — Remove MCP server */
export async function handleRemoveMcpServer(name: string, res: ServerResponse): Promise<void> {
  assertString(name, 'name')

  const db = getDb()
  const result = db.prepare('DELETE FROM mcp_servers WHERE name = ?').run(name)
  if (result.changes === 0) {
    return jsonResponse(res, 404, { ok: false, error: `MCP server "${name}" not found` })
  }

  writeMcpConfigFile()
  writeObservabilityEvent('renderer_api:mcp_server_removed', { name })
  return jsonResponse(res, 200, { ok: true })
}

/** PATCH /api/mcp/servers/:name/toggle — Toggle MCP server enabled/disabled */
export async function handleToggleMcpServer(name: string, body: unknown, res: ServerResponse): Promise<void> {
  assertString(name, 'name')
  const data = body as { enabled?: boolean } | null
  if (data?.enabled === undefined) {
    return jsonResponse(res, 400, { ok: false, error: 'enabled is required' })
  }

  const db = getDb()
  const result = db.prepare('UPDATE mcp_servers SET enabled = ? WHERE name = ?').run(data.enabled ? 1 : 0, name)
  if (result.changes === 0) {
    return jsonResponse(res, 404, { ok: false, error: `MCP server "${name}" not found` })
  }

  writeMcpConfigFile()
  return jsonResponse(res, 200, { ok: true })
}

/** GET /api/mcp/discover — Discover project MCP config */
export async function handleDiscoverProjectMcp(url: URL, res: ServerResponse): Promise<void> {
  const workspaceDir = url.searchParams.get('workspaceDir')
  if (!workspaceDir) {
    return jsonResponse(res, 400, { ok: false, error: 'workspaceDir is required' })
  }

  const servers = discoverProjectMcpConfig(workspaceDir)
  return jsonResponse(res, 200, { ok: true, servers: servers || [] })
}

/** GET /api/mcp/project/enabled — Get project MCP enabled status */
export async function handleGetProjectMcpEnabled(res: ServerResponse): Promise<void> {
  const enabled = isProjectMcpEnabled()
  return jsonResponse(res, 200, { ok: true, enabled })
}

/** PUT /api/mcp/project/enabled — Set project MCP enabled status */
export async function handleSetProjectMcpEnabled(body: unknown, res: ServerResponse): Promise<void> {
  const data = body as { enabled?: boolean } | null
  if (data?.enabled === undefined) {
    return jsonResponse(res, 400, { ok: false, error: 'enabled is required' })
  }

  setProjectMcpEnabled(data.enabled)
  writeMcpConfigFile()
  return jsonResponse(res, 200, { ok: true })
}

/** POST /api/mcp/servers/:name/test — Test MCP server connection */
export async function handleTestMcpConnection(name: string, res: ServerResponse): Promise<void> {
  assertString(name, 'name')

  const db = getDb()
  const row = db.prepare('SELECT command, args, env FROM mcp_servers WHERE name = ?').get(name) as McpServerRow | undefined
  if (!row) {
    return jsonResponse(res, 404, { ok: false, error: `MCP server "${name}" not found` })
  }

  const command = row.command
  const args = safeParseJson<string[]>(row.args || '[]', [])
  const env = safeParseJson<Record<string, string>>(row.env || '{}', {})

  console.info(`[MCP] Testing connection: name="${name}" command="${command}" args=${JSON.stringify(args)}`)
  const result = await testMcpConnection(command, args, env)
  return jsonResponse(res, 200, { ok: true, result })
}

/** GET /api/mcp/marketplace/urls — Get marketplace URLs */
export async function handleGetMarketplaceUrls(res: ServerResponse): Promise<void> {
  const urls = getMarketplaceUrls()
  return jsonResponse(res, 200, { ok: true, urls })
}

/** POST /api/mcp/marketplace/urls — Add marketplace URL */
export async function handleAddMarketplaceUrl(body: unknown, res: ServerResponse): Promise<void> {
  const data = body as { url?: string } | null
  if (!data?.url) {
    return jsonResponse(res, 400, { ok: false, error: 'url is required' })
  }
  if (typeof data.url !== 'string' || !data.url.startsWith('http')) {
    return jsonResponse(res, 400, { ok: false, error: 'Invalid URL' })
  }

  const urls = getMarketplaceUrls()
  if (urls.includes(data.url)) {
    return jsonResponse(res, 409, { ok: false, error: 'URL already registered' })
  }

  urls.push(data.url)
  const db = getDb()
  db.prepare('INSERT OR REPLACE INTO user_preferences (key, value) VALUES (?, ?)').run(MKT_URLS_KEY, JSON.stringify(urls))
  return jsonResponse(res, 200, { ok: true })
}

/** DELETE /api/mcp/marketplace/urls/:url — Remove marketplace URL */
export async function handleRemoveMarketplaceUrl(url: string, res: ServerResponse): Promise<void> {
  // URL is passed as path param (encoded), decode it
  const decodedUrl = decodeURIComponent(url)
  const urls = getMarketplaceUrls().filter((u) => u !== decodedUrl)
  const db = getDb()
  if (urls.length === 0) {
    db.prepare('DELETE FROM user_preferences WHERE key = ?').run(MKT_URLS_KEY)
  } else {
    db.prepare('INSERT OR REPLACE INTO user_preferences (key, value) VALUES (?, ?)').run(MKT_URLS_KEY, JSON.stringify(urls))
  }
  return jsonResponse(res, 200, { ok: true })
}

/** POST /api/mcp/marketplace/urls/reset — Reset marketplace URLs to defaults */
export async function handleResetMarketplaceUrls(res: ServerResponse): Promise<void> {
  const db = getDb()
  db.prepare('DELETE FROM user_preferences WHERE key = ?').run(MKT_URLS_KEY)
  return jsonResponse(res, 200, { ok: true })
}