/**
 * Renderer API Routes — Todo endpoints
 *
 * Migrates 2 IPC handlers from ipc/conversation.ts to HTTP endpoints.
 * ADR-016: Renderer API Server
 */

import type { ServerResponse } from 'http'
import { randomUUID } from 'crypto'
import { getDb } from '../../core/db.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function jsonResponse(res: ServerResponse, statusCode: number, data: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

// ─── Route Handlers ──────────────────────────────────────────────────────────

/** POST /api/todos/sync — Sync todos for a conversation (delete all + insert batch) */
export async function handleSyncTodos(body: unknown, res: ServerResponse): Promise<void> {
  const data = body as {
    conversation_id?: string
    items?: Array<{ content: string; completed: number; order_index: number }>
  } | null

  if (!data?.conversation_id || typeof data.conversation_id !== 'string') {
    return jsonResponse(res, 400, { ok: false, error: 'conversation_id is required' })
  }

  const items = data.items ?? []
  for (const item of items) {
    if (typeof item.content !== 'string' || item.content.length === 0) {
      return jsonResponse(res, 400, { ok: false, error: 'Each item must have a non-empty content string' })
    }
    if (typeof item.completed !== 'number') {
      return jsonResponse(res, 400, { ok: false, error: 'Each item must have a numeric completed value' })
    }
    if (typeof item.order_index !== 'number') {
      return jsonResponse(res, 400, { ok: false, error: 'Each item must have a numeric order_index value' })
    }
  }

  const db = getDb()
  const now = Math.floor(Date.now() / 1000)
  const deleteStmt = db.prepare('DELETE FROM conversation_todos WHERE conversation_id = ?')
  const insertStmt = db.prepare('INSERT INTO conversation_todos (id, conversation_id, content, completed, order_index, created_at) VALUES (?, ?, ?, ?, ?, ?)')

  const transaction = db.transaction(() => {
    deleteStmt.run(data.conversation_id)
    for (const item of items) {
      insertStmt.run(randomUUID(), data.conversation_id, item.content, item.completed, item.order_index, now)
    }
  })

  transaction()
  return jsonResponse(res, 200, { ok: true, success: true })
}

/** GET /api/todos?conversationId= — List todos for a conversation */
export async function handleListTodos(url: URL, res: ServerResponse): Promise<void> {
  const conversationId = url.searchParams.get('conversationId')
  if (!conversationId) {
    return jsonResponse(res, 400, { ok: false, error: 'conversationId is required' })
  }

  const db = getDb()
  const rows = db.prepare('SELECT * FROM conversation_todos WHERE conversation_id = ? ORDER BY order_index ASC').all(conversationId)
  return jsonResponse(res, 200, { ok: true, data: rows })
}
