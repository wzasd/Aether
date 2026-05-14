/**
 * ActionCardService — the service interface that distiller and other
 * main-process modules depend on for creating action cards.
 *
 * C6: Distiller MUST depend on ActionCardService interface, not IPC/UI layer.
 * This service is the sole entry point for programmatic card creation.
 * IPC handlers delegate to this service; distiller injects this interface.
 */

import { randomUUID } from 'crypto'
import { getDb } from '../core/db'
import type { ActionType, ActionCardStatus } from './action-types'
import { validateActionPayload, generateDedupeKey, getDefaultExpiryAt } from './action-types'
import { rowToCard } from './db-utils'
import type { ActionCardDbRow } from './db-utils'

// ─── Data Types ─────────────────────────────────────────────────────────────

export interface ActionCard {
  readonly id: string
  readonly workspaceId: string
  readonly conversationId: string | null
  readonly messageId: string | null
  readonly type: ActionType
  readonly status: ActionCardStatus
  readonly title: string
  readonly description: string | null
  readonly payloadJson: string
  readonly draftHint: string | null
  readonly dedupeKey: string
  readonly operationId: string | null
  readonly createdByAgentId: string | null
  readonly approvedByUserId: string | null
  readonly approvedAt: number | null
  readonly resultJson: string | null
  readonly error: string | null
  readonly expiresAt: number | null
  readonly createdAt: number
  readonly updatedAt: number
}

// ─── Create Input ───────────────────────────────────────────────────────────

export interface CreateActionCardInput {
  readonly workspaceId: string
  readonly conversationId?: string
  readonly messageId?: string
  readonly type: ActionType
  readonly payload: Record<string, unknown>
  readonly title: string
  readonly description?: string
  readonly draftHint?: string
  readonly dedupeKey?: string
  readonly createdByAgentId?: string
  readonly expiresAt?: number
}

// ─── Memory Activation Helper Input ─────────────────────────────────────────

export interface CreateMemoryActivationCardInput {
  readonly workspaceId: string
  readonly conversationId: string
  readonly messageId?: string
  readonly memoryItemId: string
  readonly title: string
  readonly draftHint?: string
  readonly createdByAgentId?: string
}

// ─── Service Interface ──────────────────────────────────────────────────────

export interface ActionCardService {
  /**
   * Generic card creation. Validates payload, generates dedupe_key,
   * checks for duplicates, and inserts into DB.
   */
  createCard(input: CreateActionCardInput): Promise<ActionCard>

  /**
   * Convenience helper for memory:activate cards (PR-5).
   * Auto-generates dedupeKey = memoryItemId and type = 'memory:activate'.
   */
  createMemoryActivationCard(input: CreateMemoryActivationCardInput): Promise<ActionCard>
}

// ─── Implementation ─────────────────────────────────────────────────────────

export class ActionCardServiceImpl implements ActionCardService {
  async createCard(input: CreateActionCardInput): Promise<ActionCard> {
    // Validate payload against type-specific schema
    const validation = validateActionPayload(input.type, input.payload)
    if (!validation.valid) {
      throw new Error(`Invalid payload for ${input.type}: ${validation.reason}`)
    }

    const db = getDb()
    const id = randomUUID()
    const now = Math.floor(Date.now() / 1000)
    const dedupeKey = input.dedupeKey ?? generateDedupeKey(input.type, input.payload)
    const expiresAt = input.expiresAt ?? getDefaultExpiryAt(input.type)
    const payloadJson = JSON.stringify(input.payload)

    // Check for duplicate active card (C5: explicit dedupe_key)
    const existing = db.prepare(
      `SELECT id, status FROM action_cards
       WHERE workspace_id = ? AND type = ? AND dedupe_key = ? AND status IN ('pending', 'executing')`
    ).get(input.workspaceId, input.type, dedupeKey) as { id: string; status: string } | undefined

    if (existing) {
      // Return existing card instead of creating duplicate
      const row = db.prepare('SELECT * FROM action_cards WHERE id = ?').get(existing.id) as ActionCardDbRow
      return rowToCard(row)
    }

    db.prepare(`
      INSERT INTO action_cards (
        id, workspace_id, conversation_id, message_id, type, status,
        title, description, payload_json, draft_hint, dedupe_key,
        operation_id, created_by_agent_id, expires_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
    `).run(
      id,
      input.workspaceId,
      input.conversationId ?? null,
      input.messageId ?? null,
      input.type,
      input.title,
      input.description ?? null,
      payloadJson,
      input.draftHint ?? null,
      dedupeKey,
      input.createdByAgentId ?? null,
      expiresAt ?? null,
      now,
      now,
    )

    const row = db.prepare('SELECT * FROM action_cards WHERE id = ?').get(id) as ActionCardDbRow
    return rowToCard(row)
  }

  async createMemoryActivationCard(input: CreateMemoryActivationCardInput): Promise<ActionCard> {
    return this.createCard({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      messageId: input.messageId,
      type: 'memory:activate',
      payload: { type: 'memory:activate', memoryItemId: input.memoryItemId },
      title: input.title,
      draftHint: input.draftHint,
      dedupeKey: input.memoryItemId, // memoryItemId is the natural dedupe key
      createdByAgentId: input.createdByAgentId,
      // memory:activate does not expire (human should always see pending drafts)
    })
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let serviceInstance: ActionCardServiceImpl | null = null

export function getActionCardService(): ActionCardServiceImpl {
  if (!serviceInstance) {
    serviceInstance = new ActionCardServiceImpl()
  }
  return serviceInstance
}