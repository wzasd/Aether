import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { getDb } from '../core/db'

export interface FileChange {
  id: string
  conversation_id: string
  agent_id: string | null
  path: string
  status: string
  additions: number
  deletions: number
  diff_text: string | null
  tool_call_id: string | null
  created_at: number
  updated_at: number
}

export function registerChangeIpc(): void {
  // Record a file change
  ipcMain.handle('change:record', (_event, data: {
    conversation_id: string
    agent_id?: string
    path: string
    status: string
    additions?: number
    deletions?: number
    diff_text?: string
    tool_call_id?: string
  }) => {
    const db = getDb()
    const id = randomUUID()
    const now = Math.floor(Date.now() / 1000)

    db.prepare(`
      INSERT INTO file_changes (id, conversation_id, agent_id, path, status, additions, deletions, diff_text, tool_call_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.conversation_id,
      data.agent_id ?? null,
      data.path,
      data.status,
      data.additions ?? 0,
      data.deletions ?? 0,
      data.diff_text ?? null,
      data.tool_call_id ?? null,
      now,
      now
    )

    // Increment conversation change_count
    db.prepare('UPDATE conversations SET change_count = change_count + 1, updated_at = ? WHERE id = ?').run(now, data.conversation_id)

    return db.prepare('SELECT * FROM file_changes WHERE id = ?').get(id) as FileChange
  })

  // List file changes for a conversation
  ipcMain.handle('change:listForConversation', (_event, conversationId: string) => {
    const db = getDb()
    return db.prepare(
      'SELECT * FROM file_changes WHERE conversation_id = ? ORDER BY created_at DESC'
    ).all(conversationId) as FileChange[]
  })

  // Get a single file change (for diff text)
  ipcMain.handle('change:getById', (_event, changeId: string) => {
    const db = getDb()
    return db.prepare('SELECT * FROM file_changes WHERE id = ?').get(changeId) as FileChange | undefined
  })
}
