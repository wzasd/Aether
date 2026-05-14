/**
 * Change route handlers for Renderer API.
 */

import type { ServerResponse } from 'http'
import { randomUUID } from 'crypto'
import { getDb } from '../../core/db'

export async function handleRecordChange(body: unknown, res: ServerResponse): Promise<void> {
  const data = body as Record<string, unknown> | null
  const conversationId = data?.conversation_id as string | undefined
  const path = data?.path as string | undefined
  const status = data?.status as string | undefined

  if (!conversationId || !path || !status) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'conversation_id, path, and status are required' }))
    return
  }

  const db = getDb()
  const id = randomUUID()
  const now = Math.floor(Date.now() / 1000)

  db.prepare(`
    INSERT INTO file_changes (id, conversation_id, agent_id, path, status, additions, deletions, diff_text, tool_call_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    conversationId,
    data.agent_id ?? null,
    path,
    status,
    data.additions ?? 0,
    data.deletions ?? 0,
    data.diff_text ?? null,
    data.tool_call_id ?? null,
    now,
    now
  )

  db.prepare('UPDATE conversations SET change_count = change_count + 1, updated_at = ? WHERE id = ?').run(now, conversationId)

  const row = db.prepare('SELECT * FROM file_changes WHERE id = ?').get(id)
  res.writeHead(201, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, change: row }))
}

export async function handleListChanges(url: URL, res: ServerResponse): Promise<void> {
  const conversationId = url.searchParams.get('conversationId')
  if (!conversationId) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'conversationId is required' }))
    return
  }

  const db = getDb()
  const rows = db.prepare('SELECT * FROM file_changes WHERE conversation_id = ? ORDER BY created_at DESC').all(conversationId)
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, changes: rows }))
}

export async function handleGetChange(url: URL, res: ServerResponse): Promise<void> {
  const changeId = url.searchParams.get('id')
  if (!changeId) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'id is required' }))
    return
  }

  const db = getDb()
  const row = db.prepare('SELECT * FROM file_changes WHERE id = ?').get(changeId)
  if (!row) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'Change not found' }))
    return
  }
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, change: row }))
}
