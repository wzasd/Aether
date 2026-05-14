/**
 * Renderer API Routes — Memory Palace endpoints
 *
 * Migrates 6 IPC handlers from ipc/memory-palace.ts to HTTP endpoints.
 * Operates on project_memory_items table (memory entries).
 *
 * ADR-016: Renderer API Server
 */

import type { ServerResponse } from 'http'
import { randomUUID } from 'crypto'
import { getDb } from '../../core/db.js'
import { writeObservabilityEvent } from '../../core/logging'
import { estimateCost } from '../../ai/pricing'

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function jsonResponse(res: ServerResponse, statusCode: number, data: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

function rowToEntry(row: DbRow): MemoryEntry {
  const category = (row.category && row.category !== 'general') ? row.category as MemoryCategory : row.kind as MemoryCategory
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    category,
    title: row.title,
    content: row.content,
    tags: safeParseJson<string[]>(row.tags || '[]', []),
    citedBy: safeParseJson<string[]>(row.cited_by || '[]', []),
    sourceDoc: row.source_doc ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function safeParseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

const VALID_CATEGORIES: Set<string> = new Set(['core', 'architecture', 'conventions', 'antipatterns', 'decisions', 'general'])

// ─── Route Handlers ──────────────────────────────────────────────────────────

/** GET /api/memory-palace?workspaceId=&category= — List memory entries */
export async function handleListPalaces(url: URL, res: ServerResponse): Promise<void> {
  const workspaceId = url.searchParams.get('workspaceId')
  if (!workspaceId) {
    return jsonResponse(res, 400, { ok: false, error: 'workspaceId is required' })
  }
  const category = url.searchParams.get('category') || undefined

  const db = getDb()
  const rows = category
    ? db.prepare("SELECT * FROM project_memory_items WHERE workspace_id = ? AND status = 'active' AND category = ? ORDER BY updated_at DESC").all(workspaceId, category)
    : db.prepare("SELECT * FROM project_memory_items WHERE workspace_id = ? AND status = 'active' ORDER BY updated_at DESC").all(workspaceId)

  const entries = (rows as DbRow[]).map(rowToEntry)
  return jsonResponse(res, 200, { ok: true, data: entries })
}

/** POST /api/memory-palace — Create memory entry */
export async function handleCreatePalace(body: unknown, res: ServerResponse): Promise<void> {
  const data = body as {
    workspace_id?: string
    category?: MemoryCategory
    title?: string
    content?: string
    tags?: string[]
    sourceDoc?: string
  } | null

  if (!data?.workspace_id || !data.title || !data.content || !data.category) {
    return jsonResponse(res, 400, { ok: false, error: 'workspace_id, category, title, and content are required' })
  }
  if (!VALID_CATEGORIES.has(data.category)) {
    return jsonResponse(res, 400, { ok: false, error: `Invalid category: ${data.category}` })
  }

  const db = getDb()
  const id = randomUUID()
  const now = Math.floor(Date.now() / 1000)
  const tags = JSON.stringify(data.tags ?? [])
  const sourceDoc = data.sourceDoc ?? null

  db.prepare(`
    INSERT INTO project_memory_items (id, workspace_id, kind, category, title, content, status, tags, cited_by, source_doc, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?, '[]', ?, ?, ?)
  `).run(id, data.workspace_id, data.category, data.category, data.title, data.content, tags, sourceDoc, now, now)

  const row = db.prepare('SELECT * FROM project_memory_items WHERE id = ?').get(id) as DbRow
  writeObservabilityEvent('renderer_api:palace_created', { id, workspace_id: data.workspace_id })
  return jsonResponse(res, 201, { ok: true, data: rowToEntry(row) })
}

/** PATCH /api/memory-palace/:id — Update memory entry */
export async function handleUpdatePalace(id: string, body: unknown, res: ServerResponse): Promise<void> {
  const data = body as {
    title?: string
    content?: string
    category?: MemoryCategory
    tags?: string[]
    sourceDoc?: string
  } | null

  if (!data) {
    return jsonResponse(res, 400, { ok: false, error: 'Request body is required' })
  }
  if (data.category && !VALID_CATEGORIES.has(data.category)) {
    return jsonResponse(res, 400, { ok: false, error: `Invalid category: ${data.category}` })
  }

  const db = getDb()
  const now = Math.floor(Date.now() / 1000)
  const fields: string[] = ['updated_at = ?']
  const values: unknown[] = [now]

  if (data.title !== undefined) { fields.push('title = ?'); values.push(data.title) }
  if (data.content !== undefined) { fields.push('content = ?'); values.push(data.content) }
  if (data.category !== undefined) {
    fields.push('kind = ?', 'category = ?')
    values.push(data.category, data.category)
  }
  if (data.tags !== undefined) { fields.push('tags = ?'); values.push(JSON.stringify(data.tags)) }
  if (data.sourceDoc !== undefined) { fields.push('source_doc = ?'); values.push(data.sourceDoc) }

  values.push(id)
  db.prepare(`UPDATE project_memory_items SET ${fields.join(', ')} WHERE id = ?`).run(...values)

  const row = db.prepare('SELECT * FROM project_memory_items WHERE id = ?').get(id) as DbRow | undefined
  if (!row) {
    return jsonResponse(res, 404, { ok: false, error: 'Memory entry not found' })
  }

  return jsonResponse(res, 200, { ok: true, data: rowToEntry(row) })
}

/** DELETE /api/memory-palace/:id — Delete memory entry */
export async function handleDeletePalace(id: string, res: ServerResponse): Promise<void> {
  const db = getDb()
  db.prepare('DELETE FROM project_memory_items WHERE id = ?').run(id)
  writeObservabilityEvent('renderer_api:palace_deleted', { id })
  return jsonResponse(res, 200, { ok: true, success: true })
}

/** GET /api/memory-palace/export?workspaceId= — Export memory entries */
export async function handleExportPalace(url: URL, res: ServerResponse): Promise<void> {
  const workspaceId = url.searchParams.get('workspaceId')
  if (!workspaceId) {
    return jsonResponse(res, 400, { ok: false, error: 'workspaceId is required' })
  }

  const db = getDb()
  const rows = db.prepare(`
    SELECT id, category, title, content, tags, source_doc, created_at, updated_at
    FROM project_memory_items
    WHERE workspace_id = ? AND status = 'active'
    ORDER BY category, updated_at DESC
  `).all(workspaceId) as Array<{
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
      tags: safeParseJson<string[]>(row.tags || '[]', []),
      sourceDoc: row.source_doc ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    })
  )

  const content = lines.join('\n') + '\n'
  return jsonResponse(res, 200, { ok: true, content, count: lines.length })
}

/** POST /api/memory-palace/import — Import memory entries */
export async function handleImportPalace(body: unknown, res: ServerResponse): Promise<void> {
  const data = body as {
    workspace_id?: string
    content?: string
  } | null

  if (!data?.workspace_id || !data.content) {
    return jsonResponse(res, 400, { ok: false, error: 'workspace_id and content are required' })
  }

  const workspaceId = data.workspace_id
  const MAX_IMPORT_LINES = 10_000
  const lines = data.content.split('\n').filter((line) => line.trim().length > 0)
  if (lines.length > MAX_IMPORT_LINES) {
    return jsonResponse(res, 400, { ok: false, error: `Too many entries (max ${MAX_IMPORT_LINES})` })
  }

  const db = getDb()
  const now = Math.floor(Date.now() / 1000)
  let imported = 0
  let skipped = 0

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

  return jsonResponse(res, 200, { ok: true, imported, skipped })
}
