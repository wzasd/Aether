/**
 * loadDaemonConfig — loads agent profiles and session config from DB.
 *
 * Used by daemon-entry.ts (CLI/headless mode) to initialize DaemonCore
 * without depending on Electron or the orchestrator.
 *
 * ADR-017 Phase 3b: C1 fix — daemon must be functional in headless mode.
 */

import { getDb } from './db'
import type { AgentProfile } from '../ai/a2a-types'
import type { SessionConfig } from '../ai/provider'

// ---------------------------------------------------------------------------
// Agent profile loading (from agent_profile_configs table)
// ---------------------------------------------------------------------------

interface AgentProfileRow {
  id: string
  workspace_id: string | null
  name: string
  role: string
  model: string
  description: string | null
  system_prompt: string | null
  preferred_provider: string | null
  capabilities: string | null
  when_to_use: string | null
  output_contract: string | null
  is_enabled: number
  sort_order: number
  created_at: number
  updated_at: number
}

function rowToProfile(row: AgentProfileRow): AgentProfile {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    role: row.role,
    model: row.model,
    description: row.description,
    systemPrompt: row.system_prompt,
    preferredProvider: row.preferred_provider ?? undefined,
    capabilities: row.capabilities ? JSON.parse(row.capabilities) : undefined,
    whenToUse: row.when_to_use ?? undefined,
    outputContract: row.output_contract ?? undefined,
    isEnabled: row.is_enabled === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Load all enabled agent profiles from the database.
 */
export function loadEnabledProfiles(): AgentProfile[] {
  const db = getDb()
  const rows = db.prepare(
    `SELECT id, workspace_id, name, role, model, description, system_prompt,
            preferred_provider, capabilities, when_to_use, output_contract,
            is_enabled, sort_order, created_at, updated_at
     FROM agent_profile_configs WHERE is_enabled = 1 ORDER BY sort_order ASC`
  ).all() as AgentProfileRow[]
  return rows.map(rowToProfile)
}

// ---------------------------------------------------------------------------
// Session config loading (from provider_config table)
// ---------------------------------------------------------------------------

/**
 * Load the default session config from the database.
 * Falls back to sensible defaults if no config is stored.
 */
export function loadSessionConfig(): SessionConfig {
  const db = getDb()

  try {
    const row = db.prepare(
      `SELECT provider_type, model, working_dir, permission_mode
       FROM provider_config
       WHERE is_default = 1
       LIMIT 1`
    ).get() as { provider_type: string; model: string; working_dir: string | null; permission_mode: string | null } | undefined

    if (row) {
      return {
        providerType: row.provider_type,
        model: row.model,
        workingDir: row.working_dir ?? process.cwd(),
        permissionMode: (row.permission_mode as SessionConfig['permissionMode']) ?? 'trusted',
      }
    }
  } catch (err) {
    // provider_config table may not exist yet
    console.warn('[loadDaemonConfig] Failed to load provider_config:', err)
  }

  // Fallback defaults
  return {
    providerType: 'openai',
    model: 'gpt-4o',
    workingDir: process.cwd(),
    permissionMode: 'trusted',
  }
}