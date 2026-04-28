import { ipcMain } from 'electron'
import { getDb } from '../core/db'
import { randomUUID } from 'crypto'

export interface Workspace {
  id: string
  name: string
  description: string | null
  icon: string | null
  repo_path: string | null
  created_at: number
  updated_at: number
}

export function registerWorkspaceIpc(): void {
  ipcMain.handle('workspace:list', () => {
    const db = getDb()
    return db.prepare('SELECT * FROM workspaces ORDER BY updated_at DESC').all() as Workspace[]
  })

  ipcMain.handle('workspace:get', (_event, id: string) => {
    const db = getDb()
    return db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as Workspace | undefined
  })

  ipcMain.handle('workspace:create', (_event, data: { name: string; description?: string; icon?: string; repo_path?: string }) => {
    const db = getDb()
    const id = randomUUID()
    const now = Math.floor(Date.now() / 1000)
    db.prepare(
      'INSERT INTO workspaces (id, name, description, icon, repo_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, data.name, data.description ?? null, data.icon ?? null, data.repo_path ?? null, now, now)
    return db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as Workspace
  })

  ipcMain.handle('workspace:update', (_event, id: string, data: Record<string, unknown>) => {
    const db = getDb()

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Invalid payload: data must be a plain object')
    }

    const allowedFields = new Set(['name', 'description', 'icon', 'repo_path'])
    const unknownKeys = Object.keys(data).filter((k) => !allowedFields.has(k))
    if (unknownKeys.length > 0) {
      throw new Error(`Invalid fields: ${unknownKeys.join(', ')}`)
    }

    const validEntries = Object.entries(data).filter(([k]) => allowedFields.has(k))
    if (validEntries.length === 0) {
      throw new Error('No valid fields to update')
    }

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
    return db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as Workspace
  })

  ipcMain.handle('workspace:delete', (_event, id: string) => {
    const db = getDb()
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(id)
    return { success: true }
  })
}
