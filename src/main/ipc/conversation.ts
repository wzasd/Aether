import { ipcMain } from 'electron'
import { getDb } from '../core/db'
import { randomUUID } from 'crypto'

export interface Conversation {
  id: string
  workspace_id: string | null
  title: string | null
  model: string | null
  provider: string | null
  created_at: number
  updated_at: number
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
  // List conversations
  ipcMain.handle('conversation:list', (_event, workspaceId?: string) => {
    const db = getDb()
    if (workspaceId) {
      return db.prepare('SELECT * FROM conversations WHERE workspace_id = ? ORDER BY updated_at DESC').all(workspaceId) as Conversation[]
    }
    return db.prepare('SELECT * FROM conversations ORDER BY updated_at DESC').all() as Conversation[]
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
  ipcMain.handle('conversation:create', (_event, data: { workspace_id?: string; title?: string; model?: string; provider?: string }) => {
    const db = getDb()
    const id = randomUUID()
    const now = Math.floor(Date.now() / 1000)
    db.prepare(
      'INSERT INTO conversations (id, workspace_id, title, model, provider, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, data.workspace_id ?? null, data.title ?? 'New Chat', data.model ?? null, data.provider ?? null, now, now)
    return db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as Conversation
  })

  // Update conversation
  ipcMain.handle('conversation:update', (_event, id: string, data: Record<string, unknown>) => {
    const db = getDb()

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Invalid payload: data must be a plain object')
    }

    const allowedFields = new Set(['title', 'model', 'provider'])
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

  // Delete conversation
  ipcMain.handle('conversation:delete', (_event, id: string) => {
    const db = getDb()
    db.prepare('DELETE FROM conversations WHERE id = ?').run(id)
    return { success: true }
  })

  // Add message
  ipcMain.handle('message:create', (_event, data: { conversation_id: string; role: Message['role']; content: string; thinking?: string; tool_calls?: string; tool_results?: string; usage?: string; parent_tool_use_id?: string }) => {
    const db = getDb()
    const id = randomUUID()
    const now = Math.floor(Date.now() / 1000)
    db.prepare(
      'INSERT INTO messages (id, conversation_id, role, content, thinking, tool_calls, tool_results, usage, parent_tool_use_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, data.conversation_id, data.role, data.content, data.thinking ?? null, data.tool_calls ?? null, data.tool_results ?? null, data.usage ?? null, data.parent_tool_use_id ?? null, now)
    // Update conversation updated_at
    db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, data.conversation_id)
    return db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as Message
  })

  // Search messages
  ipcMain.handle('conversation:search', (_event, query: string) => {
    const db = getDb()
    const results = db.prepare(`
      SELECT m.*, c.title as conversation_title
      FROM messages_fts fts
      JOIN messages m ON m.rowid = fts.rowid
      JOIN conversations c ON c.id = m.conversation_id
      WHERE messages_fts MATCH ?
      ORDER BY m.created_at DESC
      LIMIT 50
    `).all(query)
    return results
  })
}
