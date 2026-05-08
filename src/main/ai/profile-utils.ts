import type { AgentProfile } from './a2a-types'

export interface AgentProfileRow {
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

export function parseCapabilities(raw: string | null): string[] | undefined {
  if (!raw) return undefined
  try { return JSON.parse(raw) } catch { return undefined }
}

export function rowToProfile(row: AgentProfileRow): AgentProfile {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    role: row.role,
    model: row.model,
    description: row.description,
    systemPrompt: row.system_prompt,
    preferredProvider: row.preferred_provider || undefined,
    capabilities: parseCapabilities(row.capabilities),
    whenToUse: row.when_to_use || undefined,
    outputContract: row.output_contract || undefined,
    isEnabled: row.is_enabled === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
