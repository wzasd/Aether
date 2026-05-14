/**
 * Conversation route handlers for Renderer API.
 *
 * Extracted from renderer-api.ts to keep the main file under 800 lines.
 */

import type { URL } from 'url'
import type { ServerResponse } from 'http'
import { randomUUID } from 'crypto'
import { getDb } from '../../core/db'
import type { Conversation, Message } from '../../ipc/conversation'
import { buildFtsQuery } from '../../utils/fts'
import { buildMarkdownExport, buildJsonExport, sanitizeFilename } from '../../utils/export'
import type { ExportOptions } from '../../utils/export'

export async function handleListConversations(url: URL, res: ServerResponse): Promise<void> {
  const workspaceId = url.searchParams.get('workspaceId')
  const status = url.searchParams.get('status')
  const db = getDb()

  let query = 'SELECT * FROM conversations WHERE is_draft = 0 AND deleted_at IS NULL'
  const conditions: string[] = []
  const params: unknown[] = []

  if (workspaceId) {
    conditions.push('workspace_id = ?')
    params.push(workspaceId)
  }
  if (status) {
    conditions.push('status = ?')
    params.push(status)
  }

  if (conditions.length > 0) {
    query += ' AND ' + conditions.join(' AND ')
  }
  query += ' ORDER BY updated_at DESC LIMIT 100'

  const rows = db.prepare(query).all(...params)
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, conversations: rows }))
}

export async function handleGetConversation(id: string, res: ServerResponse): Promise<void> {
  const db = getDb()
  const conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id)
  if (!conversation) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'Conversation not found' }))
    return
  }

  const messages = db.prepare(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
  ).all(id)

  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, conversation, messages }))
}

export async function handleCreateConversation(body: unknown, res: ServerResponse): Promise<void> {
  const data = body as Record<string, unknown> | null
  if (!data) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'Request body is required' }))
    return
  }

  const db = getDb()
  const id = randomUUID()
  const now = Math.floor(Date.now() / 1000)

  db.prepare(`
    INSERT INTO conversations (id, workspace_id, title, model, provider, agent_profile_id, team_id, task_id, is_draft, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.workspace_id ?? null,
    data.title ?? 'New Chat',
    data.model ?? null,
    data.provider ?? null,
    data.agent_profile_id ?? null,
    data.team_id ?? null,
    data.task_id ?? null,
    data.is_draft ?? 0,
    now,
    now
  )

  const row = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id)
  res.writeHead(201, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, conversation: row }))
}

export async function handleUpdateConversation(id: string, body: unknown, res: ServerResponse): Promise<void> {
  const data = body as Record<string, unknown> | null
  if (!data) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'Request body is required' }))
    return
  }

  const db = getDb()
  const conversation = db.prepare('SELECT id FROM conversations WHERE id = ?').get(id)
  if (!conversation) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'Conversation not found' }))
    return
  }

  const allowedFields = ['title', 'title_source', 'model', 'provider', 'agent_count', 'change_count', 'agent_profile_id', 'team_id', 'task_id', 'is_draft']
  const updates: string[] = []
  const values: unknown[] = []

  for (const [key, value] of Object.entries(data)) {
    if (allowedFields.includes(key)) {
      updates.push(`${key} = ?`)
      values.push(value)
    }
  }

  if (updates.length === 0) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'No valid fields to update' }))
    return
  }

  updates.push('updated_at = unixepoch()')
  values.push(id)

  db.prepare(`UPDATE conversations SET ${updates.join(', ')} WHERE id = ?`).run(...values)

  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, id }))
}

export async function handleDeleteConversation(id: string, res: ServerResponse): Promise<void> {
  const db = getDb()
  const now = Math.floor(Date.now() / 1000)
  const result = db.prepare(
    'UPDATE conversations SET deleted_at = ?, updated_at = ? WHERE id = ?'
  ).run(now, now, id)

  if (result.changes === 0) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'Conversation not found' }))
    return
  }

  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, id }))
}

export async function handlePromoteDraftConversation(id: string, res: ServerResponse): Promise<void> {
  const db = getDb()
  const now = Math.floor(Date.now() / 1000)
  db.prepare('UPDATE conversations SET is_draft = 0, updated_at = ? WHERE id = ?').run(now, id)
  const row = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id)
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, conversation: row }))
}

export async function handleUpdateConversationStatus(id: string, body: unknown, res: ServerResponse): Promise<void> {
  const data = body as Record<string, unknown> | null
  const newStatus = data?.status as string | undefined
  if (!newStatus) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'status is required' }))
    return
  }

  const VALID_TRANSITIONS: Record<string, string[]> = {
    Idle:    ['Running', 'Idle'],
    Running: ['Running', 'Waiting', 'Done', 'Error', 'Idle'],
    Waiting: ['Running', 'Error', 'Idle'],
    Error:   ['Running', 'Idle'],
    Done:    ['Running', 'Done'],
  }

  const db = getDb()
  const conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as { status: string } | undefined
  if (!conversation) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'Conversation not found' }))
    return
  }

  const allowed = VALID_TRANSITIONS[conversation.status]
  if (!allowed || !allowed.includes(newStatus)) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: `Invalid status transition: ${conversation.status} -> ${newStatus}` }))
    return
  }

  const now = Math.floor(Date.now() / 1000)
  db.prepare('UPDATE conversations SET status = ?, updated_at = ? WHERE id = ?').run(newStatus, now, id)
  const row = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id)
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, conversation: row }))
}

export async function handleSearchConversations(url: URL, res: ServerResponse): Promise<void> {
  const query = url.searchParams.get('q')
  if (!query || typeof query !== 'string') {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'Query parameter q is required' }))
    return
  }

  const ftsQuery = buildFtsQuery(query)
  if (!ftsQuery) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, results: [] }))
    return
  }

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

  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, results }))
}

export async function handleIncrementAgentCount(id: string, res: ServerResponse): Promise<void> {
  const db = getDb()
  const now = Math.floor(Date.now() / 1000)
  db.prepare('UPDATE conversations SET agent_count = agent_count + 1, updated_at = ? WHERE id = ?').run(now, id)
  const row = db.prepare('SELECT agent_count FROM conversations WHERE id = ?').get(id) as { agent_count: number } | undefined
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, agentCount: row?.agent_count ?? 0 }))
}

export async function handleAutoTitle(id: string, body: unknown, res: ServerResponse): Promise<void> {
  const data = body as Record<string, unknown> | null
  const title = data?.title as string | undefined
  if (!title) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'title is required' }))
    return
  }
  const db = getDb()
  db.prepare("UPDATE conversations SET title = ?, updated_at = ? WHERE id = ? AND title_source = 'auto'").run(title, Math.floor(Date.now() / 1000), id)
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true }))
}

export async function handleSetTitle(id: string, body: unknown, res: ServerResponse): Promise<void> {
  const data = body as Record<string, unknown> | null
  const title = data?.title as string | undefined
  if (!title) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'title is required' }))
    return
  }
  const db = getDb()
  db.prepare("UPDATE conversations SET title = ?, title_source = 'manual', updated_at = ? WHERE id = ?").run(title, Math.floor(Date.now() / 1000), id)
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true }))
}


export async function handleExportConversation(body: unknown, res: ServerResponse): Promise<void> {
  const data = body as {
    conversationId?: string
    format?: 'markdown' | 'json'
    options?: ExportOptions
  } | null

  if (!data?.conversationId || typeof data.conversationId !== 'string') {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'conversationId is required' }))
    return
  }

  const format = data.format === 'json' ? 'json' : 'markdown'

  const db = getDb()
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(data.conversationId) as Conversation | undefined

  if (!conv) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: `Conversation not found: ${data.conversationId}` }))
    return
  }

  const messages = db.prepare(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
  ).all(data.conversationId) as Message[]

  const usageRecords = db.prepare(
    'SELECT * FROM conversation_usage WHERE conversation_id = ? ORDER BY created_at ASC'
  ).all(data.conversationId) as Array<{
    input_tokens: number
    output_tokens: number
    cache_read_tokens: number
    cache_creation_tokens: number
    model: string
  }>

  const isMarkdown = format === 'markdown'
  const content = isMarkdown
    ? buildMarkdownExport(conv, messages, usageRecords, data.options)
    : buildJsonExport(conv, messages, usageRecords, data.options)

  const ext = isMarkdown ? 'md' : 'json'
  const filename = `${sanitizeFilename(conv.title || 'untitled')}.${ext}`

  res.writeHead(200, {
    'Content-Type': 'application/json',
    'X-Export-Filename': filename
  })
  res.end(JSON.stringify({ ok: true, content, filename }))
}
