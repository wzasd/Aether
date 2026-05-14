/**
 * Shared DB row types and conversion utilities for Action Cards.
 * Used by both action-card-service.ts and ipc/action-card.ts.
 */

import type { ActionType, ActionCardStatus } from './action-types'
import type { ActionCard } from './action-card-service'

export interface ActionCardDbRow {
  id: string
  workspace_id: string
  conversation_id: string | null
  message_id: string | null
  type: string
  status: string
  title: string
  description: string | null
  payload_json: string
  draft_hint: string | null
  dedupe_key: string
  operation_id: string | null
  created_by_agent_id: string | null
  approved_by_user_id: string | null
  approved_at: number | null
  result_json: string | null
  error: string | null
  expires_at: number | null
  created_at: number
  updated_at: number
}

/**
 * Convert a database row to an ActionCard domain object.
 * Shared between ActionCardService and IPC handlers.
 */
export function rowToCard(row: ActionCardDbRow): ActionCard {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    type: row.type as ActionType,
    status: row.status as ActionCardStatus,
    title: row.title,
    description: row.description,
    payloadJson: row.payload_json,
    draftHint: row.draft_hint,
    dedupeKey: row.dedupe_key,
    operationId: row.operation_id,
    createdByAgentId: row.created_by_agent_id,
    approvedByUserId: row.approved_by_user_id,
    approvedAt: row.approved_at,
    resultJson: row.result_json,
    error: row.error,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
