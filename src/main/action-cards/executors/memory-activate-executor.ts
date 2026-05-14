/**
 * Memory Activate Executor — handles memory:activate action cards.
 *
 * When a user approves a memory:activate card, the draft memory item
 * transitions to 'active'. When rejected, it transitions to 'rejected'.
 *
 * C1: Reject MUST transition domain objects out of pending review state.
 * C3: Execute MUST be idempotent — re-approving an already-active item is safe.
 * C7: Validation failed → expired (draft item no longer exists).
 */

import { getDb } from '../../core/db'
import type { ActionExecutor, ExecutorResult } from '../executor-registry'
import type { ValidationResult } from '../action-types'

// ─── Memory Item Status ──────────────────────────────────────────────────────

type MemoryItemStatus = 'draft' | 'active' | 'rejected'

// ─── Executor ────────────────────────────────────────────────────────────────

export const memoryActivateExecutor: ActionExecutor = {
  /**
   * Validate that the draft memory item still exists and is in 'draft' status.
   * If the item has been deleted or already activated, the card expires (C7).
   */
  async validate(payload: Record<string, unknown>, _cardId: string): Promise<ValidationResult> {
    const memoryItemId = payload.memoryItemId as string | undefined
    if (!memoryItemId || typeof memoryItemId !== 'string') {
      return { valid: false, reason: 'memoryItemId is missing or invalid' }
    }

    const db = getDb()
    const row = db.prepare(
      'SELECT id, status FROM project_memory_items WHERE id = ?'
    ).get(memoryItemId) as { id: string; status: string } | undefined

    if (!row) {
      return { valid: false, reason: `Memory item ${memoryItemId} no longer exists` }
    }

    // Idempotent: if already active, the card is still valid (C3)
    if (row.status === 'active') {
      return { valid: true }
    }

    // Only draft items can be activated
    if (row.status !== 'draft') {
      return { valid: false, reason: `Memory item ${memoryItemId} has status '${row.status}', expected 'draft' or 'active'` }
    }

    return { valid: true }
  },

  /**
   * Activate the draft memory item — set status to 'active'.
   * Idempotent: if already active, no change needed (C3).
   */
  async execute(payload: Record<string, unknown>, _cardId: string): Promise<ExecutorResult> {
    const memoryItemId = payload.memoryItemId as string
    const db = getDb()

    const row = db.prepare(
      'SELECT id, status FROM project_memory_items WHERE id = ?'
    ).get(memoryItemId) as { id: string; status: string } | undefined

    if (!row) {
      return { success: false, error: `Memory item ${memoryItemId} not found` }
    }

    // Idempotent: already active — no mutation needed
    if (row.status === 'active') {
      return { success: true, result: { memoryItemId, status: 'active', alreadyActive: true } }
    }

    // Transition draft → active
    db.prepare(
      "UPDATE project_memory_items SET status = 'active', updated_at = unixepoch() WHERE id = ? AND status = 'draft'"
    ).run(memoryItemId)

    // Verify the transition succeeded
    const updated = db.prepare(
      'SELECT status FROM project_memory_items WHERE id = ?'
    ).get(memoryItemId) as { status: string } | undefined

    if (updated?.status !== 'active') {
      return { success: false, error: `Failed to activate memory item ${memoryItemId}, current status: ${updated?.status ?? 'unknown'}` }
    }

    return { success: true, result: { memoryItemId, status: 'active' } }
  },

  /**
   * Reject — transition draft memory item to 'rejected' (C1).
   * This removes the item from pending review state.
   */
  async reject(payload: Record<string, unknown>, _cardId: string): Promise<void> {
    const memoryItemId = payload.memoryItemId as string
    const db = getDb()

    const row = db.prepare(
      'SELECT id, status FROM project_memory_items WHERE id = ?'
    ).get(memoryItemId) as { id: string; status: string } | undefined

    if (!row) {
      // Item already deleted — nothing to reject
      return
    }

    if (row.status === 'draft') {
      db.prepare(
        "UPDATE project_memory_items SET status = 'rejected', updated_at = unixepoch() WHERE id = ? AND status = 'draft'"
      ).run(memoryItemId)
    }
    // If already active or rejected, no transition needed
  },
}