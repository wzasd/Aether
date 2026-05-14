/**
 * Workspace route handlers for Renderer API.
 */

import type { ServerResponse } from 'http'
import { randomUUID } from 'crypto'
import { getDb } from '../../core/db'

export async function handleListWorkspaces(res: ServerResponse): Promise<void> {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM workspaces ORDER BY updated_at DESC').all()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, workspaces: rows }))
}

export async function handleGetWorkspace(id: string, res: ServerResponse): Promise<void> {
  const db = getDb()
  const row = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id)
  if (!row) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'Workspace not found' }))
    return
  }
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, workspace: row }))
}

export async function handleCreateWorkspace(body: unknown, res: ServerResponse): Promise<void> {
  const data = body as Record<string, unknown> | null
  if (!data?.name || typeof data.name !== 'string') {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'name is required' }))
    return
  }

  const db = getDb()
  const id = randomUUID()
  const now = Math.floor(Date.now() / 1000)
  db.prepare(
    'INSERT INTO workspaces (id, name, description, icon, repo_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, data.name, data.description ?? null, data.icon ?? null, data.repo_path ?? null, now, now)

  const row = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id)
  res.writeHead(201, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, workspace: row }))
}

export async function handleUpdateWorkspace(id: string, body: unknown, res: ServerResponse): Promise<void> {
  const data = body as Record<string, unknown> | null
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'Invalid payload: data must be a plain object' }))
    return
  }

  const allowedFields = new Set(['name', 'description', 'icon', 'repo_path'])
  const unknownKeys = Object.keys(data).filter((k) => !allowedFields.has(k))
  if (unknownKeys.length > 0) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: `Invalid fields: ${unknownKeys.join(', ')}` }))
    return
  }

  const validEntries = Object.entries(data).filter(([k]) => allowedFields.has(k))
  if (validEntries.length === 0) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'No valid fields to update' }))
    return
  }

  const db = getDb()
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

  db.prepare(`UPDATE workspaces SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  const row = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id)
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, workspace: row }))
}

export async function handleDeleteWorkspace(id: string, res: ServerResponse): Promise<void> {
  const db = getDb()
  db.prepare('DELETE FROM workspaces WHERE id = ?').run(id)
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true }))
}
