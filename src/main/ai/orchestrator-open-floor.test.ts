import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentProfile } from './a2a-types'
import type { SessionConfig } from './provider'

// ─── Mock Daemon ───────────────────────────────────────────────────────────
const { mockDaemon } = vi.hoisted(() => ({
  mockDaemon: {
    isRunning: vi.fn(() => false),
    initialize: vi.fn(async () => {}),
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    onUserMessage: vi.fn(async () => {}),
    abortConversation: vi.fn(),
  },
}))

vi.mock('../daemon/daemon', () => ({
  daemon: mockDaemon,
}))

// ─── Mock EventBus ─────────────────────────────────────────────────────────
const { mockBus } = vi.hoisted(() => {
  class MockBus {
    private handlers = new Map<string, Array<(e: unknown) => void>>()

    subscribe = vi.fn((type: string, handler: (e: unknown) => void): void => {
      const list = this.handlers.get(type) ?? []
      list.push(handler)
      this.handlers.set(type, list)
    })

    unsubscribe = vi.fn((type: string, handler: (e: unknown) => void): void => {
      const list = this.handlers.get(type)
      if (!list) return
      const idx = list.indexOf(handler)
      if (idx >= 0) list.splice(idx, 1)
    })

    publish = vi.fn((event: Record<string, unknown>): void => {
      const list = this.handlers.get(event.type as string) ?? []
      for (const h of list) h(event)
    })

    clear(): void {
      this.handlers.clear()
    }

    getHandlerCount(type: string): number {
      return this.handlers.get(type)?.length ?? 0
    }
  }

  return { mockBus: new MockBus() }
})

vi.mock('../daemon/event-bus', () => ({
  bus: mockBus,
}))

// ─── Mock DB & Logging ─────────────────────────────────────────────────────
vi.mock('../core/db', () => ({
  getDb: vi.fn(() => ({
    prepare: vi.fn(() => ({
      all: vi.fn(() => []),
      get: vi.fn(() => undefined),
      run: vi.fn(),
    })),
  })),
}))

vi.mock('../core/logging', () => ({
  writeObservabilityEvent: vi.fn(),
}))

import { writeObservabilityEvent } from '../core/logging'
import { orchestrator } from './orchestrator'

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

function resetOrchestratorState(): void {
  const subject = orchestrator as unknown as {
    openFloorStates: Map<string, unknown>
    conversationModes: Map<string, unknown>
    webContentsMap: Map<string, unknown>
    baseConfigs: Map<string, unknown>
    openFloorCleanups: Map<string, unknown>
    invocationQueue: { clear: (conversationId: string) => void; stopZombieDefense: () => void }
    getConversationTeamId: unknown
    loadAllEnabledProfiles: unknown
    buildConversationContext: unknown
    appendSystemMessage: unknown
  }

  subject.openFloorStates.clear()
  subject.conversationModes.clear()
  subject.webContentsMap.clear()
  subject.baseConfigs.clear()
  subject.openFloorCleanups.clear()
  subject.invocationQueue.clear('conv-open-floor')
  subject.invocationQueue.clear('conv-empty')
  subject.invocationQueue.clear('conv-a')
  subject.invocationQueue.clear('conv-b')
  subject.getConversationTeamId = vi.fn(() => null)
  subject.loadAllEnabledProfiles = vi.fn(() => profiles)
  subject.buildConversationContext = vi.fn(async () => [
    { role: 'user', content: 'prior context' },
  ])
  subject.appendSystemMessage = vi.fn()
}

describe('AgentOrchestrator Open Floor (Daemon architecture)', () => {
  beforeEach(() => {
    resetOrchestratorState()
    mockBus.clear()
    vi.clearAllMocks()
    mockDaemon.isRunning.mockReturnValue(false)
  })

  afterEach(() => {
    resetOrchestratorState()
  })

  afterAll(() => {
    ;(orchestrator as unknown as { invocationQueue: { stopZombieDefense: () => void } })
      .invocationQueue
      .stopZombieDefense()
  })

  it('initializes daemon on first open_floor message and routes through it', async () => {
    const webContents = makeWebContents()

    await orchestrator.sendUserMessage(
      'conv-open-floor',
      'coder',
      'brainstorm OAuth2 implementation',
      config,
      'serial',
      webContents as never,
      undefined,
      undefined,
      'open_floor'
    )

    // Should initialize and start daemon
    expect(mockDaemon.isRunning).toHaveBeenCalled()
    expect(mockDaemon.initialize).toHaveBeenCalledWith(profiles, config, webContents)
    expect(mockDaemon.start).toHaveBeenCalled()

    // Should route message through daemon
    expect(mockDaemon.onUserMessage).toHaveBeenCalledWith(
      'conv-open-floor',
      'brainstorm OAuth2 implementation',
      expect.arrayContaining([expect.objectContaining({ role: 'user' })])
    )
  })

  it('does not reinitialize daemon if already running', async () => {
    const webContents = makeWebContents()
    mockDaemon.isRunning.mockReturnValue(true)

    await orchestrator.sendUserMessage(
      'conv-open-floor',
      'coder',
      'second message',
      config,
      'serial',
      webContents as never,
      undefined,
      undefined,
      'open_floor'
    )

    expect(mockDaemon.initialize).not.toHaveBeenCalled()
    expect(mockDaemon.start).not.toHaveBeenCalled()
    expect(mockDaemon.onUserMessage).toHaveBeenCalledWith(
      'conv-open-floor',
      'second message',
      expect.anything()
    )
  })

  it('aborts previous discussion before starting a new one in same conversation', async () => {
    const webContents = makeWebContents()

    // First open floor
    await orchestrator.sendUserMessage(
      'conv-open-floor',
      'coder',
      'first topic',
      config,
      'serial',
      webContents as never,
      undefined,
      undefined,
      'open_floor'
    )

    // Manually set state to active to simulate an ongoing discussion
    const subject = orchestrator as unknown as { openFloorStates: Map<string, { status: string }> }
    subject.openFloorStates.set('conv-open-floor', { status: 'active' })

    // Second open floor in same conversation
    await orchestrator.sendUserMessage(
      'conv-open-floor',
      'coder',
      'second topic',
      config,
      'serial',
      webContents as never,
      undefined,
      undefined,
      'open_floor'
    )

    expect(mockDaemon.abortConversation).toHaveBeenCalledWith('conv-open-floor')
  })

  it('does NOT subscribe to agent:thinking bus events (feature removed)', async () => {
    const webContents = makeWebContents()

    await orchestrator.sendUserMessage(
      'conv-open-floor',
      'coder',
      'test',
      config,
      'serial',
      webContents as never,
      undefined,
      undefined,
      'open_floor'
    )

    // agent:thinking bus subscription was removed — no handler should be registered
    const handlerCount = mockBus.getHandlerCount('agent:thinking')
    expect(handlerCount).toBe(0)

    // Publishing agent:thinking should NOT forward to frontend
    mockBus.publish({
      type: 'agent:thinking',
      conversationId: 'conv-open-floor',
      actorType: 'agent',
      actorId: 'coder',
      payload: { agentName: 'Coder', agentRole: 'coder' },
    })

    const thinkingCalls = webContents.send.mock.calls.filter(
      (call) => call[1]?.type === 'agent_thinking'
    )
    expect(thinkingCalls).toHaveLength(0)
  })

  it('forwards message:reply events to frontend as agent_observation', async () => {
    const webContents = makeWebContents()

    await orchestrator.sendUserMessage(
      'conv-open-floor',
      'coder',
      'test',
      config,
      'serial',
      webContents as never,
      undefined,
      undefined,
      'open_floor'
    )

    // Simulate daemon publishing message:reply event
    mockBus.publish({
      type: 'message:reply',
      conversationId: 'conv-open-floor',
      actorType: 'agent',
      actorId: 'reviewer',
      payload: {
        agentName: 'Reviewer',
        content: 'Use JWT instead',
        relevanceScore: 0.85,
      },
    })

    expect(webContents.send).toHaveBeenCalledWith(
      'ai:event',
      expect.objectContaining({
        type: 'agent_observation',
        conversationId: 'conv-open-floor',
        agentProfileId: 'reviewer',
        agentName: 'Reviewer',
        content: 'Use JWT instead',
        relevanceScore: 0.85,
      })
    )
  })

  it('tracks responses in open floor state', async () => {
    const webContents = makeWebContents()

    await orchestrator.sendUserMessage(
      'conv-open-floor',
      'coder',
      'test',
      config,
      'serial',
      webContents as never,
      undefined,
      undefined,
      'open_floor'
    )

    // Simulate two replies
    mockBus.publish({
      type: 'message:reply',
      conversationId: 'conv-open-floor',
      actorType: 'agent',
      actorId: 'coder',
      payload: { agentName: 'Coder', content: 'Reply A', relevanceScore: 0.9 },
    })
    mockBus.publish({
      type: 'message:reply',
      conversationId: 'conv-open-floor',
      actorType: 'agent',
      actorId: 'reviewer',
      payload: { agentName: 'Reviewer', content: 'Reply B', relevanceScore: 0.8 },
    })

    const subject = orchestrator as unknown as { openFloorStates: Map<string, { responses: Array<unknown> }> }
    const state = subject.openFloorStates.get('conv-open-floor')!
    expect(state.responses).toHaveLength(2)
    expect(state.responses[0]).toMatchObject({ agentId: 'coder', content: 'Reply A' })
    expect(state.responses[1]).toMatchObject({ agentId: 'reviewer', content: 'Reply B' })
  })

  it('sends open_floor_closed when daemon emits open_floor:closed', async () => {
    const webContents = makeWebContents()

    await orchestrator.sendUserMessage(
      'conv-open-floor',
      'coder',
      'test',
      config,
      'serial',
      webContents as never,
      undefined,
      undefined,
      'open_floor'
    )

    // Simulate a reply then close
    mockBus.publish({
      type: 'message:reply',
      conversationId: 'conv-open-floor',
      actorType: 'agent',
      actorId: 'coder',
      payload: { agentName: 'Coder', content: 'Done', relevanceScore: 0.9 },
    })

    mockBus.publish({
      type: 'open_floor:closed',
      conversationId: 'conv-open-floor',
      actorType: 'system',
      actorId: null,
      payload: { reason: 'all_tasks_complete' },
    })

    expect(webContents.send).toHaveBeenCalledWith(
      'ai:event',
      expect.objectContaining({
        type: 'open_floor_closed',
        conversationId: 'conv-open-floor',
        totalResponses: 1,
        skippedAgents: 0,
      })
    )

    // State should be closed
    const subject = orchestrator as unknown as { openFloorStates: Map<string, { status: string }> }
    expect(subject.openFloorStates.get('conv-open-floor')?.status).toBe('closed')
  })

  it('unsubscribes from bus when open_floor closes', async () => {
    const webContents = makeWebContents()

    await orchestrator.sendUserMessage(
      'conv-open-floor',
      'coder',
      'test',
      config,
      'serial',
      webContents as never,
      undefined,
      undefined,
      'open_floor'
    )

    // agent:thinking subscription removed — only message:reply and open_floor:closed remain
    const thinkingCount = mockBus.getHandlerCount('agent:thinking')
    expect(thinkingCount).toBe(0)

    const replyCount = mockBus.getHandlerCount('message:reply')
    expect(replyCount).toBeGreaterThan(0)

    mockBus.publish({
      type: 'open_floor:closed',
      conversationId: 'conv-open-floor',
      actorType: 'system',
      actorId: null,
      payload: {},
    })

    expect(mockBus.unsubscribe).toHaveBeenCalledWith('message:reply', expect.any(Function))
    expect(mockBus.unsubscribe).toHaveBeenCalledWith('open_floor:closed', expect.any(Function))
  })

  it('isolates events across multiple conversations', async () => {
    const wcA = makeWebContents()
    const wcB = makeWebContents()

    await orchestrator.sendUserMessage(
      'conv-a',
      'coder',
      'topic A',
      config,
      'parallel',
      wcA as never,
      undefined,
      undefined,
      'open_floor'
    )

    await orchestrator.sendUserMessage(
      'conv-b',
      'coder',
      'topic B',
      config,
      'parallel',
      wcB as never,
      undefined,
      undefined,
      'open_floor'
    )

    // Simulate reply for conv-a only
    mockBus.publish({
      type: 'message:reply',
      conversationId: 'conv-a',
      actorType: 'agent',
      actorId: 'coder',
      payload: { agentName: 'Coder', content: 'Reply A', relevanceScore: 0.9 },
    })

    // Only wcA should receive the observation
    expect(wcA.send).toHaveBeenCalledWith(
      'ai:event',
      expect.objectContaining({ type: 'agent_observation', conversationId: 'conv-a' })
    )
    expect(wcB.send).not.toHaveBeenCalledWith(
      'ai:event',
      expect.objectContaining({ type: 'agent_observation', conversationId: 'conv-a' })
    )
  })

  it('handles zero enabled agents gracefully', async () => {
    const subject = orchestrator as unknown as {
      loadAllEnabledProfiles: ReturnType<typeof vi.fn>
      appendSystemMessage: ReturnType<typeof vi.fn>
    }
    subject.loadAllEnabledProfiles.mockReturnValue([])
    const webContents = makeWebContents()

    await orchestrator.sendUserMessage(
      'conv-empty',
      'coder',
      'anyone there?',
      config,
      'serial',
      webContents as never,
      undefined,
      undefined,
      'open_floor'
    )

    // Daemon should still be initialized with empty profiles
    expect(mockDaemon.initialize).toHaveBeenCalledWith([], config, webContents)
    expect(mockDaemon.onUserMessage).toHaveBeenCalled()
  })

  it('ignores events for wrong conversation', async () => {
    const webContents = makeWebContents()

    await orchestrator.sendUserMessage(
      'conv-open-floor',
      'coder',
      'test',
      config,
      'serial',
      webContents as never,
      undefined,
      undefined,
      'open_floor'
    )

    // Publish event for a different conversation
    mockBus.publish({
      type: 'message:reply',
      conversationId: 'other-conv',
      actorType: 'agent',
      actorId: 'coder',
      payload: { agentName: 'Coder', content: 'Wrong conv', relevanceScore: 0.9 },
    })

    // Should not forward to frontend
    const observationCalls = webContents.send.mock.calls.filter(
      (call) => call[1]?.type === 'agent_observation'
    )
    expect(observationCalls).toHaveLength(0)
  })

  it('does not break when webContents is destroyed', async () => {
    const webContents = makeWebContents()
    webContents.isDestroyed.mockReturnValue(true)

    await orchestrator.sendUserMessage(
      'conv-open-floor',
      'coder',
      'test',
      config,
      'serial',
      webContents as never,
      undefined,
      undefined,
      'open_floor'
    )

    // Simulate events — should not throw even though webContents is destroyed
    expect(() => {
      mockBus.publish({
        type: 'agent:thinking',
        conversationId: 'conv-open-floor',
        actorType: 'agent',
        actorId: 'coder',
        payload: { agentName: 'Coder' },
      })
      mockBus.publish({
        type: 'message:reply',
        conversationId: 'conv-open-floor',
        actorType: 'agent',
        actorId: 'coder',
        payload: { agentName: 'Coder', content: 'Reply', relevanceScore: 0.9 },
      })
    }).not.toThrow()

    // Nothing sent to destroyed webContents
    expect(webContents.send).not.toHaveBeenCalled()
  })

  it('cleans up old bus handlers when restarting open floor in same conversation', async () => {
    const webContents = makeWebContents()

    // First open floor
    await orchestrator.sendUserMessage(
      'conv-open-floor',
      'coder',
      'first topic',
      config,
      'serial',
      webContents as never,
      undefined,
      undefined,
      'open_floor'
    )

    const handlerCountAfterFirst = mockBus.getHandlerCount('message:reply')

    // Manually set state to active to simulate an ongoing discussion
    const subject = orchestrator as unknown as { openFloorStates: Map<string, { status: string }> }
    subject.openFloorStates.set('conv-open-floor', { status: 'active' })

    // Second open floor in same conversation — should clean up old handlers
    await orchestrator.sendUserMessage(
      'conv-open-floor',
      'coder',
      'second topic',
      config,
      'serial',
      webContents as never,
      undefined,
      undefined,
      'open_floor'
    )

    const handlerCountAfterSecond = mockBus.getHandlerCount('message:reply')

    // Handler count should stay the same (old unsubscribed, new subscribed)
    expect(handlerCountAfterSecond).toBe(handlerCountAfterFirst)

    // Publishing a reply should only trigger ONE frontend event
    mockBus.publish({
      type: 'message:reply',
      conversationId: 'conv-open-floor',
      actorType: 'agent',
      actorId: 'coder',
      payload: { agentName: 'Coder', content: 'Only once', relevanceScore: 0.9 },
    })

    const observationCalls = webContents.send.mock.calls.filter(
      (call) => call[1]?.type === 'agent_observation' && call[1]?.content === 'Only once'
    )
    expect(observationCalls).toHaveLength(1)
  })
})
