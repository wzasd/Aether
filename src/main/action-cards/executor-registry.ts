/**
 * Executor Registry — validate + execute + CAS state machine for Action Cards.
 *
 * Each action type maps to an executor that:
 * 1. validate() — re-checks preconditions before execution
 * 2. execute() — performs the actual mutation, idempotent via CAS
 * 3. reject() — transitions domain objects out of pending review state (C1)
 *
 * State machine:
 *   pending → executing → executed
 *   pending → executing → failed  (transient, manual retry allowed)
 *   failed  → executing → executed/failed  (retry same card via CAS)
 *   pending → rejected  (bypass terminal)
 *   pending → expired   (bypass terminal, daemon cleanup)
 *   failed  → expired   (validation failure after retry/revalidate)
 *
 * C3: Execute MUST be idempotent and transaction-safe.
 * C7: Validation failed → expired; transient failed → retry same card.
 */

import { getDb } from '../core/db'
import type { ActionType, ActionCardStatus, ValidationResult } from './action-types'
import { isTerminalStatus } from './action-types'

// ─── Executor Interface ─────────────────────────────────────────────────────

export interface ExecutorResult {
  readonly success: boolean
  readonly result?: unknown
  readonly error?: string
}

export interface ActionExecutor {
  /**
   * Re-validate preconditions before execution.
   * Called inside the CAS transaction before execute().
   * If invalid, the card transitions to expired (C7).
   */
  validate(payload: Record<string, unknown>, cardId: string): Promise<ValidationResult>

  /**
   * Execute the actual mutation. MUST be idempotent.
   * Runs inside the same transaction as the CAS status transition.
   */
  execute(payload: Record<string, unknown>, cardId: string): Promise<ExecutorResult>

  /**
   * Handle rejection — transition domain objects out of pending review state (C1).
   * e.g. memory:activate reject → draft memory becomes rejected
   */
  reject?(payload: Record<string, unknown>, cardId: string): Promise<void>
}

// ─── Registry ───────────────────────────────────────────────────────────────

const executors = new Map<ActionType, ActionExecutor>()

/**
 * Register an executor for an action type.
 */
export function registerExecutor(type: ActionType, executor: ActionExecutor): void {
  executors.set(type, executor)
}

/**
 * Get the executor for an action type, or undefined if not registered.
 */
export function getExecutor(type: ActionType): ActionExecutor | undefined {
  return executors.get(type)
}

// ─── Core Operations ────────────────────────────────────────────────────────

export interface ApproveResult {
  readonly status: ActionCardStatus
  readonly result?: unknown
  readonly error?: string
}

/**
 * Approve and execute an action card.
 *
 * Flow:
 * 1. CAS: pending → executing (or failed → executing for retry)
 * 2. validate() — if invalid, mark expired (C7)
 * 3. execute() — if success, mark executed; if transient fail, mark failed
 * 4. Write approved_by_user_id + approved_at as audit fields (C2)
 *
 * Steps 1-4 run in a single SQLite transaction for atomicity (C3).
 * Note: executor.validate() and executor.execute() may be async, so we
 * prepare the transaction boundary around the DB mutations and call
 * validate/execute outside the transaction, then apply results inside.
 */
export async function approveAndExecute(
  cardId: string,
  approvedByUserId: string
): Promise<ApproveResult> {
  const db = getDb()
  const now = Math.floor(Date.now() / 1000)

  // Read card
  const card = db.prepare(
    'SELECT id, type, status, payload_json FROM action_cards WHERE id = ?'
  ).get(cardId) as { id: string; type: ActionType; status: ActionCardStatus; payload_json: string } | undefined

  if (!card) {
    return { status: 'pending', error: 'Action card not found' }
  }

  if (isTerminalStatus(card.status)) {
    return { status: card.status, error: `Card is already in terminal status: ${card.status}` }
  }

  const executor = getExecutor(card.type)
  if (!executor) {
    return { status: card.status, error: `No executor registered for type: ${card.type}` }
  }

  const payload: Record<string, unknown> = JSON.parse(card.payload_json)

  // CAS: pending/failed → executing (inside transaction)
  const casResult = db.transaction(() => {
    const expectedStatuses = ['pending', 'failed']
    const placeholders = expectedStatuses.map(() => '?').join(',')
    const result = db.prepare(
      `UPDATE action_cards SET status = 'executing', updated_at = unixepoch() WHERE id = ? AND status IN (${placeholders})`
    ).run(cardId, ...expectedStatuses)

    if (result.changes === 0) {
      const row = db.prepare('SELECT status FROM action_cards WHERE id = ?').get(cardId) as { status: ActionCardStatus } | undefined
      return { success: false, currentStatus: row?.status ?? 'pending' }
    }

    // Write audit fields (C2: approve is audit event, not durable intermediate status)
    db.prepare(
      'UPDATE action_cards SET approved_by_user_id = ?, approved_at = ?, updated_at = unixepoch() WHERE id = ?'
    ).run(approvedByUserId, now, cardId)

    return { success: true, currentStatus: 'executing' as const }
  })()

  if (!casResult.success) {
    return { status: casResult.currentStatus, error: `CAS failed: status is ${casResult.currentStatus}, expected pending or failed` }
  }

  // Validate and execute outside transaction (may be async I/O)
  let validation: ValidationResult
  let execResult: ExecutorResult

  try {
    validation = await executor.validate(payload, cardId)
    if (!validation.valid) {
      // C7: Validation failed → expired (inside transaction)
      db.transaction(() => {
        db.prepare(
          "UPDATE action_cards SET status = 'expired', error = ?, updated_at = unixepoch() WHERE id = ?"
        ).run(validation!.reason ?? 'Validation failed', cardId)
      })()
      return { status: 'expired', error: validation.reason }
    }

    execResult = await executor.execute(payload, cardId)
  } catch (err) {
    // Unhandled exception — treat as transient failure
    const errorMessage = err instanceof Error ? err.message : String(err)
    db.transaction(() => {
      db.prepare(
        `UPDATE action_cards SET status = 'failed', error = ?, updated_at = unixepoch() WHERE id = ?`
      ).run(errorMessage, cardId)
    })()
    return { status: 'failed', error: errorMessage }
  }

  // Apply execution result (inside transaction)
  if (execResult.success) {
    db.transaction(() => {
      db.prepare(
        `UPDATE action_cards SET status = 'executed', result_json = ?, updated_at = unixepoch() WHERE id = ?`
      ).run(JSON.stringify(execResult.result ?? null), cardId)
    })()
    return { status: 'executed', result: execResult.result }
  } else {
    // Transient failure — keep as failed, allow retry (C7)
    db.transaction(() => {
      db.prepare(
        `UPDATE action_cards SET status = 'failed', error = ?, updated_at = unixepoch() WHERE id = ?`
      ).run(execResult.error ?? 'Execution failed', cardId)
    })()
    return { status: 'failed', error: execResult.error }
  }
}

/**
 * Reject an action card and transition domain objects.
 *
 * C1: Reject MUST transition target domain object out of pending review state.
 */
export async function rejectCard(
  cardId: string,
  rejectedByUserId: string
): Promise<{ success: boolean; status: ActionCardStatus; error?: string }> {
  const db = getDb()

  const card = db.prepare(
    'SELECT id, type, status, payload_json FROM action_cards WHERE id = ?'
  ).get(cardId) as { id: string; type: ActionType; status: ActionCardStatus; payload_json: string } | undefined

  if (!card) {
    return { success: false, status: 'pending', error: 'Action card not found' }
  }

  if (card.status !== 'pending') {
    return { success: false, status: card.status, error: `Can only reject pending cards, current status: ${card.status}` }
  }

  // CAS: pending → rejected (inside transaction)
  const casResult = db.transaction(() => {
    const result = db.prepare(
      "UPDATE action_cards SET status = 'rejected', updated_at = unixepoch() WHERE id = ? AND status = 'pending'"
    ).run(cardId)

    if (result.changes === 0) {
      const row = db.prepare('SELECT status FROM action_cards WHERE id = ?').get(cardId) as { status: ActionCardStatus } | undefined
      return { success: false, currentStatus: row?.status ?? 'pending' }
    }

    return { success: true, currentStatus: 'rejected' as const }
  })()

  if (!casResult.success) {
    return { success: false, status: casResult.currentStatus, error: `CAS failed: status is ${casResult.currentStatus}` }
  }

  // Invoke reject handler for domain object transition (C1)
  const executor = getExecutor(card.type)
  if (executor?.reject) {
    const payload: Record<string, unknown> = JSON.parse(card.payload_json)
    await executor.reject(payload, cardId)
  }

  return { success: true, status: 'rejected' }
}

/**
 * Manual retry for a failed action card.
 * Re-runs the approve+execute flow on the same card (C7).
 */
export async function retryCard(cardId: string): Promise<ApproveResult> {
  const db = getDb()

  const card = db.prepare(
    'SELECT id, status, approved_by_user_id FROM action_cards WHERE id = ?'
  ).get(cardId) as { id: string; status: ActionCardStatus; approved_by_user_id: string | null } | undefined

  if (!card) {
    return { status: 'pending', error: 'Action card not found' }
  }

  if (card.status !== 'failed') {
    return { status: card.status, error: `Can only retry failed cards, current status: ${card.status}` }
  }

  // Re-execute using the original approver identity
  const approver = card.approved_by_user_id ?? 'system:retry'
  return approveAndExecute(cardId, approver)
}

// ─── Expiry ─────────────────────────────────────────────────────────────────

/**
 * Expire pending action cards whose expires_at has passed.
 * Called at daemon startup and periodically.
 *
 * Also expire stuck executing cards (executor crash recovery):
 * If a card has been in 'executing' for > 5 minutes, mark it as 'failed'
 * so it can be manually retried.
 */
export function expireActionCards(): { expired: number; recovered: number } {
  const db = getDb()
  const now = Math.floor(Date.now() / 1000)
  const STUCK_EXECUTING_THRESHOLD = 5 * 60 // 5 minutes

  // Expire pending cards past their expiry time
  const expiredResult = db.prepare(
    `UPDATE action_cards SET status = 'expired', updated_at = unixepoch()
     WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at > 0 AND expires_at < ?`
  ).run(now)

  // Recover stuck executing cards (executor crash)
  const stuckCutoff = now - STUCK_EXECUTING_THRESHOLD
  const recoveredResult = db.prepare(
    `UPDATE action_cards SET status = 'failed', error = 'Executor timed out', updated_at = unixepoch()
     WHERE status = 'executing' AND updated_at < ?`
  ).run(stuckCutoff)

  return {
    expired: expiredResult.changes,
    recovered: recoveredResult.changes,
  }
}
