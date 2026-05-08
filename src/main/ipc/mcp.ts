import { ipcMain } from 'electron'
import { getDb } from '../core/db'
import { writeMcpConfigFile, discoverProjectMcpConfig, isProjectMcpEnabled, setProjectMcpEnabled } from '../mcp/config-file'
import { testMcpConnection } from '../mcp/connector'
import type { McpServerRow } from '../mcp/types'
import { safeParseJson } from '../mcp/types'

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

export function registerMcpIpc(): void {
  ipcMain.handle('mcp:list', async () => {
    const db = getDb()
    const rows = db.prepare('SELECT name, command, args, env, enabled FROM mcp_servers ORDER BY name').all() as McpServerRow[]
    return rows.map((r) => ({
      name: r.name,
      command: r.command,
      args: safeParseJson<string[]>(r.args || '[]', []),
      env: safeParseJson<Record<string, string>>(r.env || '{}', {}),
      enabled: r.enabled === 1
    }))
  })

  ipcMain.handle('mcp:add', async (_event, data: { name: string; command: string; args?: string[]; env?: Record<string, string> }) => {
    assertString(data.name, 'name')
    assertString(data.command, 'command')
    assertArgs(data.args)
    assertEnv(data.env)

    const db = getDb()
    const existing = db.prepare('SELECT name FROM mcp_servers WHERE name = ?').get(data.name)
    if (existing) {
      throw new Error(`MCP server "${data.name}" already exists`)
    }

    db.prepare('INSERT INTO mcp_servers (name, command, args, env, enabled) VALUES (?, ?, ?, ?, 1)').run(
      data.name,
      data.command,
      JSON.stringify(data.args || []),
      JSON.stringify(data.env || {})
    )

    writeMcpConfigFile()
    return { ok: true }
  })

  ipcMain.handle('mcp:update', async (_event, name: string, data: { command?: string; args?: string[]; env?: Record<string, string> }) => {
    assertString(name, 'name')
    assertArgs(data.args)
    assertEnv(data.env)

    const db = getDb()
    const existing = db.prepare('SELECT name FROM mcp_servers WHERE name = ?').get(name)
    if (!existing) {
      throw new Error(`MCP server "${name}" not found`)
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
    return { ok: true }
  })

  ipcMain.handle('mcp:remove', async (_event, name: string) => {
    assertString(name, 'name')

    const db = getDb()
    const result = db.prepare('DELETE FROM mcp_servers WHERE name = ?').run(name)
    if (result.changes === 0) {
      throw new Error(`MCP server "${name}" not found`)
    }

    writeMcpConfigFile()
    return { ok: true }
  })

  ipcMain.handle('mcp:toggle', async (_event, name: string, enabled: boolean) => {
    assertString(name, 'name')

    const db = getDb()
    const result = db.prepare('UPDATE mcp_servers SET enabled = ? WHERE name = ?').run(enabled ? 1 : 0, name)
    if (result.changes === 0) {
      throw new Error(`MCP server "${name}" not found`)
    }

    writeMcpConfigFile()
    return { ok: true }
  })

  ipcMain.handle('mcp:discoverProject', async (_event, workspaceDir: string) => {
    if (!workspaceDir || typeof workspaceDir !== 'string') return []
    const servers = discoverProjectMcpConfig(workspaceDir)
    return servers || []
  })

  ipcMain.handle('mcp:getProjectMcpEnabled', async () => {
    return isProjectMcpEnabled()
  })

  ipcMain.handle('mcp:setProjectMcpEnabled', async (_event, enabled: boolean) => {
    setProjectMcpEnabled(enabled)
    writeMcpConfigFile()
    return { ok: true }
  })

  ipcMain.handle('mcp:testConnection', async (_event, name: string) => {
    assertString(name, 'name')

    const db = getDb()
    const row = db.prepare('SELECT command, args, env FROM mcp_servers WHERE name = ?').get(name) as McpServerRow | undefined
    if (!row) {
      throw new Error(`MCP server "${name}" not found`)
    }

    const command = row.command
    const args = safeParseJson<string[]>(row.args || '[]', [])
    const env = safeParseJson<Record<string, string>>(row.env || '{}', {})

    console.info(`[MCP] Testing connection: name="${name}" command="${command}" args=${JSON.stringify(args)}`)
    const result = await testMcpConnection(command, args, env)
    return result
  })

  // ── Marketplace URLs ─────────────────────────────────────

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

  ipcMain.handle('mcp:getMarketplaceUrls', async () => {
    return getMarketplaceUrls()
  })

  ipcMain.handle('mcp:addMarketplaceUrl', async (_event, url: string) => {
    if (typeof url !== 'string' || !url.startsWith('http')) throw new Error('Invalid URL')
    const urls = getMarketplaceUrls()
    if (urls.includes(url)) throw new Error('URL already registered')
    urls.push(url)
    const db = getDb()
    db.prepare('INSERT OR REPLACE INTO user_preferences (key, value) VALUES (?, ?)').run(MKT_URLS_KEY, JSON.stringify(urls))
    return { ok: true }
  })

  ipcMain.handle('mcp:removeMarketplaceUrl', async (_event, url: string) => {
    const urls = getMarketplaceUrls().filter((u) => u !== url)
    const db = getDb()
    if (urls.length === 0) {
      db.prepare('DELETE FROM user_preferences WHERE key = ?').run(MKT_URLS_KEY)
    } else {
      db.prepare('INSERT OR REPLACE INTO user_preferences (key, value) VALUES (?, ?)').run(MKT_URLS_KEY, JSON.stringify(urls))
    }
    return { ok: true }
  })

  ipcMain.handle('mcp:resetMarketplaceUrls', async () => {
    const db = getDb()
    db.prepare('DELETE FROM user_preferences WHERE key = ?').run(MKT_URLS_KEY)
    return { ok: true }
  })
}
