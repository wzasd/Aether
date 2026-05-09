import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AgentProfile } from '../../ai/a2a-types'
import type { SessionConfig } from '../../ai/provider'

const mockObservations = new Map<string, (obs: { message: string; conversationId: string }) => Promise<{ reply?: string; relevanceScore: number }>>()

vi.mock('../../ai/agent-runtime', () => ({
  AgentRuntime: vi.fn().mockImplementation((profile: AgentProfile) => ({
    profile,
    start: vi.fn(async () => ({ id: `session-${profile.id}` })),
    onObservation: vi.fn(async (obs: { message: string; conversationId: string }) => {
      const handler = mockObservations.get(profile.id)
      return handler ? handler(obs) : { reply: `${profile.name} says: ${obs.message}`, relevanceScore: 0.8 }
    }),
    abort: vi.fn(),
    dispose: vi.fn(async () => {}),
  })),
}))

vi.mock('../../core/db', () => ({
  getDb: vi.fn(() => ({
    prepare: vi.fn(() => ({
      run: vi.fn(() => ({ changes: 1 })),
      get: vi.fn(() => ({ count: 0 })),
      all: vi.fn(() => []),
    })),
  })),
}))

vi.mock('../../core/logging', () => ({
  writeObservabilityEvent: vi.fn(),
}))

import { Daemon } from '../daemon'
import { bus } from '../event-bus'
import { taskQueue } from '../task-queue'

const profiles: AgentProfile[] = [
  {
    id: 'coder',
    workspaceId: null,
    name: 'Coder',
    role: 'coder',
    model: 'test-model',
    description: null,
    systemPrompt: null,
    isEnabled: true,
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'reviewer',
    workspaceId: null,
    name: 'Reviewer',
    role: 'reviewer',
    model: 'test-model',
    description: null,
    systemPrompt: null,
    isEnabled: true,
    sortOrder: 1,
    createdAt: 0,
    updatedAt: 0,
  },
]

const config: SessionConfig = {
  providerType: 'test-provider',
  model: 'test-model',
  workingDir: '/tmp/bytro-test',
  permissionMode: 'trusted',
}

function makeWebContents() {
  return {
    isDestroyed: vi.fn(() => false),
    send: vi.fn(),
  }
}

describe('Daemon', () => {
  let daemon: Daemon

  beforeEach(() => {
    daemon = new Daemon({ pollIntervalMs: 50 })
    mockObservations.clear()
    bus.clear()
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await daemon.stop()
  })

  it('initializes with profiles and config', async () => {
    const wc = makeWebContents()
    await daemon.initialize(profiles, config, wc as never)

    expect(daemon.isRunning()).toBe(false)
  })

  it('starts and stops cleanly', async () => {
    const wc = makeWebContents()
    await daemon.initialize(profiles, config, wc as never)

    await daemon.start()
    expect(daemon.isRunning()).toBe(true)

    await daemon.stop()
    expect(daemon.isRunning()).toBe(false)
  })

  it('is idempotent on multiple starts', async () => {
    const wc = makeWebContents()
    await daemon.initialize(profiles, config, wc as never)

    await daemon.start()
    await daemon.start() // second start should be no-op

    expect(daemon.isRunning()).toBe(true)
  })

  it('enqueues tasks for all enabled agents on user message', async () => {
    const wc = makeWebContents()
    await daemon.initialize(profiles, config, wc as never)
    await daemon.start()

    await daemon.onUserMessage('conv-1', 'implement auth', [])

    // Both agents should have pending tasks
    expect(taskQueue.countPending('coder')).toBe(1)
    expect(taskQueue.countPending('reviewer')).toBe(1)
  })

  it('publishes message:new event on user message', async () => {
    const wc = makeWebContents()
    await daemon.initialize(profiles, config, wc as never)
    await daemon.start()

    const handler = vi.fn()
    bus.subscribe('message:new', handler)

    await daemon.onUserMessage('conv-1', 'hello', [{ role: 'user', content: 'prior' }])

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'message:new',
        conversationId: 'conv-1',
        actorType: 'user',
        payload: expect.objectContaining({ message: 'hello' }),
      })
    )
  })

  it('sends open_floor:start to frontend', async () => {
    const wc = makeWebContents()
    await daemon.initialize(profiles, config, wc as never)
    await daemon.start()

    await daemon.onUserMessage('conv-1', 'test', [])

    expect(wc.send).toHaveBeenCalledWith(
      'ai:event',
      expect.objectContaining({
        type: 'open_floor:start',
        conversationId: 'conv-1',
      })
    )
  })

  it('executes tasks via polling and publishes replies', async () => {
    const wc = makeWebContents()
    await daemon.initialize(profiles, config, wc as never)
    await daemon.start()

    const replyHandler = vi.fn()
    bus.subscribe('message:reply', replyHandler)

    mockObservations.set('coder', async () => ({
      reply: 'Coder reply',
      relevanceScore: 0.9,
    }))

    await daemon.onUserMessage('conv-1', 'test message', [])

    // Wait for poll loop to pick up and execute the task
    await vi.waitFor(() => {
      expect(replyHandler).toHaveBeenCalled()
    }, { timeout: 2000 })

    expect(replyHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'message:reply',
        actorId: 'coder',
        payload: expect.objectContaining({ content: 'Coder reply' }),
      })
    )
  })

  it('cancels pending tasks on abortConversation', async () => {
    const wc = makeWebContents()
    await daemon.initialize(profiles, config, wc as never)
    await daemon.start()

    await daemon.onUserMessage('conv-1', 'test', [])
    expect(taskQueue.countPending('coder')).toBe(1)

    daemon.abortConversation('conv-1')

    expect(taskQueue.countPending('coder')).toBe(0)
  })

  it('aborts only runtimes with active tasks for target conversation', async () => {
    const wc = makeWebContents()
    await daemon.initialize(profiles, config, wc as never)
    await daemon.start()

    // Start two conversations
    await daemon.onUserMessage('conv-a', 'topic A', [])
    await daemon.onUserMessage('conv-b', 'topic B', [])

    // Abort only conv-a
    daemon.abortConversation('conv-a')

    // conv-b tasks should still be pending
    expect(taskQueue.countPending('coder')).toBe(1) // conv-b's task
  })

  it('does not crash when webContents is destroyed', async () => {
    const wc = makeWebContents()
    wc.isDestroyed.mockReturnValue(true)

    await daemon.initialize(profiles, config, wc as never)
    await daemon.start()

    // Should not throw even though webContents is destroyed
    await expect(daemon.onUserMessage('conv-1', 'test', [])).resolves.not.toThrow()
  })

  it('handles zero enabled agents gracefully', async () => {
    const wc = makeWebContents()
    const emptyProfiles: AgentProfile[] = []

    await daemon.initialize(emptyProfiles, config, wc as never)
    await daemon.start()

    await daemon.onUserMessage('conv-1', 'hello', [])

    // No tasks enqueued, no crash
    expect(wc.send).toHaveBeenCalledWith(
      'ai:event',
      expect.objectContaining({ type: 'open_floor:start' })
    )
  })

  it('survives errors in pollTasks', async () => {
    const wc = makeWebContents()
    await daemon.initialize(profiles, config, wc as never)
    await daemon.start()

    // Force an error by making onObservation throw
    mockObservations.set('coder', async () => {
      throw new Error('poll error')
    })

    await daemon.onUserMessage('conv-1', 'crash', [])

    // Wait a few poll cycles — daemon should keep running
    await new Promise((resolve) => setTimeout(resolve, 200))

    expect(daemon.isRunning()).toBe(true)
  })
})
