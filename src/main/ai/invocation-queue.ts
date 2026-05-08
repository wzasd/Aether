import type { A2ATask } from './a2a-types'

export interface QueuedTask {
  task: A2ATask
  priority: number
  enqueuedAt: number
  /** Dedup key — tasks with the same key in the same conversation are dropped */
  idempotencyKey?: string
}

export interface QueueStats {
  total: number
  pending: number
  processing: boolean
  currentTaskId?: string
}

/**
 * Per-conversation priority queue with zombie defense.
 *
 * Design notes:
 * - One queue per conversationId (Bytro conversation = clowder-ai thread)
 * - Priority: user-initiated (0) > feedback (1) > deep-chain (2+)
 * - Zombie defense detects tasks stuck in 'working' > STALE_THRESHOLD_MS
 */
export class InvocationQueue {
  private queues = new Map<string, QueuedTask[]>()
  private processing = new Map<string, { taskId: string; startedAt: number }>() // conversationId -> { taskId, startedAt }
  private zombieCheckInterval?: ReturnType<typeof setInterval>
  /** Tracks idempotency keys currently in queue per conversation */
  private idempotencyKeys = new Map<string, Set<string>>() // conversationId -> Set<key>
  /** Tracks parallel (non-queued) task start times for zombie defense. Key: taskId */
  private parallelStartTimes = new Map<string, { conversationId: string; startedAt: number }>()

  STALE_THRESHOLD_MS = 10 * 60 * 1000 // 10 minutes

  // ─── Enqueue / Dequeue ────────────────────────────────────────────────────

  enqueue(conversationId: string, task: A2ATask, idempotencyKey?: string): number {
    // Dedup: drop if an identical key is already queued for this conversation
    if (idempotencyKey) {
      const keys = this.idempotencyKeys.get(conversationId) ?? new Set()
      if (keys.has(idempotencyKey)) {
        return this.getQueueLength(conversationId)
      }
      keys.add(idempotencyKey)
      this.idempotencyKeys.set(conversationId, keys)
    }

    const queue = this.queues.get(conversationId) ?? []
    const priority = this.computePriority(task)
    const queued: QueuedTask = { task, priority, enqueuedAt: Date.now(), idempotencyKey }

    // Insert by priority (lower number = higher priority), then FIFO within same priority
    const insertIndex = queue.findIndex((q) => q.priority > priority)
    if (insertIndex === -1) {
      queue.push(queued)
    } else {
      queue.splice(insertIndex, 0, queued)
    }

    this.queues.set(conversationId, queue)
    return this.getPosition(conversationId, task.id) ?? queue.length
  }

  dequeue(conversationId: string): QueuedTask | undefined {
    const queue = this.queues.get(conversationId) ?? []
    if (queue.length === 0) return undefined
    const next = queue.shift()
    this.queues.set(conversationId, queue)
    // Release idempotency key so the same task can be re-enqueued later if needed
    if (next?.idempotencyKey) {
      this.idempotencyKeys.get(conversationId)?.delete(next.idempotencyKey)
    }
    return next
  }

  peek(conversationId: string): QueuedTask | undefined {
    return this.queues.get(conversationId)?.[0]
  }

  remove(conversationId: string, taskId: string): QueuedTask | undefined {
    const queue = this.queues.get(conversationId) ?? []
    const index = queue.findIndex((q) => q.task.id === taskId)
    if (index === -1) return undefined
    const [removed] = queue.splice(index, 1)
    this.queues.set(conversationId, queue)
    return removed
  }

  // ─── Processing tracking ──────────────────────────────────────────────────

  markProcessing(conversationId: string, taskId: string): void {
    this.processing.set(conversationId, { taskId, startedAt: Date.now() })
  }

  markDone(conversationId: string): void {
    this.processing.delete(conversationId)
  }

  // ─── Parallel task tracking (zombie defense for non-queued tasks) ──────────

  trackParallel(conversationId: string, taskId: string): void {
    this.parallelStartTimes.set(taskId, { conversationId, startedAt: Date.now() })
  }

  untrackParallel(taskId: string): void {
    this.parallelStartTimes.delete(taskId)
  }

  getProcessingTaskId(conversationId: string): string | undefined {
    return this.processing.get(conversationId)?.taskId
  }

  getProcessingStartedAt(conversationId: string): number | undefined {
    return this.processing.get(conversationId)?.startedAt
  }

  isProcessing(conversationId: string): boolean {
    return this.processing.has(conversationId)
  }

  // ─── Position queries ─────────────────────────────────────────────────────

  getPosition(conversationId: string, taskId: string): number | undefined {
    const queue = this.queues.get(conversationId) ?? []
    const index = queue.findIndex((q) => q.task.id === taskId)
    return index === -1 ? undefined : index + 1 // 1-based position
  }

  getQueueLength(conversationId: string): number {
    return this.queues.get(conversationId)?.length ?? 0
  }

  getStats(conversationId: string): QueueStats {
    const queue = this.queues.get(conversationId) ?? []
    return {
      total: queue.length,
      pending: queue.filter((q) => q.task.status === 'pending').length,
      processing: this.isProcessing(conversationId),
      currentTaskId: this.getProcessingTaskId(conversationId),
    }
  }

  // ─── Queue lifecycle ──────────────────────────────────────────────────────

  clear(conversationId: string): void {
    this.queues.delete(conversationId)
    this.processing.delete(conversationId)
    this.idempotencyKeys.delete(conversationId)
    // Also clean up parallel tracking entries for this conversation
    for (const [taskId, entry] of Array.from(this.parallelStartTimes.entries())) {
      if (entry.conversationId === conversationId) {
        this.parallelStartTimes.delete(taskId)
      }
    }
  }

  getAllConversationIds(): string[] {
    const ids = new Set<string>()
    for (const id of Array.from(this.queues.keys())) { ids.add(id) }
    for (const id of Array.from(this.processing.keys())) { ids.add(id) }
    return Array.from(ids)
  }

  // ─── Zombie defense ───────────────────────────────────────────────────────

  startZombieDefense(
    getTaskStatus: (taskId: string) => A2ATask['status'] | undefined,
    onZombieDetected: (taskId: string) => void
  ): void {
    if (this.zombieCheckInterval) return

    this.zombieCheckInterval = setInterval(() => {
      const now = Date.now()
      // Check serial (queued) tasks
      for (const [conversationId, proc] of Array.from(this.processing.entries())) {
        const { taskId, startedAt } = proc
        const status = getTaskStatus(taskId)
        if (status !== 'working') continue

        const elapsed = now - startedAt
        if (elapsed > this.STALE_THRESHOLD_MS) {
          onZombieDetected(taskId)
        }
      }
      // Check parallel (non-queued) tasks
      for (const [taskId, entry] of Array.from(this.parallelStartTimes.entries())) {
        const status = getTaskStatus(taskId)
        if (status !== 'working') {
          this.parallelStartTimes.delete(taskId)
          continue
        }
        const elapsed = now - entry.startedAt
        if (elapsed > this.STALE_THRESHOLD_MS) {
          onZombieDetected(taskId)
        }
      }
    }, 60 * 1000) // check every minute
  }

  stopZombieDefense(): void {
    if (this.zombieCheckInterval) {
      clearInterval(this.zombieCheckInterval)
      this.zombieCheckInterval = undefined
    }
  }

  // ─── Priority ─────────────────────────────────────────────────────────────

  private computePriority(task: A2ATask): number {
    // User-initiated tasks get highest priority (0)
    if (task.source === 'user') return 0

    // Feedback callbacks get medium priority (1)
    if (task.source === 'agent-scan') {
      // Deep-chain feedback (depth > 2) gets lower priority
      if (task.depth > 2) return 2
      return 1
    }

    // Default fallback
    return task.depth > 2 ? 2 : 1
  }
}
