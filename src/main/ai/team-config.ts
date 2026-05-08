import { randomUUID } from 'crypto'
import { getDb } from '../core/db'
import {
  DEV_TEAM_ID,
  DEV_TEAM_NAME,
  DEV_TEAM_DESCRIPTION,
  DEV_TEAM_MEMBERS as SEED_MEMBERS,
  DEV_TEAM_POLICIES as SEED_POLICIES
} from './preset-seed-data'

// ─── Target (Network) model — PRD Phase 2-3 ───────────────────────────

export interface TeamMember {
  profileId: string
  providerOverride?: string
  modelOverride?: string
}

export interface AgentSpacePolicy {
  allowAgentMention: boolean
  allowParallelThinking: boolean
  allowCapabilityRouting: boolean
  allowAgentToDelegate: boolean
  maxParallelAgents: number
  writeMode: 'single-writer' | 'multi-writer-with-approval'
}

export const DEFAULT_POLICY: AgentSpacePolicy = {
  allowAgentMention: true,
  allowParallelThinking: false,
  allowCapabilityRouting: false,
  allowAgentToDelegate: true,
  maxParallelAgents: 5,
  writeMode: 'single-writer'
}

// ─── Legacy (Pipeline) model — kept for backward compat ────────────────

export interface AgentStep {
  profileId: string
  role: 'primary' | 'reviewer' | 'specialist'
  trigger: 'always' | 'on-code-change' | 'manual'
  feedbackTo: string | null
}

export interface AgentTeamConfig {
  id: string
  name: string
  description: string
  members?: TeamMember[]
  policies?: AgentSpacePolicy
  pipeline?: AgentStep[]
}

// ─── Hardcoded default (seed into DB on first migration) ───────────────

export const DEV_TEAM: AgentTeamConfig = {
  id: DEV_TEAM_ID,
  name: DEV_TEAM_NAME,
  description: DEV_TEAM_DESCRIPTION,
  members: SEED_MEMBERS,
  policies: SEED_POLICIES
}

// ─── DB row ─────────────────────────────────────────────────────────────

interface TeamRow {
  id: string
  workspace_id: string | null
  name: string
  description: string | null
  members: string
  policies_json: string | null
  created_at: number
  updated_at: number
}

function parsePolicies(raw: string | null): AgentSpacePolicy {
  try {
    if (raw) {
      const parsed = JSON.parse(raw)
      return { ...DEFAULT_POLICY, ...parsed }
    }
  } catch { /* fall through */ }
  return { ...DEFAULT_POLICY }
}

function rowToTeam(row: TeamRow): AgentTeamConfig {
  const members = (() => {
    try { return JSON.parse(row.members) as TeamMember[] } catch { return [] }
  })()

  const policies = parsePolicies(row.policies_json)

  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    members,
    policies
  }
}

// ─── Public API ─────────────────────────────────────────────────────────

export function loadTeams(): AgentTeamConfig[] {
  const db = getDb()
  try {
    ensureDefaultTeam(db)
    const rows = db.prepare('SELECT * FROM team_configs ORDER BY created_at ASC').all() as TeamRow[]
    return rows.map(rowToTeam)
  } catch {
    return [DEV_TEAM]
  }
}

export function getTeam(id: string): AgentTeamConfig | undefined {
  const db = getDb()
  try {
    if (id === DEV_TEAM.id) ensureDefaultTeam(db)
    const row = db.prepare('SELECT * FROM team_configs WHERE id = ?').get(id) as TeamRow | undefined
    if (row) return rowToTeam(row)
  } catch { /* fall through to hardcoded */ }

  // Fallback to hardcoded during migration transition
  if (id === DEV_TEAM.id) return DEV_TEAM
  return undefined
}

export function createTeam(data: {
  name: string
  description?: string
  members?: TeamMember[]
  policies?: Partial<AgentSpacePolicy>
  workspaceId?: string
}): AgentTeamConfig {
  const db = getDb()
  const id = `team-${randomUUID()}`
  const now = Math.floor(Date.now() / 1000)
  const members = data.members ?? []
  const policies = { ...DEFAULT_POLICY, ...data.policies }

  db.prepare(`
    INSERT INTO team_configs (id, workspace_id, name, description, members, policies_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, data.workspaceId ?? null, data.name, data.description ?? null, JSON.stringify(members), JSON.stringify(policies), now, now)

  const row = db.prepare('SELECT * FROM team_configs WHERE id = ?').get(id) as TeamRow
  return rowToTeam(row)
}

export function updateTeam(id: string, patch: {
  name?: string
  description?: string
  members?: TeamMember[]
  policies?: Partial<AgentSpacePolicy>
}): AgentTeamConfig | null {
  const db = getDb()
  if (id === DEV_TEAM.id) ensureDefaultTeam(db)
  const existing = db.prepare('SELECT * FROM team_configs WHERE id = ?').get(id) as TeamRow | undefined
  if (!existing) return null

  const now = Math.floor(Date.now() / 1000)
  const fields: string[] = ['updated_at = ?']
  const values: unknown[] = [now]

  if (patch.name !== undefined) { fields.push('name = ?'); values.push(patch.name) }
  if (patch.description !== undefined) { fields.push('description = ?'); values.push(patch.description) }
  if (patch.members !== undefined) { fields.push('members = ?'); values.push(JSON.stringify(patch.members)) }
  if (patch.policies !== undefined) {
    const merged = { ...parsePolicies(existing.policies_json), ...patch.policies }
    fields.push('policies_json = ?')
    values.push(JSON.stringify(merged))
  }

  values.push(id)
  db.prepare(`UPDATE team_configs SET ${fields.join(', ')} WHERE id = ?`).run(...values)

  const row = db.prepare('SELECT * FROM team_configs WHERE id = ?').get(id) as TeamRow
  return rowToTeam(row)
}

export function deleteTeam(id: string): boolean {
  const db = getDb()
  const result = db.prepare('DELETE FROM team_configs WHERE id = ?').run(id)
  return result.changes > 0
}

export function seedDefaultTeam(): void {
  const db = getDb()
  ensureDefaultTeam(db)
}

function ensureDefaultTeam(db: ReturnType<typeof getDb>): void {
  const count = db.prepare('SELECT COUNT(*) AS cnt FROM team_configs').get() as { cnt: number }
  if (count.cnt > 0) return

  const now = Math.floor(Date.now() / 1000)
  db.prepare(`
    INSERT INTO team_configs (id, workspace_id, name, description, members, policies_json, created_at, updated_at)
    VALUES (?, NULL, ?, ?, ?, ?, ?, ?)
  `).run(DEV_TEAM.id, DEV_TEAM.name, DEV_TEAM.description, JSON.stringify(SEED_MEMBERS), JSON.stringify(SEED_POLICIES), now, now)
}
