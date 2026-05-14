/**
 * Action Card IPC handlers.
 *
 * Exposes action-card:create/list/approve/reject/execute to the renderer.
 * All handlers delegate to ActionCardService and ExecutorRegistry.
 */

import { ipcMain } from 'electron'
import { getActionCardService } from '../action-cards/action-card-service'
import { approveAndExecute, rejectCard, retryCard } from '../action-cards/executor-registry'
import { getDb } from '../core/db'
import { isValidActionType } from '../action-cards/action-types'
import type { ActionType } from '../action-cards/action-types'
import { rowToCard } from '../action-cards/db-utils'
import type { ActionCardDbRow } from '../action-cards/db-utils'

export function registerActionCardIpc(): void {
  // List action cards for a workspace, pending first
  ipcMain.handle('action-card:list', (_event, workspaceId: string) => {
    if (!workspaceId || typeof workspaceId !== 'string') {
      throw new Error('workspaceId must be a non-empty string')
    }
    const db = getDb()
    const rows = db.prepare(
      `SELECT * FROM action_cards
       WHERE workspace_id = ?
       ORDER BY
         CASE status
           WHEN 'pending' THEN 0
           WHEN 'executing' THEN 1
           WHEN 'failed' THEN 2
           WHEN 'executed' THEN 3
           WHEN 'rejected' THEN 4
           WHEN 'expired' THEN 5
         END,
         created_at DESC`
    ).all(workspaceId) as ActionCardDbRow[]
    return rows.map(rowToCard)
  })

  // Create a new action card
  ipcMain.handle(
    'action-card:create',
    async (_event, workspaceId: string, type: string, payload: Record<string, unknown>, draftHint?: string) => {
      if (!workspaceId || typeof workspaceId !== 'string') {
        throw new Error('workspaceId must be a non-empty string')
      }
      if (!isValidActionType(type)) {
        throw new Error(`Invalid action type: ${type}`)
      }
      const service = getActionCardService()
      return service.createCard({
        workspaceId,
        type,
        payload,
        title: buildDefaultTitle(type, payload),
        draftHint,
      })
    }
  )

  // Approve and execute an action card
  ipcMain.handle(
    'action-card:approve',
    async (_event, id: string, approvedByUserId: string) => {
      if (!approvedByUserId || typeof approvedByUserId !== 'string') {
        throw new Error('approvedByUserId must be a non-empty string')
      }
      return approveAndExecute(id, approvedByUserId)
    }
  )

  // Reject an action card
  ipcMain.handle(
    'action-card:reject',
    async (_event, id: string, rejectedByUserId: string) => {
      if (!rejectedByUserId || typeof rejectedByUserId !== 'string') {
        throw new Error('rejectedByUserId must be a non-empty string')
      }
      return rejectCard(id, rejectedByUserId)
    }
  )

  // Manual retry for a failed action card
  ipcMain.handle(
    'action-card:execute',
    async (_event, id: string) => {
      return retryCard(id)
    }
  )
}

/**
 * Build a human-readable default title from action type and payload.
 */
function buildDefaultTitle(type: ActionType, payload: Record<string, unknown>): string {
  switch (type) {
    case 'memory:activate':
      return `Activate memory: ${payload.memoryItemId}`
    case 'memory:bulk_activate':
      return `Bulk activate ${Array.isArray(payload.memoryItemIds) ? payload.memoryItemIds.length : '?'} memories`
    case 'provider_config:update':
      return `Update provider config: ${payload.providerId}`
    case 'agent:create':
      return `Create agent: ${payload.name}`
    default:
      return `Action: ${type}`
  }
}