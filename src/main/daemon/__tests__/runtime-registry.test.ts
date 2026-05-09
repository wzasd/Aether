import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentProfile, Observation } from '../../ai/a2a-types'
import type { SessionConfig } from '../../ai/provider'

const mockObservations = new Map<string, (obs: Observation) => Promise<{ reply?: string; relevanceScore: number }>>()

vi.mock('../../ai/agent-runtime', () => ({
  AgentRuntime: vi.fn().mockImplementation((profile: AgentProfile) => ({
    profile,
    start: vi.fn(async () => ({ id: `session-${profile.id}` })),
    onObservation: vi.fn(async (obs: Observation) => {
      const handler = mockObservations.get(profile.id)
      return handler ? handler(obs) : { reply: `${profile.name} reply`, relevanceScore: 0.8 }
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

import { RuntimeRegistry } from '../runtime-registry'
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

describe('RuntimeRegistry', () => {
  let registry: RuntimeRegistry

  beforeEach(() => {
    registry = new RuntimeRegistry()
    mockObservations.clear()
    bus.clear()
    // Clear task queue table — our mock db is fresh per module import,
    // but let's also clear bus subscribers that registry may have added
  })

  it('initializes only enabled profiles', async () => {
    const disabledProfile: AgentProfile = {
      ...profiles[0],
      id: 'disabled-agent',
      name: 'Disabled',
      isEnabled: false,
    }

    await registry.initialize([...profiles, disabledProfile], config)

    expect(registry.get('coder')).toBeDefined()
    expect(registry.get('reviewer')).toBeDefined()
    expect(registry.get('disabled-agent')).toBeUndefined()
  })

  it('starts all resident runtimes', async () => {
    await registry.initialize(profiles, config)
    await registry.startAll()

    const active = registry.getAllActive()
    expect(active).toHaveLength(2)
    expect(active.every((r) => r.isActive)).toBe(true)
  })

  it('get returns undefined for unknown profile', () => {
    expect(registry.get('unknown')).toBeUndefined()
  })

  it('getAllActive returns only active runtimes', async () => {
    await registry.initialize(profiles, config)
    expect(registry.getAllActive()).toHaveLength(0)

    await registry.startAll()
    expect(registry.getAllActive()).toHaveLength(2)
  })

  it('claimAndExecute completes a task and publishes reply', async () => {
    await registry.initialize(profiles, config)
    await registry.startAll()

    const replyHandler = vi.fn()
    bus.subscribe('message:reply', replyHandler)

    // Enqueue a task
    const task = taskQueue.enqueue({
      conversationId: 'conv-1',
      agentProfileId: 'coder',
      message: 'implement auth',
    })

    mockObservations.set('coder', async () => ({
      reply: 'Use OAuth2 with PKCE',
      relevanceScore: 0.9,
    }))

    await registry.claimAndExecute('coder')

    expect(replyHandler).toHaveBeenCalledTimes(1)
    expect(replyHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'message:reply',
        actorId: 'coder',
        payload: expect.objectContaining({
          content: 'Use OAuth2 with PKCE',
          relevanceScore: 0.9,
        }),
      })
    )
  })

  it('claimAndExecute handles NO_REPLY from agent', async () => {
    await registry.initialize(profiles, config)
    await registry.startAll()

    const replyHandler = vi.fn()
    bus.subscribe('message:reply', replyHandler)

    taskQueue.enqueue({
      conversationId: 'conv-1',
      agentProfileId: 'reviewer',
      message: 'review this code',
    })

    mockObservations.set('reviewer', async () => ({
      reply: undefined,
      relevanceScore: 0.2,
    }))

    await registry.claimAndExecute('reviewer')

    // No message:reply should be published for NO_REPLY
    expect(replyHandler).not.toHaveBeenCalled()
  })

  it('claimAndExecute handles agent observation errors gracefully', async () => {
    await registry.initialize(profiles, config)
    await registry.startAll()

    const thinkingHandler = vi.fn()
    bus.subscribe('agent:thinking', thinkingHandler)

    taskQueue.enqueue({
      conversationId: 'conv-1',
      agentProfileId: 'coder',
      message: 'crash me',
    })

    mockObservations.set('coder', async () => {
      throw new Error('Simulated LLM failure')
    })

    // Should not throw
    await expect(registry.claimAndExecute('coder')).resolves.not.toThrow()

    // Task should be marked failed in DB (checked via getConversationTasks)
    const tasks = taskQueue.getConversationTasks('conv-1')
    expect(tasks).toHaveLength(1)
    expect(tasks[0].status).toBe('failed')
    expect(tasks[0].error).toBe('Simulated LLM failure')
  })

  it('publishes agent:thinking before executing', async () => {
    await registry.initialize(profiles, config)
    await registry.startAll()

    const thinkingHandler = vi.fn()
    bus.subscribe('agent:thinking', thinkingHandler)

    taskQueue.enqueue({
      conversationId: 'conv-1',
      agentProfileId: 'coder',
      message: 'do something',
    })

    await registry.claimAndExecute('coder')

    expect(thinkingHandler).toHaveBeenCalledTimes(1)
    expect(thinkingHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'agent:thinking',
        actorId: 'coder',
        payload: expect.objectContaining({
          agentName: 'Coder',
          agentRole: 'coder',
        }),
      })
    )
  })

  it('enqueues follow-up tasks when other agents reply', async () => {
    await registry.initialize(profiles, config)
    await registry.startAll()

    // Simulate another agent replying
    bus.publish({
      type: 'message:reply',
      conversationId: 'conv-1',
      actorType: 'agent',
      actorId: 'reviewer',
      payload: {
        agentName: 'Reviewer',
        content: 'I think we should use JWT instead',
      },
    })

    // Coder should have a follow-up task enqueued
    const pending = taskQueue.countPending('coder')
    expect(pending).toBeGreaterThanOrEqual(1)
  })

  it('does not enqueue follow-up for own replies', async () => {
    await registry.initialize(profiles, config)
    await registry.startAll()

    // Clear any initial state
    const initialPending = taskQueue.countPending('coder')

    // Coder replies — coder should not get a follow-up to itself
    bus.publish({
      type: 'message:reply',
      conversationId: 'conv-1',
      actorType: 'agent',
      actorId: 'coder',
      payload: {
        agentName: 'Coder',
        content: 'My own reply',
      },
    })

    // Pending count should not increase (or increase only by initial state)
    const afterPending = taskQueue.countPending('coder')
    expect(afterPending).toBe(initialPending)
  })

  it('stops all runtimes on stopAll', async () => {
    await registry.initialize(profiles, config)
    await registry.startAll()
    expect(registry.getAllActive()).toHaveLength(2)

    await registry.stopAll()

    expect(registry.getAllActive()).toHaveLength(0)
  })

  it('ignores claimAndExecute for unknown or inactive profiles', async () => {
    // Not initialized
    await expect(registry.claimAndExecute('unknown')).resolves.not.toThrow()

    // Initialize but don't start
    await registry.initialize(profiles, config)
    await expect(registry.claimAndExecute('coder')).resolves.not.toThrow()
  })
})
