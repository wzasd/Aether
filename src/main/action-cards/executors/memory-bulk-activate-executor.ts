/**
 * Memory Bulk Activate Executor — handles memory:bulk_activate action cards.
 *
 * When a user approves a bulk_activate card, all draft memory items
 * transition to 'active'. When rejected, they transition to 'rejected'.
 *
 * C1: Reject MUST transition domain objects out of pending review state.
 * C3: Execute MUST be idempotent — re-approving already-active items is safe.
 * C7: Validation failed → expired (draft items no longer exist).
 */

import { getDb } from '../../core/db'
import type { ActionExecutor, ExecutorResult } from '../executor-registry'
import type { ValidationResult } from '../action-types'

// ─── Executor ────────────────────────────────────────────────────────────────

export const memoryBulkActivateExecutor: ActionExecutor = {
  /**
   * Validate that at least one draft memory item still exists.
   * If all items have been deleted or already activated, the card expires (C7).
   */
  async validate(payload: Record<string, unknown>, _cardId: string): Promise<ValidationResult> {
    const memoryItemIds = payload.memoryItemIds as string[] | undefined
    if (!Array.isArray(memoryItemIds) || memoryItemIds.length === 0) {
      return { valid: false, reason: 'memoryItemIds must be a non-empty array' }
    }

    const db = getDb()
    const placeholders = memoryItemIds.map(() => '?').join(',')
    const rows = db.prepare(
      `SELECT id, status FROM project_memory_items WHERE id IN (${placeholders})`
    ).all(...memoryItemIds) as Array<{ id: string; status: string }>

    if (rows.length === 0) {
      return { valid: false, reason: 'None of the specified memory items exist' }
    }

    // Check if at least one item is still draft (or already active for idempotency)
    const hasDraftOrActive = rows.some((r) => r.status === 'draft' || r.status === 'active')
    if (!hasDraftOrActive) {
      return { valid: false, reason: `No draft or active items found — all ${rows.length} items are in a non-activatable state` }
    }

    return { valid: true }
  },

  /**
   * Activate all draft memory items — set status to 'active'.
   * Idempotent: already-active items are skipped (C3).
   */
  async execute(payload: Record<string, unknown>, _cardId: string): Promise<ExecutorResult> {
    const memoryItemIds = payload.memoryItemIds as string[]
    const db = getDb()

    const placeholders = memoryItemIds.map(() => '?').join(',')
    const rows = db.prepare(
      `SELECT id, status FROM project_memory_items WHERE id IN (${placeholders})`
    ).all(...memoryItemIds) as Array<{ id: string; status: string }>

    if (rows.length === 0) {
      return { success: false, error: 'No memory items found — all specified items no longer exist' }
    }

    // Collect IDs of draft items to activate
    const draftIds = rows.filter((r) => r.status === 'draft').map((r) => r.id)
    const alreadyActiveCount = rows.filter((r) => r.status === 'active').length

    if (draftIds.length > 0) {
      // Batch update: draft → active
      const updatePlaceholders = draftIds.map(() => '?').join(',')
      db.prepare(
        `UPDATE project_memory_items SET status = 'active', updated_at = unixepoch() WHERE id IN (${updatePlaceholders}) AND status = 'draft'`
      ).run(...draftIds)
    }

    return {
      success: true,
      result: {
        activated: draftIds.length,
        alreadyActive: alreadyActiveCount,
        total: rows.length,
      },
    }
  },

  /**
   * Reject — transition all draft memory items to 'rejected' (C1).
   */
  async reject(payload: Record<string, unknown>, _cardId: string): Promise<void> {
    const memoryItemIds = payload.memoryItemIds as string[]
    const db = getDb()

    const placeholders = memoryItemIds.map(() => '?').join(',')
    // Only reject items that are still in draft status
    db.prepare(
      `UPDATE project_memory_items SET status = 'rejected', updated_at = unixepoch() WHERE id IN (${placeholders}) AND status = 'draft'`
    ).run(...memoryItemIds)
  },
}