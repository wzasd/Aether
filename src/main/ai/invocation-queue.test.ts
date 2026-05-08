import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { InvocationQueue } from './invocation-queue'
import type { A2ATask } from './a2a-types'

vi.useFakeTimers({ shouldAdvanceTime: true })

function makeTask(id: string, overrides?: Partial<A2ATask>): A2ATask {
  return {
    id,
    conversationId: 'conv-1',
    fromProfileId: null,
    toProfileId: 'agent-1',
    message: 'test',
    contextSnapshot: '',
    status: 'pending',
    depth: 0,
    chain: ['user'],
    executionMode: 'serial',
    createdAt: Math.floor(Date.now() / 1000),
    ...overrides,
  }
}

describe('InvocationQueue', () => {
  let queue: InvocationQueue

  beforeEach(() => {
    queue = new InvocationQueue()
  })

  afterEach(() => {
    queue.stopZombieDefense()
  })

  // ─── Enqueue / Dequeue ────────────────────────────────────────────────────

  test('enqueue returns position starting at 1', () => {
    const pos = queue.enqueue('conv-1', makeTask('t1'))
    expect(pos).toBe(1)
  })

  test('dequeue returns tasks in FIFO order for same priority', () => {
    queue.enqueue('conv-1', makeTask('t1'))
    queue.enqueue('conv-1', makeTask('t2'))

    const q1 = queue.dequeue('conv-1')
    expect(q1?.task.id).toBe('t1')

    const q2 = queue.dequeue('conv-1')
    expect(q2?.task.id).toBe('t2')
  })

  test('dequeue returns undefined when queue is empty', () => {
    expect(queue.dequeue('conv-1')).toBeUndefined()
  })

  // ─── Priority ─────────────────────────────────────────────────────────────

  test('user-initiated tasks have higher priority than feedback', () => {
    queue.enqueue('conv-1', makeTask('feedback-1', { source: 'agent-scan', depth: 1 }))
    queue.enqueue('conv-1', makeTask('user-1', { source: 'user' }))

    const next = queue.dequeue('conv-1')
    expect(next?.task.id).toBe('user-1')
  })

  test('feedback tasks have higher priority than deep-chain', () => {
    queue.enqueue('conv-1', makeTask('deep-1', { source: 'agent-scan', depth: 3 }))
    queue.enqueue('conv-1', makeTask('feedback-1', { source: 'agent-scan', depth: 1 }))

    const next = queue.dequeue('conv-1')
    expect(next?.task.id).toBe('feedback-1')
  })

  test('same-priority tasks maintain FIFO order', () => {
    queue.enqueue('conv-1', makeTask('a', { source: 'user' }))
    queue.enqueue('conv-1', makeTask('b', { source: 'user' }))
    queue.enqueue('conv-1', makeTask('c', { source: 'user' }))

    expect(queue.dequeue('conv-1')?.task.id).toBe('a')
    expect(queue.dequeue('conv-1')?.task.id).toBe('b')
    expect(queue.dequeue('conv-1')?.task.id).toBe('c')
  })

  // ─── Position tracking ────────────────────────────────────────────────────

  test('getPosition returns 1-based position', () => {
    queue.enqueue('conv-1', makeTask('t1'))
    queue.enqueue('conv-1', makeTask('t2'))

    expect(queue.getPosition('conv-1', 't1')).toBe(1)
    expect(queue.getPosition('conv-1', 't2')).toBe(2)
  })

  test('getPosition updates after dequeue', () => {
    queue.enqueue('conv-1', makeTask('t1'))
    queue.enqueue('conv-1', makeTask('t2'))
    queue.dequeue('conv-1')

    expect(queue.getPosition('conv-1', 't2')).toBe(1)
    expect(queue.getPosition('conv-1', 't1')).toBeUndefined()
  })

  // ─── Processing tracking ──────────────────────────────────────────────────

  test('markProcessing sets current task', () => {
    queue.enqueue('conv-1', makeTask('t1'))
    queue.markProcessing('conv-1', 't1')

    expect(queue.isProcessing('conv-1')).toBe(true)
    expect(queue.getProcessingTaskId('conv-1')).toBe('t1')
  })

  test('markDone clears processing state', () => {
    queue.markProcessing('conv-1', 't1')
    queue.markDone('conv-1')

    expect(queue.isProcessing('conv-1')).toBe(false)
    expect(queue.getProcessingTaskId('conv-1')).toBeUndefined()
  })

  test('getStats returns correct counts', () => {
    queue.enqueue('conv-1', makeTask('t1', { status: 'pending' }))
    queue.enqueue('conv-1', makeTask('t2', { status: 'working' }))
    queue.markProcessing('conv-1', 't2')

    const stats = queue.getStats('conv-1')
    expect(stats.total).toBe(2)
    expect(stats.pending).toBe(1)
    expect(stats.processing).toBe(true)
    expect(stats.currentTaskId).toBe('t2')
  })

  // ─── Conversation isolation ───────────────────────────────────────────────

  test('queues are isolated by conversationId', () => {
    queue.enqueue('conv-1', makeTask('t1'))
    queue.enqueue('conv-2', makeTask('t2'))

    expect(queue.dequeue('conv-1')?.task.id).toBe('t1')
    expect(queue.dequeue('conv-2')?.task.id).toBe('t2')
  })

  // ─── Clear ────────────────────────────────────────────────────────────────

  test('clear removes all tasks and processing state', () => {
    queue.enqueue('conv-1', makeTask('t1'))
    queue.markProcessing('conv-1', 't1')
    queue.clear('conv-1')

    expect(queue.getQueueLength('conv-1')).toBe(0)
    expect(queue.isProcessing('conv-1')).toBe(false)
  })

  // ─── Remove ───────────────────────────────────────────────────────────────

  test('remove deletes specific task from queue', () => {
    queue.enqueue('conv-1', makeTask('t1'))
    queue.enqueue('conv-1', makeTask('t2'))

    const removed = queue.remove('conv-1', 't1')
    expect(removed?.task.id).toBe('t1')
    expect(queue.getQueueLength('conv-1')).toBe(1)
    expect(queue.getPosition('conv-1', 't2')).toBe(1)
  })

  test('remove returns undefined for non-existent task', () => {
    expect(queue.remove('conv-1', 'missing')).toBeUndefined()
  })

  // ─── Zombie defense ───────────────────────────────────────────────────────

  test('zombie defense detects stuck tasks after threshold', () => {
    const onZombie = vi.fn()
    const getStatus = vi.fn().mockReturnValue('working')

    queue.STALE_THRESHOLD_MS = 100 // override for test
    queue.startZombieDefense(getStatus, onZombie)

    queue.enqueue('conv-1', makeTask('t1'))
    queue.dequeue('conv-1')
    queue.markProcessing('conv-1', 't1')

    // Immediately: not yet stale
    vi.advanceTimersByTime(50)
    expect(onZombie).not.toHaveBeenCalled()

    // After threshold: zombie detected (need to also advance past the 60s check interval)
    vi.advanceTimersByTime(60 * 1000)
    expect(onZombie).toHaveBeenCalledWith('t1')
  })

  test('zombie defense only triggers for working status', () => {
    const onZombie = vi.fn()
    const getStatus = vi.fn().mockReturnValue('completed')

    queue.STALE_THRESHOLD_MS = 100
    queue.startZombieDefense(getStatus, onZombie)

    queue.markProcessing('conv-1', 't1')
    vi.advanceTimersByTime(60 * 1000)

    expect(onZombie).not.toHaveBeenCalled()
  })

  test('stopZombieDefense clears interval', () => {
    const onZombie = vi.fn()
    queue.startZombieDefense(() => 'working', onZombie)
    queue.stopZombieDefense()

    queue.markProcessing('conv-1', 't1')
    vi.advanceTimersByTime(60 * 1000)

    expect(onZombie).not.toHaveBeenCalled()
  })
})
