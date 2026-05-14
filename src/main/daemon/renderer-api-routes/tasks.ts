/**
 * Task route handlers for Renderer API.
 */

import type { URL } from 'url'
import type { ServerResponse } from 'http'
import { randomUUID } from 'crypto'
import { getDb } from '../../core/db'

function clampInt(value: string | null, fallback: number, min: number, max: number): number {
  if (value === null) return fallback
  const parsed = parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

export async function handleListTasks(url: URL, res: ServerResponse): Promise<void> {
  const projectId = url.searchParams.get('projectId')
  const conversationId = url.searchParams.get('conversationId')
  const status = url.searchParams.get('status')
  const limit = clampInt(url.searchParams.get('limit'), 100, 1, 500)
  const db = getDb()

  let query = 'SELECT * FROM agent_task_queue'
  const conditions: string[] = []
  const params: unknown[] = []

  if (projectId) {
    conditions.push('conversation_id IN (SELECT id FROM conversations WHERE workspace_id = ?)')
    params.push(projectId)
  }
  if (conversationId) {
    conditions.push('conversation_id = ?')
    params.push(conversationId)
  }
  if (status) {
    conditions.push('status = ?')
    params.push(status)
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ')
  }
  query += ' ORDER BY created_at DESC LIMIT ?'
  params.push(limit)

  const rows = db.prepare(query).all(...params)
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, tasks: rows }))
}

export async function handleCreateTask(body: unknown, res: ServerResponse): Promise<void> {
  const data = body as Record<string, unknown> | null
  const projectId = data?.project_id as string | undefined
  const title = data?.title as string | undefined

  if (!projectId || typeof projectId !== 'string') {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'project_id is required' }))
    return
  }
  if (!title || typeof title !== 'string' || !title.trim()) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'title is required' }))
    return
  }

  const mode = (data?.mode as string) ?? 'build'
  const validModes = ['build', 'plan', 'review', 'ask', 'open_floor', 'orchestrated']
  if (!validModes.includes(mode)) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'Invalid task mode' }))
    return
  }

  const db = getDb()
  const workspace = db.prepare('SELECT id FROM workspaces WHERE id = ?').get(projectId)
  if (!workspace) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'Project not found' }))
    return
  }

  const id = randomUUID()
  const now = Math.floor(Date.now() / 1000)

  const createTask = db.transaction(() => {
    db.prepare(
      'INSERT INTO tasks (id, project_id, title, description, status, mode, provider_override, model_override, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, projectId, title.trim(), data.description ?? null, 'Idle', mode, data.providerOverride ?? null, data.modelOverride ?? null, now, now)

    const eventId = randomUUID()
    db.prepare(
      'INSERT INTO task_events (id, task_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(eventId, id, 'task.created', JSON.stringify({ title: title.trim(), mode }), now)
  })

  createTask()

  const TASK_SELECT = `
    SELECT t.*,
      COALESCE((SELECT COUNT(*) FROM task_agents ta WHERE ta.task_id = t.id), 0) AS agent_count,
      0 AS change_count
    FROM tasks t
  `
  const row = db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get(id)
  res.writeHead(201, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, task: row }))
}

export async function handleGetTask(id: string, res: ServerResponse): Promise<void> {
  const db = getDb()
  const TASK_SELECT = `
    SELECT t.*,
      COALESCE((SELECT COUNT(*) FROM task_agents ta WHERE ta.task_id = t.id), 0) AS agent_count,
      0 AS change_count
    FROM tasks t
  `
  const row = db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get(id)
  if (!row) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'Task not found' }))
    return
  }
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, task: row }))
}

export async function handleUpdateTaskStatus(id: string, body: unknown, res: ServerResponse): Promise<void> {
  const data = body as Record<string, unknown> | null
  const status = data?.status as string | undefined
  if (!status || typeof status !== 'string') {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'status is required' }))
    return
  }

  const TASK_STATUSES = new Set(['Idle', 'Running', 'Waiting', 'Error', 'Done'])
  if (!TASK_STATUSES.has(status as 'Idle' | 'Running' | 'Waiting' | 'Error' | 'Done')) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'Invalid task status' }))
    return
  }

  const TASK_TRANSITIONS: Record<string, string[]> = {
    Idle: ['Idle', 'Running'],
    Running: ['Running', 'Waiting', 'Error', 'Done', 'Idle'],
    Waiting: ['Waiting', 'Running', 'Error', 'Idle'],
    Error: ['Error', 'Running', 'Idle'],
    Done: ['Done'],
  }

  const db = getDb()
  const currentTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as { status: string } | undefined
  if (!currentTask) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'Task not found' }))
    return
  }

  if (!TASK_TRANSITIONS[currentTask.status].includes(status)) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: `Invalid status transition: ${currentTask.status} -> ${status}` }))
    return
  }

  const now = Math.floor(Date.now() / 1000)
  const completedAt = status === 'Done' ? now : null

  const updateTask = db.transaction(() => {
    db.prepare('UPDATE tasks SET status = ?, updated_at = ?, completed_at = ? WHERE id = ?').run(status, now, completedAt, id)

    const eventId = randomUUID()
    db.prepare(
      'INSERT INTO task_events (id, task_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(eventId, id, 'task.status_changed', JSON.stringify({ status }), now)
  })

  updateTask()

  const TASK_SELECT = `
    SELECT t.*,
      COALESCE((SELECT COUNT(*) FROM task_agents ta WHERE ta.task_id = t.id), 0) AS agent_count,
      0 AS change_count
    FROM tasks t
  `
  const row = db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get(id)
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, task: row }))
}

export async function handleDeleteTask(id: string, res: ServerResponse): Promise<void> {
  const db = getDb()
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true }))
}

export async function handleListTaskEvents(url: URL, id: string, res: ServerResponse): Promise<void> {
  const limit = clampInt(url.searchParams.get('limit'), 100, 1, 500)
  const db = getDb()
  const rows = db.prepare('SELECT * FROM task_events WHERE task_id = ? ORDER BY created_at DESC LIMIT ?').all(id, limit)
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, events: rows }))
}
