/**
 * Action Card route handlers for Renderer API.
 */

import type { URL } from 'url'
import type { ServerResponse } from 'http'
import { getDb } from '../../core/db'
import { getActionCardService } from '../../action-cards/action-card-service'
import { approveAndExecute, rejectCard, retryCard } from '../../action-cards/executor-registry'
import { isValidActionType } from '../../action-cards/action-types'
import { rowToCard } from '../../action-cards/db-utils'
import type { ActionCardDbRow } from '../../action-cards/db-utils'

export async function handleListActionCards(url: URL, res: ServerResponse): Promise<void> {
  const workspaceId = url.searchParams.get('workspaceId')
  if (!workspaceId) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'workspaceId query parameter is required' }))
    return
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

  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, cards: rows.map(rowToCard) }))
}

export async function handleCreateActionCard(body: unknown, res: ServerResponse): Promise<void> {
  const data = body as Record<string, unknown> | null
  const workspaceId = data?.workspace_id as string | undefined
  const type = data?.type as string | undefined
  const payload = data?.payload as Record<string, unknown> | undefined

  if (!workspaceId || typeof workspaceId !== 'string') {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'workspace_id is required' }))
    return
  }
  if (!type || !isValidActionType(type)) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: `Invalid action type: ${type}` }))
    return
  }

  const service = getActionCardService()
  const card = service.createCard({
    workspaceId,
    type,
    payload: payload ?? {},
    title: buildActionCardTitle(type, payload ?? {}),
    draftHint: data.draft_hint as string | undefined,
  })

  res.writeHead(201, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, card }))
}

function buildActionCardTitle(type: string, payload: Record<string, unknown>): string {
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

export async function handleApproveActionCard(id: string, body: unknown, res: ServerResponse): Promise<void> {
  const data = body as Record<string, unknown> | null
  const approvedByUserId = data?.approved_by_user_id as string | undefined
  if (!approvedByUserId || typeof approvedByUserId !== 'string') {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'approved_by_user_id is required' }))
    return
  }

  const result = await approveAndExecute(id, approvedByUserId)
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, result }))
}

export async function handleRejectActionCard(id: string, body: unknown, res: ServerResponse): Promise<void> {
  const data = body as Record<string, unknown> | null
  const rejectedByUserId = data?.rejected_by_user_id as string | undefined
  if (!rejectedByUserId || typeof rejectedByUserId !== 'string') {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'rejected_by_user_id is required' }))
    return
  }

  const result = await rejectCard(id, rejectedByUserId)
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, result }))
}

export async function handleExecuteActionCard(id: string, res: ServerResponse): Promise<void> {
  const result = await retryCard(id)
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, result }))
}
