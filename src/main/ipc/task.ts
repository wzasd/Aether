import { ipcMain } from 'electron'
import { getDb } from '../core/db'
import { randomUUID } from 'crypto'

export type TaskStatus = 'Idle' | 'Running' | 'Waiting' | 'Error' | 'Done'
type TaskMode = 'build' | 'plan' | 'review' | 'ask'

const TASK_STATUSES = new Set<TaskStatus>(['Idle', 'Running', 'Waiting', 'Error', 'Done'])
const TASK_MODES = new Set<TaskMode>(['build', 'plan', 'review', 'ask'])
const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  Idle: ['Idle', 'Running'],
  Running: ['Running', 'Waiting', 'Error', 'Done', 'Idle'],
  Waiting: ['Waiting', 'Running', 'Error', 'Idle'],
  Error: ['Error', 'Running', 'Idle'],
  Done: ['Done'],
}

export interface Task {
  id: string
  project_id: string
  title: string
  description: string | null
  status: TaskStatus
  mode: string | null
  created_at: number
  updated_at: number
  completed_at: number | null
  provider_override: string | null
  model_override: string | null
  agent_count: number
  change_count: number
}

export interface TaskEvent {
  id: string
  task_id: string
  agent_id: string | null
  event_type: string
  payload_json: string
  created_at: number
}

export function registerTaskIpc(): void {
  ipcMain.handle('task:create', (_event, projectId: string, data: { title: string; description?: string; mode?: string; providerOverride?: string; modelOverride?: string }) => {
    const db = getDb()
    const id = randomUUID()
    const now = Math.floor(Date.now() / 1000)
    const title = validateTitle(data?.title)
    const mode = validateMode(data?.mode ?? 'build')
    validateProjectId(projectId)
    ensureWorkspaceExists(projectId)

    const createTask = db.transaction(() => {
      db.prepare(
        'INSERT INTO tasks (id, project_id, title, description, status, mode, provider_override, model_override, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(id, projectId, title, data.description ?? null, 'Idle', mode, data.providerOverride ?? null, data.modelOverride ?? null, now, now)

      const eventId = randomUUID()
      db.prepare(
        'INSERT INTO task_events (id, task_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(eventId, id, 'task.created', JSON.stringify({ title, mode }), now)
    })

    createTask()
    return selectRequiredTaskById(id)
  })

  ipcMain.handle('task:list', (_event, projectId?: string) => {
    const db = getDb()
    if (projectId) {
      validateProjectId(projectId)
      return db.prepare(`${TASK_SELECT} WHERE t.project_id = ? ORDER BY t.updated_at DESC`).all(projectId) as Task[]
    }
    return db.prepare(`${TASK_SELECT} ORDER BY t.updated_at DESC`).all() as Task[]
  })

  ipcMain.handle('task:get', (_event, id: string) => {
    validateId(id, 'task id')
    return selectTaskById(id, { required: false })
  })

  ipcMain.handle('task:updateStatus', (_event, id: string, status: string) => {
    const db = getDb()
    validateId(id, 'task id')
    const nextStatus = validateStatus(status)
    const currentTask = ensureTaskExists(id)
    validateStatusTransition(currentTask.status, nextStatus)
    const now = Math.floor(Date.now() / 1000)
    const completedAt = nextStatus === 'Done' ? now : null

    const updateTask = db.transaction(() => {
      db.prepare(
        'UPDATE tasks SET status = ?, updated_at = ?, completed_at = ? WHERE id = ?'
      ).run(nextStatus, now, completedAt, id)

      const eventId = randomUUID()
      db.prepare(
        'INSERT INTO task_events (id, task_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(eventId, id, 'task.status_changed', JSON.stringify({ status: nextStatus }), now)
    })

    updateTask()
    return selectRequiredTaskById(id)
  })

  ipcMain.handle('task:delete', (_event, id: string) => {
    const db = getDb()
    validateId(id, 'task id')
    db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
    return { success: true }
  })

  ipcMain.handle('task:listEvents', (_event, taskId: string, limit?: number) => {
    const db = getDb()
    validateId(taskId, 'task id')
    const safeLimit = validateLimit(limit)
    return db.prepare('SELECT * FROM task_events WHERE task_id = ? ORDER BY created_at DESC LIMIT ?').all(taskId, safeLimit) as TaskEvent[]
  })
}

const TASK_SELECT = `
  SELECT
    t.*,
    COALESCE((
      SELECT COUNT(*)
      FROM task_agents ta
      WHERE ta.task_id = t.id
    ), 0) AS agent_count,
    0 AS change_count
  FROM tasks t
`

function selectTaskById(id: string, options: { required?: boolean } = { required: true }): Task | null {
  const db = getDb()
  const task = db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get(id) as Task | undefined
  if (!task && options.required !== false) {
    throw new Error('Task not found')
  }
  return task ?? null
}

function selectRequiredTaskById(id: string): Task {
  const task = selectTaskById(id)
  if (!task) {
    throw new Error('Task not found')
  }
  return task
}

function ensureWorkspaceExists(projectId: string): void {
  const db = getDb()
  const row = db.prepare('SELECT id FROM workspaces WHERE id = ?').get(projectId)
  if (!row) {
    throw new Error('Project not found')
  }
}

function ensureTaskExists(id: string): Task {
  const db = getDb()
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Task | undefined
  if (!row) {
    throw new Error('Task not found')
  }
  return row
}

function validateId(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid ${label}`)
  }
  return value
}

function validateProjectId(projectId: unknown): string {
  return validateId(projectId, 'project id')
}

function validateTitle(title: unknown): string {
  if (typeof title !== 'string') {
    throw new Error('Task title is required')
  }
  const trimmed = title.trim()
  if (!trimmed) {
    throw new Error('Task title is required')
  }
  return trimmed
}

function validateStatus(status: unknown): TaskStatus {
  if (typeof status !== 'string' || !TASK_STATUSES.has(status as TaskStatus)) {
    throw new Error('Invalid task status')
  }
  return status as TaskStatus
}

function validateMode(mode: unknown): TaskMode {
  if (typeof mode !== 'string' || !TASK_MODES.has(mode as TaskMode)) {
    throw new Error('Invalid task mode')
  }
  return mode as TaskMode
}

function validateStatusTransition(currentStatus: TaskStatus, nextStatus: TaskStatus): void {
  if (!TASK_TRANSITIONS[currentStatus].includes(nextStatus)) {
    throw new Error(`Invalid task status transition: ${currentStatus} -> ${nextStatus}`)
  }
}

function validateLimit(limit: unknown): number {
  if (limit === undefined || limit === null) return 100
  if (typeof limit !== 'number' || !Number.isInteger(limit)) {
    throw new Error('Invalid limit')
  }
  return Math.min(Math.max(limit, 1), 500)
}
