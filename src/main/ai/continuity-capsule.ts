import { getDb } from '../core/db'
import type { A2ATask } from './a2a-types'

export type BallState = 'in_progress' | 'completed' | 'needs_handoff' | 'needs_owner'

export interface SessionSeal {
  sessionId: string
  sessionSeq: number
  checkpointAt: number
}

export interface CollaborationContinuityCapsule {
  id: string
  conversationId: string
  taskId: string
  parentCapsuleId?: string
  a2aDepth: number
  /** Position in the serial chain (1-based). Undefined for parallel tasks. */
  chainIndex?: number
  /** Total tasks in the serial chain. Undefined for parallel tasks. */
  chainTotal?: number
  ballState: BallState
  continuationReason?: string
  seal?: SessionSeal
  createdAt: number
  updatedAt: number
}

/**
 * Build a continuation prompt that tells the Agent it is resuming a sealed
 * session. Mirrors clowder-ai's formatContinuationPrompt — injected into the
 * message content so the Agent has full context about where it left off.
 */
export function formatContinuationPrompt(capsule: CollaborationContinuityCapsule): string {
  const lines: string[] = [
    `[系统：会话续传]`,
    `你正在恢复一个之前封印的会话（Session ID: ${capsule.seal?.sessionId ?? 'unknown'}）。`,
  ]

  if (capsule.chainIndex !== undefined && capsule.chainTotal !== undefined) {
    lines.push(`当前任务是串行链中的第 ${capsule.chainIndex}/${capsule.chainTotal} 步。`)
  }

  if (capsule.continuationReason) {
    lines.push(`续传原因：${capsule.continuationReason}`)
  }

  lines.push(`请继续处理以下任务，保持之前的上下文和决策。`)
  lines.push(`---`)

  return lines.join('\n')
}

/**
 * Manages session continuity capsules for A2A task chains.
 *
 * Each task gets a capsule that tracks its session state. When a child task
 * completes, the orchestrator checks the parent capsule to decide whether to:
 * 1. Create a feedback task (parent session is gone)
 * 2. Inject directly into parent's running session via session resume.
 */
export class ContinuityCapsuleManager {
  private capsules = new Map<string, CollaborationContinuityCapsule>()

  create(
    task: A2ATask,
    parentCapsuleId?: string,
    chainIndex?: number,
    chainTotal?: number
  ): CollaborationContinuityCapsule {
    const capsule: CollaborationContinuityCapsule = {
      id: `${task.id}::capsule`,
      conversationId: task.conversationId,
      taskId: task.id,
      parentCapsuleId,
      a2aDepth: task.depth,
      chainIndex,
      chainTotal,
      ballState: 'in_progress',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    this.capsules.set(capsule.id, capsule)
    this.persist(capsule)
    return capsule
  }

  seal(capsuleId: string, sessionId: string, sessionSeq: number): void {
    const capsule = this.capsules.get(capsuleId)
    if (!capsule) return
    capsule.seal = { sessionId, sessionSeq, checkpointAt: Date.now() }
    capsule.updatedAt = Date.now()
    this.persist(capsule)
  }

  complete(capsuleId: string, finalState: BallState, reason?: string): void {
    const capsule = this.capsules.get(capsuleId)
    if (!capsule) return
    capsule.ballState = finalState
    capsule.continuationReason = reason
    capsule.updatedAt = Date.now()
    this.persist(capsule)
  }

  handoff(capsuleId: string, toAgentId: string): CollaborationContinuityCapsule | undefined {
    const capsule = this.capsules.get(capsuleId)
    if (!capsule) return undefined
    capsule.ballState = 'needs_handoff'
    capsule.continuationReason = `Handed off to ${toAgentId}`
    capsule.updatedAt = Date.now()
    this.persist(capsule)
    return capsule
  }

  get(capsuleId: string): CollaborationContinuityCapsule | undefined {
    return this.capsules.get(capsuleId)
  }

  getByTaskId(taskId: string): CollaborationContinuityCapsule | undefined {
    return this.capsules.get(`${taskId}::capsule`)
  }

  getRootCapsule(conversationId: string): CollaborationContinuityCapsule | undefined {
    let root: CollaborationContinuityCapsule | undefined
    for (const capsule of Array.from(this.capsules.values())) {
      if (capsule.conversationId === conversationId && capsule.a2aDepth === 0) {
        if (!root || capsule.createdAt > root.createdAt) {
          root = capsule
        }
      }
    }
    return root
  }

  /**
   * Check if a parent capsule's session is still resumable.
   * A session is resumable if:
   * - It has a seal (sessionId)
   * - The capsule is in 'in_progress' or 'needs_handoff' state
   * - The seal is not stale (< 30 min old)
   */
  isSessionResumable(capsuleId: string): boolean {
    const capsule = this.capsules.get(capsuleId)
    if (!capsule?.seal) return false
    if (!['in_progress', 'needs_handoff'].includes(capsule.ballState)) return false
    const SESSION_STALE_MS = 30 * 60 * 1000
    return Date.now() - capsule.seal.checkpointAt < SESSION_STALE_MS
  }

  clearConversation(conversationId: string): void {
    for (const [id, capsule] of Array.from(this.capsules.entries())) {
      if (capsule.conversationId === conversationId) {
        this.capsules.delete(id)
      }
    }
    const db = getDb()
    db.prepare(`DELETE FROM continuity_capsules WHERE conversation_id = ?`).run(conversationId)
  }

  // ─── Persistence ──────────────────────────────────────────────────────────

  persist(capsule: CollaborationContinuityCapsule): void {
    const db = getDb()
    db.prepare(`
      INSERT OR REPLACE INTO continuity_capsules
        (id, conversation_id, task_id, parent_capsule_id, a2a_depth, chain_index, chain_total,
         ball_state, continuation_reason, seal_session_id, seal_session_seq, seal_checkpoint_at,
         created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      capsule.id,
      capsule.conversationId,
      capsule.taskId,
      capsule.parentCapsuleId ?? null,
      capsule.a2aDepth,
      capsule.chainIndex ?? null,
      capsule.chainTotal ?? null,
      capsule.ballState,
      capsule.continuationReason ?? null,
      capsule.seal?.sessionId ?? null,
      capsule.seal?.sessionSeq ?? null,
      capsule.seal?.checkpointAt ?? null,
      capsule.createdAt,
      capsule.updatedAt
    )
  }

  load(conversationId: string): CollaborationContinuityCapsule[] {
    const db = getDb()
    const rows = db.prepare(
      `SELECT * FROM continuity_capsules WHERE conversation_id = ? ORDER BY created_at ASC`
    ).all(conversationId) as Array<Record<string, unknown>>

    const capsules = rows.map((r) => this.rowToCapsule(r))
    // Rehydrate into memory map
    for (const c of capsules) {
      this.capsules.set(c.id, c)
    }
    return capsules
  }

  private rowToCapsule(row: Record<string, unknown>): CollaborationContinuityCapsule {
    const sealSessionId = row.seal_session_id as string | null
    const seal: SessionSeal | undefined = sealSessionId
      ? {
          sessionId: sealSessionId,
          sessionSeq: row.seal_session_seq as number,
          checkpointAt: row.seal_checkpoint_at as number,
        }
      : undefined

    return {
      id: row.id as string,
      conversationId: row.conversation_id as string,
      taskId: row.task_id as string,
      parentCapsuleId: (row.parent_capsule_id as string | null) ?? undefined,
      a2aDepth: row.a2a_depth as number,
      chainIndex: (row.chain_index as number | null) ?? undefined,
      chainTotal: (row.chain_total as number | null) ?? undefined,
      ballState: row.ball_state as BallState,
      continuationReason: (row.continuation_reason as string | null) ?? undefined,
      seal,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    }
  }
}
