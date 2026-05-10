import { ipcMain, dialog } from 'electron'
import { randomUUID } from 'crypto'
import * as fs from 'fs'
import { getDb } from '../core/db'
import { buildFtsQuery } from '../utils/fts'
import { buildMarkdownExport, buildJsonExport, sanitizeFilename } from '../utils/export'
import { estimateCost } from '../ai/pricing'
import type { ExportOptions } from '../utils/export'
import { bus } from '../daemon/event-bus'

export interface Conversation {
  id: string
  workspace_id: string | null
  title: string | null
  title_source: string
  model: string | null
  provider: string | null
  status: string
  mode: string | null
  agent_count: number
  change_count: number
  team_id: string | null
  task_id: string | null
  is_draft: number
  created_at: number
  updated_at: number
}

const VALID_TRANSITIONS: Record<string, string[]> = {
  Idle:    ['Running', 'Idle'],
  Running: ['Running', 'Waiting', 'Done', 'Error', 'Idle'],
  Waiting: ['Running', 'Error', 'Idle'],
  Error:   ['Running', 'Idle'],
  Done:    ['Running', 'Done'],
}

function validateRange(range?: { from?: number; to?: number }): void {
  if (!range) return
  if (range.from !== undefined && (typeof range.from !== 'number' || range.from < 0)) {
    throw new Error('Invalid range: from must be a non-negative number')
  }
  if (range.to !== undefined && (typeof range.to !== 'number' || range.to < 0)) {
    throw new Error('Invalid range: to must be a non-negative number')
  }
  if (range.from !== undefined && range.to !== undefined && range.from > range.to) {
    throw new Error('Invalid range: from must be <= to')
  }
}

export interface Message {
  id: string
  conversation_id: string
  role: 'user' | 'assistant' | 'system'
  content: string | null
  thinking: string | null
  tool_calls: string | null
  tool_results: string | null
  usage: string | null
  parent_tool_use_id: string | null
  created_at: number
}

export function registerConversationIpc(): void {
  // List conversations — excludes drafts and soft-deleted by default
  ipcMain.handle('conversation:list', (_event, workspaceId?: string, status?: string) => {
    const db = getDb()
    if (workspaceId && status) {
      return db.prepare('SELECT * FROM conversations WHERE workspace_id = ? AND status = ? AND is_draft = 0 AND deleted_at IS NULL ORDER BY updated_at DESC').all(workspaceId, status) as Conversation[]
    }
    if (workspaceId) {
      return db.prepare('SELECT * FROM conversations WHERE workspace_id = ? AND is_draft = 0 AND deleted_at IS NULL ORDER BY updated_at DESC').all(workspaceId) as Conversation[]
    }
    if (status) {
      return db.prepare('SELECT * FROM conversations WHERE status = ? AND is_draft = 0 AND deleted_at IS NULL ORDER BY updated_at DESC').all(status) as Conversation[]
    }
    return db.prepare('SELECT * FROM conversations WHERE is_draft = 0 AND deleted_at IS NULL ORDER BY updated_at DESC').all() as Conversation[]
  })

  // Get single conversation with messages
  ipcMain.handle('conversation:get', (_event, id: string) => {
    const db = getDb()
    const conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as Conversation | undefined
    if (!conversation) return null
    const messages = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC').all(id) as Message[]
    return { ...conversation, messages }
  })

  // Create conversation
  ipcMain.handle('conversation:create', (_event, data: { workspace_id?: string; title?: string; model?: string; provider?: string; agent_profile_id?: string; team_id?: string; task_id?: string; is_draft?: number }) => {
    const db = getDb()
    const id = randomUUID()
    const now = Math.floor(Date.now() / 1000)
    db.prepare(
      'INSERT INTO conversations (id, workspace_id, title, model, provider, agent_profile_id, team_id, task_id, is_draft, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, data.workspace_id ?? null, data.title ?? 'New Chat', data.model ?? null, data.provider ?? null, data.agent_profile_id ?? null, data.team_id ?? null, data.task_id ?? null, data.is_draft ?? 0, now, now)
    return db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as Conversation
  })

  // Update conversation
  ipcMain.handle('conversation:update', (_event, id: string, data: Record<string, unknown>) => {
    const db = getDb()

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Invalid payload: data must be a plain object')
    }

    const allowedFields = new Set(['title', 'title_source', 'model', 'provider', 'agent_count', 'change_count', 'agent_profile_id', 'team_id', 'task_id', 'is_draft'])
    const unknownKeys = Object.keys(data).filter((k) => !allowedFields.has(k))
    if (unknownKeys.length > 0) {
      throw new Error(`Invalid fields: ${unknownKeys.join(', ')}`)
    }

    const validEntries = Object.entries(data).filter(([k]) => allowedFields.has(k))
    if (validEntries.length === 0) {
      throw new Error('No valid fields to update')
    }

    const now = Math.floor(Date.now() / 1000)
    const fields: string[] = []
    const values: unknown[] = []

    for (const [key, value] of validEntries) {
      fields.push(`${key} = ?`)
      values.push(value)
    }

    fields.push('updated_at = ?')
    values.push(now)
    values.push(id)

    db.prepare(`UPDATE conversations SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    return db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as Conversation
  })

  // Promote draft: mark is_draft = 0 so conversation appears in TaskRail
  ipcMain.handle('conversation:promoteDraft', (_event, id: string) => {
    const db = getDb()
    const now = Math.floor(Date.now() / 1000)
    db.prepare('UPDATE conversations SET is_draft = 0, updated_at = ? WHERE id = ?').run(now, id)
    return db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as Conversation
  })

  // Delete conversation (soft delete — sets deleted_at, data retained for 30 days)
  ipcMain.handle('conversation:delete', (_event, id: string) => {
    const db = getDb()
    const now = Math.floor(Date.now() / 1000)
    db.prepare('UPDATE conversations SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id)
    return { success: true }
  })

  // Update conversation status with state machine validation
  ipcMain.handle('conversation:updateStatus', (_event, id: string, newStatus: string) => {
    const db = getDb()
    const conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as Conversation | undefined
    if (!conversation) {
      throw new Error(`Conversation not found: ${id}`)
    }

    const allowed = VALID_TRANSITIONS[conversation.status]
    if (!allowed || !allowed.includes(newStatus)) {
      throw new Error(`Invalid status transition: ${conversation.status} -> ${newStatus}`)
    }

    const now = Math.floor(Date.now() / 1000)
    db.prepare('UPDATE conversations SET status = ?, updated_at = ? WHERE id = ?').run(newStatus, now, id)
    return db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as Conversation
  })

  // Add message
  ipcMain.handle('message:create', (_event, data: { conversation_id: string; role: Message['role']; content: string; thinking?: string; tool_calls?: string; tool_results?: string; usage?: string; parent_tool_use_id?: string; agent_profile_id?: string | null }) => {
    const db = getDb()
    const id = randomUUID()
    const now = Math.floor(Date.now() / 1000)
    db.prepare(
      'INSERT INTO messages (id, conversation_id, role, content, thinking, tool_calls, tool_results, usage, parent_tool_use_id, agent_profile_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, data.conversation_id, data.role, data.content, data.thinking ?? null, data.tool_calls ?? null, data.tool_results ?? null, data.usage ?? null, data.parent_tool_use_id ?? null, data.agent_profile_id ?? null, now)
    // Update conversation updated_at
    db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, data.conversation_id)
    
    // Emit event for event-driven agent trigger (Phase 2)
    // CRITICAL: Only publish message:new for user messages.
    // Agent replies are already notified via message:reply in claimAndExecute.
    // Publishing message:new for agent replies causes infinite loop:
    // Agent reply → message:create → message:new → all agents enqueue → reply → repeat
    if (data.role === 'user') {
      // Fetch recent conversation context for Agent pre-injection
      const recentMessages = db.prepare(
        'SELECT role, content, agent_profile_id FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 20'
      ).all(data.conversation_id) as Array<{ role: string; content: string; agent_profile_id: string | null }>

      const context = recentMessages.reverse().map((m) => ({
        role: m.role === 'assistant' && m.agent_profile_id ? 'agent' : m.role,
        content: m.content,
      }))

      bus.publish({
        type: 'message:new',
        conversationId: data.conversation_id,
        actorType: 'user',
        actorId: null,
        payload: {
          messageId: id,
          role: data.role,
          content: data.content,
          context,
        },
      })
    }
    
    return db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as Message
  })

  // Search messages
  ipcMain.handle('conversation:search', (_event, query: string) => {
    if (typeof query !== 'string') {
      throw new Error('Invalid search query')
    }

    const ftsQuery = buildFtsQuery(query)
    if (!ftsQuery) return []

    const db = getDb()
    const results = db.prepare(`
      SELECT c.id, c.title,
             snippet(messages_fts, 0, '<<', '>>', '...', 32) as snippet,
             m.created_at as matchedAt,
             bm25(messages_fts) as rank
      FROM messages_fts
      JOIN messages m ON m.rowid = messages_fts.rowid
      JOIN conversations c ON c.id = m.conversation_id
      WHERE messages_fts MATCH ?
      ORDER BY rank
      LIMIT 20
    `).all(ftsQuery)
    return results
  })

  // Increment agent_count atomically
  ipcMain.handle('conversation:incrementAgentCount', (_event, id: string) => {
    const db = getDb()
    const now = Math.floor(Date.now() / 1000)
    db.prepare('UPDATE conversations SET agent_count = agent_count + 1, updated_at = ? WHERE id = ?').run(now, id)
    return db.prepare('SELECT agent_count FROM conversations WHERE id = ?').get(id) as { agent_count: number } | undefined
  })

  // Auto-title: only updates if title_source is 'auto'
  ipcMain.handle('conversation:autoTitle', async (_, id: string, title: string) => {
    const db = getDb()
    const stmt = db.prepare(
      "UPDATE conversations SET title = ?, updated_at = ? WHERE id = ? AND title_source = 'auto'"
    )
    stmt.run(title, Math.floor(Date.now() / 1000), id)
    return { success: true }
  })

  // Manual title: sets title and marks as manual
  ipcMain.handle('conversation:setTitle', async (_, id: string, title: string) => {
    const db = getDb()
    const stmt = db.prepare(
      "UPDATE conversations SET title = ?, title_source = 'manual', updated_at = ? WHERE id = ?"
    )
    stmt.run(title, Math.floor(Date.now() / 1000), id)
    return { success: true }
  })

  // Usage: create record
  ipcMain.handle('usage:create', (_event, data: { conversation_id: string; model: string; input_tokens: number; output_tokens: number; cache_read_tokens?: number; cache_creation_tokens?: number; cost_usd?: number; provider_id?: string }) => {
    if (!data.conversation_id || typeof data.conversation_id !== 'string') {
      throw new Error('Invalid payload: conversation_id is required')
    }
    if (typeof data.model !== 'string' || data.model.length === 0) {
      throw new Error('Invalid payload: model is required')
    }
    if (typeof data.input_tokens !== 'number' || data.input_tokens < 0 || !Number.isFinite(data.input_tokens)) {
      throw new Error('Invalid payload: input_tokens must be a non-negative number')
    }
    if (typeof data.output_tokens !== 'number' || data.output_tokens < 0 || !Number.isFinite(data.output_tokens)) {
      throw new Error('Invalid payload: output_tokens must be a non-negative number')
    }
    if (data.cache_read_tokens !== undefined && (typeof data.cache_read_tokens !== 'number' || data.cache_read_tokens < 0 || !Number.isFinite(data.cache_read_tokens))) {
      throw new Error('Invalid payload: cache_read_tokens must be a non-negative number')
    }
    if (data.cache_creation_tokens !== undefined && (typeof data.cache_creation_tokens !== 'number' || data.cache_creation_tokens < 0 || !Number.isFinite(data.cache_creation_tokens))) {
      throw new Error('Invalid payload: cache_creation_tokens must be a non-negative number')
    }
    if (data.provider_id !== undefined && typeof data.provider_id !== 'string') {
      throw new Error('Invalid payload: provider_id must be a string')
    }
    if (data.cost_usd !== undefined && (typeof data.cost_usd !== 'number' || !Number.isFinite(data.cost_usd))) {
      throw new Error('Invalid payload: cost_usd must be a number')
    }
    const db = getDb()
    const id = randomUUID()
    const now = Math.floor(Date.now() / 1000)
    const costUsd = data.cost_usd ?? estimateCost(data.model, data.input_tokens, data.output_tokens, data.cache_read_tokens, data.cache_creation_tokens)
    db.prepare(
      'INSERT INTO conversation_usage (id, conversation_id, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd, provider_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, data.conversation_id, data.model, data.input_tokens, data.output_tokens, data.cache_read_tokens ?? 0, data.cache_creation_tokens ?? 0, costUsd, data.provider_id ?? null, now)
    return { id, costUsd }
  })

  // Usage: list records for a conversation
  ipcMain.handle('usage:list', (_event, conversationId: string) => {
    const db = getDb()
    return db.prepare('SELECT * FROM conversation_usage WHERE conversation_id = ? ORDER BY created_at ASC').all(conversationId)
  })

  // Usage: summary (daily aggregation, optional date range)
  ipcMain.handle('usage:summary', (_event, range?: { from?: number; to?: number }) => {
    validateRange(range)
    const db = getDb()
    if (range?.from !== undefined && range?.to !== undefined) {
      return db.prepare(
        'SELECT * FROM usage_daily WHERE day BETWEEN date(?, \'unixepoch\', \'localtime\') AND date(?, \'unixepoch\', \'localtime\') ORDER BY day DESC'
      ).all(range.from, range.to)
    }
    if (range?.from !== undefined) {
      return db.prepare(
        'SELECT * FROM usage_daily WHERE day >= date(?, \'unixepoch\', \'localtime\') ORDER BY day DESC'
      ).all(range.from)
    }
    return db.prepare('SELECT * FROM usage_daily ORDER BY day DESC LIMIT 90').all()
  })

  // Usage: total cost (optional date range)
  ipcMain.handle('usage:totalCost', (_event, range?: { from?: number; to?: number }) => {
    validateRange(range)
    const db = getDb()
    if (range?.from !== undefined && range?.to !== undefined) {
      const row = db.prepare(
        'SELECT COALESCE(SUM(total_cost), 0) AS total FROM usage_daily WHERE day BETWEEN date(?, \'unixepoch\', \'localtime\') AND date(?, \'unixepoch\', \'localtime\')'
      ).get(range.from, range.to) as { total: number }
      return row.total
    }
    if (range?.from !== undefined) {
      const row = db.prepare(
        'SELECT COALESCE(SUM(total_cost), 0) AS total FROM usage_daily WHERE day >= date(?, \'unixepoch\', \'localtime\')'
      ).get(range.from) as { total: number }
      return row.total
    }
    const row = db.prepare('SELECT COALESCE(SUM(total_cost), 0) AS total FROM usage_daily').get() as { total: number }
    return row.total
  })

  // Usage: per-provider token aggregation for the last N days
  ipcMain.handle('usage:byProvider', (_event, days: number = 7) => {
    if (typeof days !== 'number' || days < 1 || !Number.isFinite(days)) {
      throw new Error('Invalid payload: days must be a positive number')
    }
    const db = getDb()
    const from = Math.floor(Date.now() / 1000) - (days * 86400)
    const rows = db.prepare(
      `SELECT
         COALESCE(provider_id, 'unknown') AS provider_id,
         SUM(input_tokens)               AS total_input_tokens,
         SUM(output_tokens)              AS total_output_tokens,
         SUM(cost_usd)                   AS total_cost_usd,
         COUNT(*)                        AS total_calls
       FROM conversation_usage
       WHERE created_at >= ?
       GROUP BY provider_id`
    ).all(from) as Array<{
      provider_id: string
      total_input_tokens: number
      total_output_tokens: number
      total_cost_usd: number
      total_calls: number
    }>
    return rows
  })

  // Usage: per-agent token aggregation for the last N days
  // Joins conversation_usage → conversations to resolve agent_profile_id
  ipcMain.handle('usage:byAgent', (_event, days: number = 7) => {
    if (typeof days !== 'number' || days < 1 || !Number.isFinite(days)) {
      throw new Error('Invalid payload: days must be a positive number')
    }
    const db = getDb()
    const from = Math.floor(Date.now() / 1000) - (days * 86400)
    const rows = db.prepare(
      `SELECT
         COALESCE(c.agent_profile_id, 'unknown') AS agent_profile_id,
         SUM(cu.input_tokens)                    AS total_input_tokens,
         SUM(cu.output_tokens)                   AS total_output_tokens,
         SUM(cu.cost_usd)                        AS total_cost_usd,
         COUNT(*)                                 AS total_calls
       FROM conversation_usage cu
       JOIN conversations c ON c.id = cu.conversation_id
       WHERE cu.created_at >= ?
       GROUP BY c.agent_profile_id`
    ).all(from) as Array<{
      agent_profile_id: string
      total_input_tokens: number
      total_output_tokens: number
      total_cost_usd: number
      total_calls: number
    }>
    return rows
  })

  // Export conversation
  ipcMain.handle('conversation:export', async (_event, params: {
    conversationId: string
    format: 'markdown' | 'json'
    options?: ExportOptions
  }) => {
    const db = getDb()
    const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(params.conversationId) as Conversation | undefined
    if (!conv) {
      throw new Error(`Conversation not found: ${params.conversationId}`)
    }

    const messages = db.prepare(
      'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
    ).all(params.conversationId) as Message[]

    const usageRecords = db.prepare(
      'SELECT * FROM conversation_usage WHERE conversation_id = ? ORDER BY created_at ASC'
    ).all(params.conversationId) as { input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_creation_tokens: number; model: string }[]

    const isMarkdown = params.format === 'markdown'
    const content = isMarkdown
      ? buildMarkdownExport(conv, messages, usageRecords, params.options)
      : buildJsonExport(conv, messages, usageRecords, params.options)

    const ext = isMarkdown ? 'md' : 'json'
    const { filePath } = await dialog.showSaveDialog({
      defaultPath: `${sanitizeFilename(conv.title || 'untitled')}.${ext}`,
      filters: [{
        name: isMarkdown ? 'Markdown' : 'JSON',
        extensions: [ext],
      }],
    })

    if (filePath) {
      await fs.promises.writeFile(filePath, content, 'utf-8')
      return { success: true, path: filePath }
    }
    return { success: false, reason: 'cancelled' }
  })

  // Todo: sync (delete all + insert batch)
  ipcMain.handle('todo:sync', (_event, conversationId: string, items: Array<{ content: string; completed: number; order_index: number }>) => {
    const db = getDb()
    const now = Math.floor(Date.now() / 1000)
    const deleteStmt = db.prepare('DELETE FROM conversation_todos WHERE conversation_id = ?')
    const insertStmt = db.prepare('INSERT INTO conversation_todos (id, conversation_id, content, completed, order_index, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    const transaction = db.transaction(() => {
      deleteStmt.run(conversationId)
      for (const item of items) {
        insertStmt.run(randomUUID(), conversationId, item.content, item.completed, item.order_index, now)
      }
    })
    transaction()
    return { success: true }
  })

  // Todo: list records for a conversation
  ipcMain.handle('todo:list', (_event, conversationId: string) => {
    const db = getDb()
    return db.prepare('SELECT * FROM conversation_todos WHERE conversation_id = ? ORDER BY order_index ASC').all(conversationId)
  })
}
