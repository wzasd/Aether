import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { getDb } from '../core/db'

export type MemoryCategory = 'core' | 'architecture' | 'conventions' | 'antipatterns' | 'decisions'

export interface MemoryEntry {
  id: string
  workspaceId: string
  category: MemoryCategory
  title: string
  content: string
  tags: string[]
  citedBy: string[]
  createdAt: number
  updatedAt: number
}

interface DbRow {
  id: string
  workspace_id: string
  kind: string
  title: string
  content: string
  tags: string
  cited_by: string
  created_at: number
  updated_at: number
}

function rowToEntry(row: DbRow): MemoryEntry {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    category: row.kind as MemoryCategory,
    title: row.title,
    content: row.content,
    tags: JSON.parse(row.tags || '[]'),
    citedBy: JSON.parse(row.cited_by || '[]'),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function registerMemoryPalaceIpc(): void {
  ipcMain.handle('memory-palace:list', (_event, workspaceId: string, category?: string) => {
    const db = getDb()
    const query = category
      ? db.prepare("SELECT * FROM project_memory_items WHERE workspace_id = ? AND status = 'active' AND kind = ? ORDER BY updated_at DESC")
      : db.prepare("SELECT * FROM project_memory_items WHERE workspace_id = ? AND status = 'active' ORDER BY updated_at DESC")
    const rows = (category ? query.all(workspaceId, category) : query.all(workspaceId)) as DbRow[]
    return rows.map(rowToEntry)
  })

  ipcMain.handle('memory-palace:create', (_event, workspaceId: string, entry: {
    category: MemoryCategory
    title: string
    content: string
    tags?: string[]
  }) => {
    const db = getDb()
    const id = randomUUID()
    const now = Math.floor(Date.now() / 1000)
    const tags = JSON.stringify(entry.tags ?? [])

    db.prepare(`
      INSERT INTO project_memory_items (id, workspace_id, kind, title, content, status, tags, cited_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, '[]', ?, ?)
    `).run(id, workspaceId, entry.category, entry.title, entry.content, tags, now, now)

    const row = db.prepare('SELECT * FROM project_memory_items WHERE id = ?').get(id) as DbRow
    return rowToEntry(row)
  })

  ipcMain.handle('memory-palace:update', (_event, id: string, patch: {
    title?: string
    content?: string
    category?: MemoryCategory
    tags?: string[]
  }) => {
    const db = getDb()
    const now = Math.floor(Date.now() / 1000)
    const fields: string[] = ['updated_at = ?']
    const values: unknown[] = [now]

    if (patch.title !== undefined) { fields.push('title = ?'); values.push(patch.title) }
    if (patch.content !== undefined) { fields.push('content = ?'); values.push(patch.content) }
    if (patch.category !== undefined) { fields.push('kind = ?'); values.push(patch.category) }
    if (patch.tags !== undefined) { fields.push('tags = ?'); values.push(JSON.stringify(patch.tags)) }

    values.push(id)
    db.prepare(`UPDATE project_memory_items SET ${fields.join(', ')} WHERE id = ?`).run(...values)

    const row = db.prepare('SELECT * FROM project_memory_items WHERE id = ?').get(id) as DbRow
    return rowToEntry(row)
  })

  ipcMain.handle('memory-palace:delete', (_event, id: string) => {
    const db = getDb()
    db.prepare('DELETE FROM project_memory_items WHERE id = ?').run(id)
  })
}
