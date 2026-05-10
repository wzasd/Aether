import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TaskQueue, type EnqueueTaskParams } from '../task-queue'
import { resetMockDb } from '../../core/__mocks__/db'

vi.mock('../../core/db')

describe('TaskQueue', () => {
  let queue: TaskQueue

  beforeEach(() => {
    vi.clearAllMocks()
    resetMockDb()
    queue = new TaskQueue()
  })

  it('enqueues a task and returns it with pending status', () => {
    const task = queue.enqueue({
      conversationId: 'conv-1',
      agentProfileId: 'coder',
      message: 'hello',
    })

    expect(task.conversationId).toBe('conv-1')
    expect(task.agentProfileId).toBe('coder')
    expect(task.message).toBe('hello')
    expect(task.status).toBe('pending')
    expect(task.id).toBeDefined()
    expect(task.createdAt).toBeGreaterThan(0)
  })

  it('claims the oldest pending task for an agent', () => {
    queue.enqueue({ conversationId: 'conv-1', agentProfileId: 'coder', message: 'first' })
    queue.enqueue({ conversationId: 'conv-1', agentProfileId: 'coder', message: 'second' })

    const result = queue.claim('coder', 2)

    expect(result.reason).toBe('claimed')
    expect(result.task).not.toBeNull()
    expect(result.task!.message).toBe('first')
    expect(result.task!.status).toBe('claimed')
  })

  it('returns no_tasks when no pending tasks exist', () => {
    const result = queue.claim('coder', 2)
    expect(result.reason).toBe('no_tasks')
    expect(result.task).toBeNull()
  })

  it('returns no_capacity when agent is at max concurrent tasks', () => {
    queue.enqueue({ conversationId: 'conv-1', agentProfileId: 'coder', message: 'task 1' })
    queue.enqueue({ conversationId: 'conv-1', agentProfileId: 'coder', message: 'task 2' })

    queue.claim('coder', 1) // claim first, now at capacity
    const result = queue.claim('coder', 1) // should be no_capacity

    expect(result.reason).toBe('no_capacity')
    expect(result.task).toBeNull()
  })

  it('marks a task as running', () => {
    queue.enqueue({ conversationId: 'conv-1', agentProfileId: 'coder', message: 'task' })
    const claimResult = queue.claim('coder', 2)

    queue.start(claimResult.task!.id)

    const tasks = queue.getAgentActiveTasks('coder')
    expect(tasks).toHaveLength(1)
    expect(tasks[0].status).toBe('running')
  })

  it('marks a task as completed with result', () => {
    queue.enqueue({ conversationId: 'conv-1', agentProfileId: 'coder', message: 'task' })
    const claimResult = queue.claim('coder', 2)

    queue.complete(claimResult.task!.id, 'completed result')

    const tasks = queue.getConversationTasks('conv-1')
    expect(tasks).toHaveLength(1)
    expect(tasks[0].status).toBe('completed')
    expect(tasks[0].result).toBe('completed result')
    expect(tasks[0].completedAt).toBeGreaterThan(0)
  })

  it('marks a task as failed with error', () => {
    queue.enqueue({ conversationId: 'conv-1', agentProfileId: 'coder', message: 'task' })
    const claimResult = queue.claim('coder', 2)

    queue.fail(claimResult.task!.id, 'something went wrong')

    const tasks = queue.getConversationTasks('conv-1')
    expect(tasks).toHaveLength(1)
    expect(tasks[0].status).toBe('failed')
    expect(tasks[0].error).toBe('something went wrong')
  })

  it('cancels all pending tasks for a conversation', () => {
    queue.enqueue({ conversationId: 'conv-1', agentProfileId: 'coder', message: 'task 1' })
    queue.enqueue({ conversationId: 'conv-1', agentProfileId: 'reviewer', message: 'task 2' })
    queue.enqueue({ conversationId: 'conv-2', agentProfileId: 'coder', message: 'task 3' })

    const cancelled = queue.cancelPending('conv-1')

    expect(cancelled).toBe(2)
    const conv1Tasks = queue.getConversationTasks('conv-1')
    expect(conv1Tasks.every((t) => t.status === 'cancelled')).toBe(true)
    const conv2Tasks = queue.getConversationTasks('conv-2')
    expect(conv2Tasks.every((t) => t.status === 'pending')).toBe(true)
  })

  it('counts pending tasks per agent', () => {
    queue.enqueue({ conversationId: 'conv-1', agentProfileId: 'coder', message: 'task 1' })
    queue.enqueue({ conversationId: 'conv-1', agentProfileId: 'coder', message: 'task 2' })
    queue.enqueue({ conversationId: 'conv-1', agentProfileId: 'reviewer', message: 'task 3' })

    expect(queue.countPending('coder')).toBe(2)
    expect(queue.countPending('reviewer')).toBe(1)
    expect(queue.countPending('nonexistent')).toBe(0)
  })

  it('isolates tasks between conversations', () => {
    queue.enqueue({ conversationId: 'conv-a', agentProfileId: 'coder', message: 'a' })
    queue.enqueue({ conversationId: 'conv-b', agentProfileId: 'coder', message: 'b' })

    const tasksA = queue.getConversationTasks('conv-a')
    const tasksB = queue.getConversationTasks('conv-b')

    expect(tasksA).toHaveLength(1)
    expect(tasksB).toHaveLength(1)
    expect(tasksA[0].message).toBe('a')
    expect(tasksB[0].message).toBe('b')
  })

  it('stores and retrieves context as JSON', () => {
    const context = [{ role: 'user', content: 'hello' }]
    const task = queue.enqueue({
      conversationId: 'conv-1',
      agentProfileId: 'coder',
      message: 'task',
      context,
    })

    const tasks = queue.getConversationTasks('conv-1')
    expect(tasks[0].context).toBe(JSON.stringify(context))
  })

  it('supports task depth and parent task linking', () => {
    const parent = queue.enqueue({
      conversationId: 'conv-1',
      agentProfileId: 'coder',
      message: 'parent',
    })

    const child = queue.enqueue({
      conversationId: 'conv-1',
      agentProfileId: 'coder',
      message: 'child',
      depth: 1,
      parentTaskId: parent.id,
    })

    const tasks = queue.getConversationTasks('conv-1')
    const childTask = tasks.find((t) => t.id === child.id)
    expect(childTask!.depth).toBe(1)
    expect(childTask!.parentTaskId).toBe(parent.id)
  })

  // ─── cancelConversation ──────────────────────────────────────────────

  it('cancelConversation cancels pending, claimed, and running tasks', () => {
    queue.enqueue({ conversationId: 'conv-1', agentProfileId: 'coder', message: 'pending task' })
    queue.enqueue({ conversationId: 'conv-1', agentProfileId: 'coder', message: 'claimed task' })
    queue.enqueue({ conversationId: 'conv-1', agentProfileId: 'coder', message: 'running task' })
    queue.enqueue({ conversationId: 'conv-2', agentProfileId: 'coder', message: 'other conv' })

    // Claim one task and start another
    const claimed = queue.claim('coder', 3)
    queue.start(claimed.task!.id)

    // Get the remaining pending task and claim it
    const claimed2 = queue.claim('coder', 3)

    const result = queue.cancelConversation('conv-1')

    // Should have cancelled 1 pending + 1 claimed + 1 running = 3
    expect(result.pending + result.claimed + result.running).toBe(3)
    const conv1Tasks = queue.getConversationTasks('conv-1')
    expect(conv1Tasks.every((t) => t.status === 'cancelled')).toBe(true)

    // conv-2 should be unaffected
    const conv2Tasks = queue.getConversationTasks('conv-2')
    expect(conv2Tasks[0].status).toBe('pending')
  })

  it('cancelConversation returns zero counts for unknown conversation', () => {
    const result = queue.cancelConversation('nonexistent')
    expect(result.pending).toBe(0)
    expect(result.claimed).toBe(0)
    expect(result.running).toBe(0)
  })

  // ─── cancelTask ──────────────────────────────────────────────────────

  it('cancelTask cancels a single pending task by ID', () => {
    const task1 = queue.enqueue({ conversationId: 'conv-1', agentProfileId: 'coder', message: 'task 1' })
    queue.enqueue({ conversationId: 'conv-1', agentProfileId: 'coder', message: 'task 2' })

    const result = queue.cancelTask(task1.id)
    expect(result).toBe(true)

    const tasks = queue.getConversationTasks('conv-1')
    expect(tasks.find((t) => t.id === task1.id)!.status).toBe('cancelled')
    expect(tasks.find((t) => t.message === 'task 2')!.status).toBe('pending')
  })

  it('cancelTask cancels a claimed task by ID', () => {
    queue.enqueue({ conversationId: 'conv-1', agentProfileId: 'coder', message: 'task' })
    const claimResult = queue.claim('coder', 2)

    const result = queue.cancelTask(claimResult.task!.id)
    expect(result).toBe(true)

    const tasks = queue.getConversationTasks('conv-1')
    expect(tasks[0].status).toBe('cancelled')
  })

  it('cancelTask returns false for completed/failed/cancelled tasks', () => {
    queue.enqueue({ conversationId: 'conv-1', agentProfileId: 'coder', message: 'task' })
    const claimResult = queue.claim('coder', 2)
    queue.complete(claimResult.task!.id, 'done')

    const result = queue.cancelTask(claimResult.task!.id)
    expect(result).toBe(false)
  })

  it('cancelTask returns false for unknown task ID', () => {
    const result = queue.cancelTask('nonexistent-id')
    expect(result).toBe(false)
  })

  // ─── clearStaleTasks ─────────────────────────────────────────────────

  it('clearStaleTasks cancels all pending, claimed, and running tasks', () => {
    queue.enqueue({ conversationId: 'conv-1', agentProfileId: 'coder', message: 'pending' })
    queue.enqueue({ conversationId: 'conv-1', agentProfileId: 'coder', message: 'claimed' })
    queue.enqueue({ conversationId: 'conv-1', agentProfileId: 'coder', message: 'running' })

    // Claim and start one task
    const claimed = queue.claim('coder', 3)
    queue.start(claimed.task!.id)
    // Claim another
    queue.claim('coder', 3)

    const count = queue.clearStaleTasks()
    expect(count).toBe(3)

    const tasks = queue.getConversationTasks('conv-1')
    expect(tasks.every((t) => t.status === 'cancelled')).toBe(true)
  })

  it('clearStaleTasks does not affect completed or failed tasks', () => {
    queue.enqueue({ conversationId: 'conv-1', agentProfileId: 'coder', message: 'completed' })
    queue.enqueue({ conversationId: 'conv-1', agentProfileId: 'coder', message: 'pending' })

    // Complete the first task
    const claimResult = queue.claim('coder', 2)
    queue.complete(claimResult.task!.id, 'done')

    const count = queue.clearStaleTasks()
    expect(count).toBe(1) // only the pending task

    const tasks = queue.getConversationTasks('conv-1')
    const completedTask = tasks.find((t) => t.message === 'completed')
    const pendingTask = tasks.find((t) => t.message === 'pending')
    expect(completedTask!.status).toBe('completed')
    expect(pendingTask!.status).toBe('cancelled')
  })

  it('clearStaleTasks returns 0 when no stale tasks exist', () => {
    const count = queue.clearStaleTasks()
    expect(count).toBe(0)
  })
})
