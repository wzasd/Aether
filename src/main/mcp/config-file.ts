import * as fs from 'fs'
import * as path from 'path'
import { homedir } from 'os'
import { getDb } from '../core/db'
import type { McpServerRow } from './types'
import { safeParseJson } from './types'

interface McpServerDef {
  command: string
  args: string[]
  env: Record<string, string>
}

export interface DiscoveredServer {
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  source: 'project' | 'global'
  sourcePath?: string
}

// Priority: .bytro > .cursor > .claude (first match wins)
const PROJECT_CONFIG_CANDIDATES = ['.bytro/mcp.json', '.cursor/mcp.json', '.claude/mcp.json']
const PREF_KEY_INCLUDE_PROJECT = 'mcp.includeProject'

function getConfigPath(): string {
  const bytroDir = path.join(homedir(), '.bytro')
  if (!fs.existsSync(bytroDir)) {
    fs.mkdirSync(bytroDir, { recursive: true, mode: 0o700 })
  }
  return path.join(bytroDir, 'mcp-config.json')
}

function isStringRecord(v: unknown): v is Record<string, string> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) &&
    Object.values(v).every((x) => typeof x === 'string')
}

// ─── Preference ──────────────────────────────────────────────

export function isProjectMcpEnabled(): boolean {
  const db = getDb()
  const row = db.prepare('SELECT value FROM user_preferences WHERE key = ?').get(PREF_KEY_INCLUDE_PROJECT) as { value: string } | undefined
  if (!row) return true
  return row.value === '1' || row.value === 'true'
}

export function setProjectMcpEnabled(enabled: boolean): void {
  const db = getDb()
  db.prepare('INSERT OR REPLACE INTO user_preferences (key, value) VALUES (?, ?)').run(PREF_KEY_INCLUDE_PROJECT, enabled ? '1' : '0')
}

// ─── Project-level discovery ────────────────────────────────

export function discoverProjectMcpConfig(workspaceDir: string): DiscoveredServer[] | null {
  if (!workspaceDir || !fs.existsSync(workspaceDir)) return null

  for (const candidate of PROJECT_CONFIG_CANDIDATES) {
    const filePath = path.join(workspaceDir, candidate)
    if (!fs.existsSync(filePath)) continue

    try {
      const raw = fs.readFileSync(filePath, 'utf-8')
      const parsed = JSON.parse(raw)
      const servers = parsed?.mcpServers
      if (!servers || typeof servers !== 'object') continue

      const result: DiscoveredServer[] = []
      for (const [name, def] of Object.entries(servers)) {
        const d = def as Record<string, unknown>
        if (typeof d.command !== 'string' || d.command.trim().length === 0) continue
        result.push({
          name,
          command: d.command,
          args: Array.isArray(d.args) ? d.args.filter((a): a is string => typeof a === 'string') : [],
          env: isStringRecord(d.env) ? d.env : {},
          source: 'project',
          sourcePath: filePath
        })
      }
      return result.length > 0 ? result : null
    } catch {
      continue
    }
  }

  return null
}

// ─── Config generation with merge ───────────────────────────

export function generateMcpConfigJson(workspaceDir?: string): string | null {
  const servers: Record<string, McpServerDef> = {}

  // Layer 1: global servers from DB
  const db = getDb()
  const rows = db.prepare(
    'SELECT name, command, args, env, enabled FROM mcp_servers ORDER BY name'
  ).all() as McpServerRow[]

  for (const row of rows) {
    if (row.enabled !== 1) continue
    try {
      servers[row.name] = {
        command: row.command,
        args: safeParseJson<string[]>(row.args || '[]', []),
        env: safeParseJson<Record<string, string>>(row.env || '{}', {})
      }
    } catch {
      // skip corrupt row
    }
  }

  // Layer 2: project-level servers (override global by name), if enabled
  if (workspaceDir && isProjectMcpEnabled()) {
    const projectServers = discoverProjectMcpConfig(workspaceDir)
    if (projectServers) {
      for (const s of projectServers) {
        servers[s.name] = {
          command: s.command,
          args: s.args,
          env: s.env
        }
      }
    }
  }

  if (Object.keys(servers).length === 0) return null

  return JSON.stringify({ mcpServers: servers }, null, 2)
}

export function writeMcpConfigFile(workspaceDir?: string): string | null {
  const json = generateMcpConfigJson(workspaceDir)
  const configPath = getConfigPath()

  if (json === null) {
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath)
    }
    return null
  }

  fs.writeFileSync(configPath, json, { encoding: 'utf-8', mode: 0o600 })
  return configPath
}

// Session startup — always regenerates to avoid stale config from previous sessions.
export function getMcpConfigArgs(workspaceDir?: string): string[] {
  const configPath = writeMcpConfigFile(workspaceDir)
  if (configPath === null) return []
  return ['--mcp-config', configPath]
}
