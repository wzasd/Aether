/**
 * TaskQueue — SQLite-backed task queue for Agent execution.
 *
 * Inspired by Multica's AgentTaskQueue (server/pkg/db/generated).
 * Tasks are enqueued by the system and claimed by resident Agent runtimes.
 */

import { randomUUID } from 'crypto'
import { getDb } from '../core/db'

export type TaskStatus = 'pending' | 'claimed' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface AgentTask {
  id: string
  conversationId: string
  agentProfileId: string
  message: string
  context: string | null // JSON-serialized conversation context
  status: TaskStatus
  createdAt: number
  claimedAt: number | null
  completedAt: number | null
  result: string | null
  error: string | null
  depth: number // delegation depth for chain tracking
  parentTaskId: string | null
  sessionId: string | null // For cross-round resume
}

export interface EnqueueTaskParams {
  conversationId: string
  agentProfileId: string
  message: string
  context?: Array<{ role: string; content: string }>
  depth?: number
  parentTaskId?: string
  sessionId?: string | null
}

export interface ClaimResult {
  task: AgentTask | null
  reason: 'claimed' | 'no_capacity' | 'no_tasks' | 'error'
}

export class TaskQueue {
  private db = getDb()

  constructor() {
    this.ensureTable()
  }

  private ensureTable(): void {
    this.db.prepare(`
      CREATE TABLE IF NOT EXISTS agent_task_queue (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        agent_profile_id TEXT NOT NULL,
        message TEXT NOT NULL,
        context TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        claimed_at INTEGER,
        completed_at INTEGER,
        result TEXT,
        error TEXT,
        depth INTEGER NOT NULL DEFAULT 0,
        parent_task_id TEXT,
        session_id TEXT
      )
    `).run()

    this.db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_task_queue_status_agent
      ON agent_task_queue(status, agent_profile_id)
    `).run()

    this.db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_task_queue_conversation
      ON agent_task_queue(conversation_id, created_at)
    `).run()
  }

  /** Enqueue a new task for an agent */
  enqueue(params: EnqueueTaskParams): AgentTask {
    const task: AgentTask = {
      id: randomUUID(),
      conversationId: params.conversationId,
      agentProfileId: params.agentProfileId,
      message: params.message,
      context: params.context ? JSON.stringify(params.context) : null,
      status: 'pending',
      createdAt: Date.now(),
      claimedAt: null,
      completedAt: null,
      result: null,
      error: null,
      depth: params.depth ?? 0,
      parentTaskId: params.parentTaskId ?? null,
      sessionId: params.sessionId ?? null,
    }

    this.db.prepare(`
      INSERT INTO agent_task_queue
      (id, conversation_id, agent_profile_id, message, context, status, created_at, depth, parent_task_id, session_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      task.id,
      task.conversationId,
      task.agentProfileId,
      task.message,
      task.context,
      task.status,
      task.createdAt,
      task.depth,
      task.parentTaskId,
      task.sessionId
    )

    return task
  }

  /**
   * Claim the next pending task for an agent.
   * Returns null if no tasks available or agent is at capacity.
   */
  claim(agentProfileId: string, maxConcurrent: number): ClaimResult {
    try {
      // Check capacity
      const running = this.db.prepare(
        `SELECT COUNT(*) as count FROM agent_task_queue
         WHERE agent_profile_id = ? AND status IN ('claimed', 'running')`
      ).get(agentProfileId) as { count: number }

      if (running.count >= maxConcurrent) {
        return { task: null, reason: 'no_capacity' }
      }

      // Atomically claim the oldest pending task
      const row = this.db.prepare(
        `UPDATE agent_task_queue
         SET status = 'claimed', claimed_at = ?
         WHERE id = (
           SELECT id FROM agent_task_queue
           WHERE agent_profile_id = ? AND status = 'pending'
           ORDER BY created_at ASC
           LIMIT 1
         )
         RETURNING *`
      ).get(Date.now(), agentProfileId) as Record<string, unknown> | undefined

      if (!row) {
        return { task: null, reason: 'no_tasks' }
      }

      return { task: this.rowToTask(row), reason: 'claimed' }
    } catch (err) {
      console.error('[TaskQueue] claim failed:', err)
      return { task: null, reason: 'error' }
    }
  }

  /** Mark a task as running */
  start(taskId: string): void {
    this.db.prepare(
      `UPDATE agent_task_queue SET status = 'running' WHERE id = ?`
    ).run(taskId)
  }

  /** Mark a task as completed with result */
  complete(taskId: string, result: string): void {
    this.db.prepare(
      `UPDATE agent_task_queue
       SET status = 'completed', completed_at = ?, result = ?
       WHERE id = ?`
    ).run(Date.now(), result, taskId)
  }

  /** Mark a task as failed with error */
  fail(taskId: string, error: string): void {
    this.db.prepare(
      `UPDATE agent_task_queue
       SET status = 'failed', completed_at = ?, error = ?
       WHERE id = ?`
    ).run(Date.now(), error, taskId)
  }

  /** Cancel all pending tasks for a conversation */
  cancelPending(conversationId: string): number {
    const result = this.db.prepare(
      `UPDATE agent_task_queue
       SET status = 'cancelled'
       WHERE conversation_id = ? AND status = 'pending'`
    ).run(conversationId)
    return result.changes as number
  }

  /** Get all tasks for a conversation */
  getConversationTasks(conversationId: string): AgentTask[] {
    const rows = this.db.prepare(
      `SELECT * FROM agent_task_queue WHERE conversation_id = ? ORDER BY created_at ASC`
    ).all(conversationId) as Array<Record<string, unknown>>
    return rows.map((r) => this.rowToTask(r))
  }

  /** Get active (claimed/running) tasks for an agent */
  getAgentActiveTasks(agentProfileId: string): AgentTask[] {
    const rows = this.db.prepare(
      `SELECT * FROM agent_task_queue
       WHERE agent_profile_id = ? AND status IN ('claimed', 'running')
       ORDER BY created_at ASC`
    ).all(agentProfileId) as Array<Record<string, unknown>>
    return rows.map((r) => this.rowToTask(r))
  }

  /** Count pending tasks for an agent */
  countPending(agentProfileId: string): number {
    const row = this.db.prepare(
      `SELECT COUNT(*) as count FROM agent_task_queue
       WHERE agent_profile_id = ? AND status = 'pending'`
    ).get(agentProfileId) as { count: number }
    return row.count
  }

  /** Get the most recent session ID for an agent in a conversation */
  getLastSessionId(conversationId: string, agentProfileId: string): string | null {
    const row = this.db.prepare(
      `SELECT session_id FROM agent_task_queue
       WHERE conversation_id = ? AND agent_profile_id = ? AND session_id IS NOT NULL
       ORDER BY completed_at DESC
       LIMIT 1`
    ).get(conversationId, agentProfileId) as { session_id: string | null } | undefined
    return row?.session_id ?? null
  }

  /** Update session ID for a task */
  updateSessionId(taskId: string, sessionId: string): void {
    this.db.prepare(
      `UPDATE agent_task_queue SET session_id = ? WHERE id = ?`
    ).run(sessionId, taskId)
  }

  private rowToTask(row: Record<string, unknown>): AgentTask {
    return {
      id: row.id as string,
      conversationId: row.conversation_id as string,
      agentProfileId: row.agent_profile_id as string,
      message: row.message as string,
      context: row.context as string | null,
      status: row.status as TaskStatus,
      createdAt: row.created_at as number,
      claimedAt: row.claimed_at as number | null,
      completedAt: row.completed_at as number | null,
      result: row.result as string | null,
      error: row.error as string | null,
      depth: row.depth as number,
      parentTaskId: row.parent_task_id as string | null,
      sessionId: row.session_id as string | null,
    }
  }
}

/** Singleton task queue */
export const taskQueue = new TaskQueue()
