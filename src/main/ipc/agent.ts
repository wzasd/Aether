import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { getDb } from '../core/db'
import { rowToProfile, type AgentProfileRow } from '../ai/profile-utils'

const SEED_DEFAULTS = [
  { name: 'Planner', role: 'planning', model: 'claude-opus-4-7', is_enabled: 1, sort_order: 0, description: '任务分解与方案验证' },
  { name: 'Coder', role: 'implementation', model: 'claude-sonnet-4-6', is_enabled: 1, sort_order: 1, description: '代码编写与重构' },
  { name: 'Reviewer', role: 'review', model: 'claude-haiku-4-5-20251001', is_enabled: 0, sort_order: 2, description: '代码审查与风险识别' }
]

export function registerAgentIpc(): void {
  ipcMain.handle('agent:listProfiles', (_event, workspaceId?: string) => {
    const db = getDb()
    const rows = workspaceId
      ? db.prepare('SELECT * FROM agent_profile_configs WHERE workspace_id = ? OR workspace_id IS NULL ORDER BY sort_order ASC').all(workspaceId)
      : db.prepare('SELECT * FROM agent_profile_configs ORDER BY sort_order ASC').all()
    return (rows as AgentProfileRow[]).map(rowToProfile)
  })

  ipcMain.handle('agent:createProfile', (_event, data: {
    name: string
    role?: string
    model?: string
    description?: string
    systemPrompt?: string
    preferredProvider?: string | null
    capabilities?: string[]
    whenToUse?: string
    outputContract?: string
    customEnv?: Record<string, string>
    customArgs?: string[]
    isEnabled?: boolean
    sortOrder?: number
    workspaceId?: string
  }) => {
    const db = getDb()
    const id = randomUUID()
    const now = Math.floor(Date.now() / 1000)

    db.prepare(`
      INSERT INTO agent_profile_configs (id, workspace_id, name, role, model, description, system_prompt, preferred_provider, capabilities, when_to_use, output_contract, custom_env, custom_args, is_enabled, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.workspaceId ?? null,
      data.name,
      data.role ?? 'coder',
      data.model ?? 'claude-sonnet-4-6',
      data.description ?? null,
      data.systemPrompt ?? null,
      data.preferredProvider ?? null,
      data.capabilities ? JSON.stringify(data.capabilities) : null,
      data.whenToUse ?? null,
      data.outputContract ?? null,
      data.customEnv ? JSON.stringify(data.customEnv) : null,
      data.customArgs ? JSON.stringify(data.customArgs) : null,
      data.isEnabled !== false ? 1 : 0,
      data.sortOrder ?? 0,
      now,
      now
    )

    const row = db.prepare('SELECT * FROM agent_profile_configs WHERE id = ?').get(id) as AgentProfileRow
    return rowToProfile(row)
  })

  ipcMain.handle('agent:updateProfile', (_event, id: string, patch: {
    name?: string
    role?: string
    model?: string | null
    description?: string | null
    systemPrompt?: string | null
    preferredProvider?: string | null
    capabilities?: string[] | null
    whenToUse?: string | null
    outputContract?: string | null
    customEnv?: Record<string, string> | null
    customArgs?: string[] | null
    isEnabled?: boolean
    sortOrder?: number
  }) => {
    const db = getDb()
    const now = Math.floor(Date.now() / 1000)
    const fields: string[] = ['updated_at = ?']
    const values: unknown[] = [now]

    if (patch.name !== undefined) { fields.push('name = ?'); values.push(patch.name) }
    if (patch.role !== undefined) { fields.push('role = ?'); values.push(patch.role) }
    if (patch.model !== undefined && patch.model !== null && patch.model !== '') {
      fields.push('model = ?')
      values.push(patch.model)
    }
    if (patch.description !== undefined) { fields.push('description = ?'); values.push(patch.description) }
    if (patch.systemPrompt !== undefined) { fields.push('system_prompt = ?'); values.push(patch.systemPrompt) }
    if (patch.preferredProvider !== undefined) { fields.push('preferred_provider = ?'); values.push(patch.preferredProvider) }
    if (patch.capabilities !== undefined) { fields.push('capabilities = ?'); values.push(patch.capabilities ? JSON.stringify(patch.capabilities) : null) }
    if (patch.whenToUse !== undefined) { fields.push('when_to_use = ?'); values.push(patch.whenToUse) }
    if (patch.outputContract !== undefined) { fields.push('output_contract = ?'); values.push(patch.outputContract) }
    if (patch.customEnv !== undefined) { fields.push('custom_env = ?'); values.push(patch.customEnv ? JSON.stringify(patch.customEnv) : null) }
    if (patch.customArgs !== undefined) { fields.push('custom_args = ?'); values.push(patch.customArgs ? JSON.stringify(patch.customArgs) : null) }
    if (patch.isEnabled !== undefined) { fields.push('is_enabled = ?'); values.push(patch.isEnabled ? 1 : 0) }
    if (patch.sortOrder !== undefined) { fields.push('sort_order = ?'); values.push(patch.sortOrder) }

    values.push(id)
    db.prepare(`UPDATE agent_profile_configs SET ${fields.join(', ')} WHERE id = ?`).run(...values)

    const row = db.prepare('SELECT * FROM agent_profile_configs WHERE id = ?').get(id) as AgentProfileRow
    return rowToProfile(row)
  })

  ipcMain.handle('agent:deleteProfile', (_event, id: string) => {
    const db = getDb()
    db.prepare('DELETE FROM agent_profile_configs WHERE id = ?').run(id)
  })

  ipcMain.handle('agent:seedDefaults', () => {
    const db = getDb()
    const count = db.prepare('SELECT COUNT(*) AS cnt FROM agent_profile_configs').get() as { cnt: number }
    if (count.cnt > 0) {
      return db.prepare('SELECT * FROM agent_profile_configs ORDER BY sort_order ASC').all().map(rowToProfile)
    }

    const now = Math.floor(Date.now() / 1000)
    for (const d of SEED_DEFAULTS) {
      db.prepare(`
        INSERT INTO agent_profile_configs (id, workspace_id, name, role, model, description, is_enabled, sort_order, created_at, updated_at)
        VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(randomUUID(), d.name, d.role, d.model, d.description, d.is_enabled, d.sort_order, now, now)
    }

    const rows = db.prepare('SELECT * FROM agent_profile_configs ORDER BY sort_order ASC').all() as AgentProfileRow[]
    return rows.map(rowToProfile)
  })
}
