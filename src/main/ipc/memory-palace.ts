import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
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
  sourceDoc?: string
  createdAt: number
  updatedAt: number
}

interface DbRow {
  id: string
  workspace_id: string
  kind: string
  category: string | null
  title: string
  content: string
  tags: string
  cited_by: string
  source_doc: string | null
  created_at: number
  updated_at: number
}

function rowToEntry(row: DbRow): MemoryEntry {
  // Prefer category column (Phase 1+); fall back to kind for pre-migration rows
  const category = (row.category && row.category !== 'general') ? row.category as MemoryCategory : row.kind as MemoryCategory
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    category,
    title: row.title,
    content: row.content,
    tags: JSON.parse(row.tags || '[]'),
    citedBy: JSON.parse(row.cited_by || '[]'),
    sourceDoc: row.source_doc ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function registerMemoryPalaceIpc(): void {
  ipcMain.handle('memory-palace:list', (_event, workspaceId: string, category?: string) => {
    const db = getDb()
    const query = category
      ? db.prepare("SELECT * FROM project_memory_items WHERE workspace_id = ? AND status = 'active' AND category = ? ORDER BY updated_at DESC")
      : db.prepare("SELECT * FROM project_memory_items WHERE workspace_id = ? AND status = 'active' ORDER BY updated_at DESC")
    const rows = (category ? query.all(workspaceId, category) : query.all(workspaceId)) as DbRow[]
    return rows.map(rowToEntry)
  })

  ipcMain.handle('memory-palace:create', (_event, workspaceId: string, entry: {
    category: MemoryCategory
    title: string
    content: string
    tags?: string[]
    sourceDoc?: string
  }) => {
    const db = getDb()
    const id = randomUUID()
    const now = Math.floor(Date.now() / 1000)
    const tags = JSON.stringify(entry.tags ?? [])
    const sourceDoc = entry.sourceDoc ?? null

    db.prepare(`
      INSERT INTO project_memory_items (id, workspace_id, kind, category, title, content, status, tags, cited_by, source_doc, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, '[]', ?, ?, ?)
    `).run(id, workspaceId, entry.category, entry.category, entry.title, entry.content, tags, sourceDoc, now, now)

    const row = db.prepare('SELECT * FROM project_memory_items WHERE id = ?').get(id) as DbRow
    return rowToEntry(row)
  })

  ipcMain.handle('memory-palace:update', (_event, id: string, patch: {
    title?: string
    content?: string
    category?: MemoryCategory
    tags?: string[]
    sourceDoc?: string
  }) => {
    const db = getDb()
    const now = Math.floor(Date.now() / 1000)
    const fields: string[] = ['updated_at = ?']
    const values: unknown[] = [now]

    if (patch.title !== undefined) { fields.push('title = ?'); values.push(patch.title) }
    if (patch.content !== undefined) { fields.push('content = ?'); values.push(patch.content) }
    if (patch.category !== undefined) {
      // Keep kind and category in sync for backward compatibility
      fields.push('kind = ?', 'category = ?')
      values.push(patch.category, patch.category)
    }
    if (patch.tags !== undefined) { fields.push('tags = ?'); values.push(JSON.stringify(patch.tags)) }
    if (patch.sourceDoc !== undefined) { fields.push('source_doc = ?'); values.push(patch.sourceDoc) }

    values.push(id)
    db.prepare(`UPDATE project_memory_items SET ${fields.join(', ')} WHERE id = ?`).run(...values)

    const row = db.prepare('SELECT * FROM project_memory_items WHERE id = ?').get(id) as DbRow
    return rowToEntry(row)
  })

  ipcMain.handle('memory-palace:delete', (_event, id: string) => {
    const db = getDb()
    db.prepare('DELETE FROM project_memory_items WHERE id = ?').run(id)
  })

  // ─── Export / Import IPC ──────────────────────────────────────────────────
  // Export active memories for a workspace to a JSONL file.
  // Import memories from a JSONL file, upserting by id (skips conflicts).

  ipcMain.handle('memory-palace:export', (_event, workspaceId: string, filePath: string) => {
    const db = getDb()
    const rows = db
      .prepare(
        `SELECT id, category, title, content, tags, source_doc, created_at, updated_at
         FROM project_memory_items
         WHERE workspace_id = ? AND status = 'active'
         ORDER BY category, updated_at DESC`
      )
      .all(workspaceId) as Array<{
      id: string
      category: string | null
      title: string
      content: string
      tags: string
      source_doc: string | null
      created_at: number
      updated_at: number
    }>

    const lines = rows.map((row) =>
      JSON.stringify({
        id: row.id,
        category: (row.category && row.category !== 'general') ? row.category : undefined,
        title: row.title,
        content: row.content,
        tags: JSON.parse(row.tags || '[]'),
        sourceDoc: row.source_doc ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      })
    )

    // Ensure parent directory exists
    const dir = join(filePath, '..')
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8')

    return { path: filePath, count: lines.length }
  })

  ipcMain.handle('memory-palace:import', (_event, workspaceId: string, filePath: string) => {
    if (!existsSync(filePath)) {
      return { imported: 0, skipped: 0, error: 'File not found' }
    }

    const content = readFileSync(filePath, 'utf-8')
    const lines = content.split('\n').filter((line) => line.trim().length > 0)

    const db = getDb()
    const now = Math.floor(Date.now() / 1000)
    let imported = 0
    let skipped = 0

    // Check existing IDs to detect conflicts
    const existingIds = new Set(
      (db.prepare('SELECT id FROM project_memory_items WHERE workspace_id = ?').all(workspaceId) as Array<{ id: string }>).map((r) => r.id)
    )

    const insertStmt = db.prepare(`
      INSERT INTO project_memory_items (id, workspace_id, kind, category, title, content, status, tags, cited_by, source_doc, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, '[]', ?, ?, ?)
    `)

    for (const line of lines) {
      let entry: Record<string, unknown>
      try {
        entry = JSON.parse(line)
      } catch {
        skipped++
        continue
      }

      const id = String(entry.id ?? randomUUID())
      if (existingIds.has(id)) {
        skipped++
        continue
      }

      const category = String(entry.category ?? 'general')
      const title = String(entry.title ?? 'Untitled')
      const content = String(entry.content ?? '')
      const tags = JSON.stringify(Array.isArray(entry.tags) ? entry.tags : [])
      const sourceDoc = entry.sourceDoc ? String(entry.sourceDoc) : null
      const createdAt = Number(entry.createdAt) || now
      const updatedAt = Number(entry.updatedAt) || now

      try {
        insertStmt.run(id, workspaceId, category, category, title, content, tags, sourceDoc, createdAt, updatedAt)
        existingIds.add(id)
        imported++
      } catch {
        skipped++
      }
    }

    return { imported, skipped }
  })
}
