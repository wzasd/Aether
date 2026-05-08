import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentProfile, Observation } from './a2a-types'
import type { SessionConfig } from './provider'

type MockRuntime = {
  profile: AgentProfile
  isActive: boolean
  start: ReturnType<typeof vi.fn>
  setKnownAgents: ReturnType<typeof vi.fn>
  onObservation: ReturnType<typeof vi.fn>
  abort: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
}

const runtimeInstances: MockRuntime[] = []
let observationHandler: (profile: AgentProfile, observation: Observation) => Promise<{ reply?: string; relevanceScore: number }>

vi.mock('./agent-runtime', () => ({
  AgentRuntime: vi.fn().mockImplementation((profile: AgentProfile) => {
    const runtime: MockRuntime = {
      profile,
      isActive: false,
      start: vi.fn(async () => {
        runtime.isActive = true
        return { id: `session-${profile.id}` }
      }),
      setKnownAgents: vi.fn(),
      onObservation: vi.fn((observation: Observation) => observationHandler(profile, observation)),
      abort: vi.fn(() => {
        runtime.isActive = false
      }),
      dispose: vi.fn(async () => {
        runtime.isActive = false
      })
    }
    runtimeInstances.push(runtime)
    return runtime
  })
}))

vi.mock('../core/db', () => ({
  getDb: vi.fn(() => ({
    prepare: vi.fn(() => ({
      all: vi.fn(() => []),
      get: vi.fn(() => undefined),
      run: vi.fn()
    }))
  }))
}))

vi.mock('../core/logging', () => ({
  writeObservabilityEvent: vi.fn()
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
    updatedAt: 0
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
    updatedAt: 0
  }
]

const config: SessionConfig = {
  providerType: 'test-provider',
  model: 'test-model',
  workingDir: '/tmp/bytro-test',
  permissionMode: 'trusted'
}

function makeWebContents() {
  return {
    isDestroyed: vi.fn(() => false),
    send: vi.fn()
  }
}

function resetOrchestratorState(): void {
  const subject = orchestrator as unknown as {
    runtimes: Map<string, unknown>
    baseConfigs: Map<string, unknown>
    webContentsMap: Map<string, unknown>
    openFloorStates: Map<string, unknown>
    conversationModes: Map<string, unknown>
    openFloorControllers: Map<string, AbortController>
    invocationQueue: { clear: (conversationId: string) => void; stopZombieDefense: () => void }
    getConversationTeamId: unknown
    loadAllEnabledProfiles: unknown
    buildConversationContext: unknown
    appendSystemMessage: unknown
  }

  subject.runtimes.clear()
  subject.baseConfigs.clear()
  subject.webContentsMap.clear()
  subject.openFloorStates.clear()
  subject.conversationModes.clear()
  subject.openFloorControllers.clear()
  subject.invocationQueue.clear('conv-open-floor')
  subject.invocationQueue.clear('conv-empty')
  subject.getConversationTeamId = vi.fn(() => null)
  subject.loadAllEnabledProfiles = vi.fn(() => profiles)
  subject.buildConversationContext = vi.fn(async () => [
    { role: 'user', content: 'prior context' }
  ])
  subject.appendSystemMessage = vi.fn()
}

describe('AgentOrchestrator Open Floor integration', () => {
  beforeEach(() => {
    runtimeInstances.length = 0
    observationHandler = async (profile, observation) => ({
      reply: `${profile.name}: ${observation.message}`,
      relevanceScore: 0.9
    })
    resetOrchestratorState()
    vi.clearAllMocks()
  })

  afterEach(() => {
    resetOrchestratorState()
  })

  afterAll(() => {
    ;(orchestrator as unknown as { invocationQueue: { stopZombieDefense: () => void } })
      .invocationQueue
      .stopZombieDefense()
  })

  it('starts enabled agent runtimes and emits Open Floor events from sendUserMessage', async () => {
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

    expect(runtimeInstances).toHaveLength(2)
    for (const runtime of runtimeInstances) {
      expect(runtime.start).toHaveBeenCalledWith(config)
      expect(runtime.setKnownAgents).toHaveBeenCalledWith(profiles)
      expect(runtime.onObservation).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv-open-floor',
          message: 'brainstorm OAuth2 implementation',
          collaborationMode: 'open_floor'
        })
      )
      expect(runtime.dispose).toHaveBeenCalled()
    }

    expect(webContents.send).toHaveBeenCalledWith(
      'ai:event',
      expect.objectContaining({ type: 'agent_observation', agentProfileId: 'coder' })
    )
    expect(webContents.send).toHaveBeenCalledWith(
      'ai:event',
      expect.objectContaining({ type: 'agent_observation', agentProfileId: 'reviewer' })
    )
    expect(webContents.send).toHaveBeenCalledWith(
      'ai:event',
      expect.objectContaining({ type: 'open_floor_closed', totalResponses: 2, skippedAgents: 0 })
    )
    expect(writeObservabilityEvent).toHaveBeenCalledWith(
      'open_floor:completed',
      expect.objectContaining({ conversationId: 'conv-open-floor', totalResponses: 2 })
    )
  })

  it('stopOpenFloor aborts registered runtimes and closes the discussion early', async () => {
    const webContents = makeWebContents()
    observationHandler = () => new Promise(() => {})

    const openFloor = orchestrator.sendUserMessage(
      'conv-open-floor',
      'coder',
      'stop test',
      config,
      'parallel',
      webContents as never,
      undefined,
      undefined,
      'open_floor'
    )

    await vi.waitFor(() => {
      expect(runtimeInstances).toHaveLength(2)
      expect(runtimeInstances.every((runtime) => runtime.onObservation.mock.calls.length === 1)).toBe(true)
    })

    orchestrator.stopOpenFloor('conv-open-floor')
    await openFloor

    expect(runtimeInstances.every((runtime) => runtime.abort.mock.calls.length === 1)).toBe(true)
    expect(webContents.send).toHaveBeenCalledWith(
      'ai:event',
      expect.objectContaining({ type: 'open_floor_closed', totalResponses: 0 })
    )
    expect(writeObservabilityEvent).toHaveBeenCalledWith(
      'open_floor:stopped',
      { conversationId: 'conv-open-floor' }
    )
  })

  it('handles zero enabled agents without starting runtimes', async () => {
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

    expect(runtimeInstances).toHaveLength(0)
    expect(subject.appendSystemMessage).toHaveBeenCalledWith(
      webContents,
      'conv-empty',
      '没有可用的 Agent 参与讨论'
    )
    expect(webContents.send).not.toHaveBeenCalledWith(
      'ai:event',
      expect.objectContaining({ type: 'agent_observation' })
    )
  })

  it('tracks agents that choose not to reply as skipped', async () => {
    const webContents = makeWebContents()
    observationHandler = async () => ({ reply: undefined, relevanceScore: 0.1 })

    await orchestrator.sendUserMessage(
      'conv-silent',
      'coder',
      'silent test',
      config,
      'parallel',
      webContents as never,
      undefined,
      undefined,
      'open_floor'
    )

    expect(webContents.send).not.toHaveBeenCalledWith(
      'ai:event',
      expect.objectContaining({ type: 'agent_observation' })
    )
    expect(webContents.send).toHaveBeenCalledWith(
      'ai:event',
      expect.objectContaining({
        type: 'open_floor_closed',
        totalResponses: 0,
        skippedAgents: 2,
      })
    )
  })

  it('isolates Open Floor state across multiple conversations', async () => {
    const wcA = makeWebContents()
    const wcB = makeWebContents()

    const promiseA = orchestrator.sendUserMessage(
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

    const promiseB = orchestrator.sendUserMessage(
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

    await Promise.all([promiseA, promiseB])

    // Each conversation should have received its own observations
    expect(wcA.send).toHaveBeenCalledWith(
      'ai:event',
      expect.objectContaining({ conversationId: 'conv-a', type: 'agent_observation' })
    )
    expect(wcB.send).toHaveBeenCalledWith(
      'ai:event',
      expect.objectContaining({ conversationId: 'conv-b', type: 'agent_observation' })
    )

    // Each conversation should have its own closed event
    const closedEventsA = wcA.send.mock.calls.filter(
      (call) => call[1]?.type === 'open_floor_closed'
    )
    const closedEventsB = wcB.send.mock.calls.filter(
      (call) => call[1]?.type === 'open_floor_closed'
    )
    expect(closedEventsA).toHaveLength(1)
    expect(closedEventsB).toHaveLength(1)
  })

  it('recovers gracefully when an agent observation throws', async () => {
    const webContents = makeWebContents()
    let callCount = 0
    observationHandler = async (profile) => {
      callCount++
      if (profile.id === 'coder') {
        throw new Error('Simulated observation failure')
      }
      return { reply: `${profile.name} reply`, relevanceScore: 0.8 }
    }

    await orchestrator.sendUserMessage(
      'conv-error',
      'coder',
      'error test',
      config,
      'parallel',
      webContents as never,
      undefined,
      undefined,
      'open_floor'
    )

    // The non-throwing agent should still produce a response
    expect(webContents.send).toHaveBeenCalledWith(
      'ai:event',
      expect.objectContaining({
        type: 'agent_observation',
        agentProfileId: 'reviewer',
      })
    )

    // The throwing agent should not produce a response
    const coderObservations = webContents.send.mock.calls.filter(
      (call) => call[1]?.type === 'agent_observation' && call[1]?.agentProfileId === 'coder'
    )
    expect(coderObservations).toHaveLength(0)

    // Closed event should show 1 response, 1 skipped
    expect(webContents.send).toHaveBeenCalledWith(
      'ai:event',
      expect.objectContaining({
        type: 'open_floor_closed',
        totalResponses: 1,
        skippedAgents: 1,
      })
    )
  })

  it('overwrites stale Open Floor state when a new one starts in the same conversation', async () => {
    const webContents = makeWebContents()

    // First Open Floor: slow agent that never resolves
    observationHandler = () => new Promise(() => {})
    const firstOpenFloor = orchestrator.sendUserMessage(
      'conv-overwrite',
      'coder',
      'first topic',
      config,
      'parallel',
      webContents as never,
      undefined,
      undefined,
      'open_floor'
    )

    // Wait for first Open Floor to start (runtimes created)
    await vi.waitFor(() => {
      expect(runtimeInstances).toHaveLength(2)
    })

    const firstRuntimes = [...runtimeInstances]

    // Start second Open Floor in the same conversation
    observationHandler = async (profile, observation) => ({
      reply: `${profile.name}: ${observation.message}`,
      relevanceScore: 0.9,
    })
    const secondOpenFloor = orchestrator.sendUserMessage(
      'conv-overwrite',
      'coder',
      'second topic',
      config,
      'parallel',
      webContents as never,
      undefined,
      undefined,
      'open_floor'
    )

    await secondOpenFloor

    // The first Open Floor should have been interrupted (aborted)
    // and the second should complete normally
    expect(runtimeInstances).toHaveLength(4) // 2 from first + 2 from second

    // First runtimes should have been aborted by stopOpenFloor before second started
    for (const runtime of firstRuntimes) {
      expect(runtime.abort).toHaveBeenCalled()
    }

    // Second runtimes should have completed normally (not aborted)
    const secondRuntimes = runtimeInstances.slice(2)
    for (const runtime of secondRuntimes) {
      expect(runtime.dispose).toHaveBeenCalled()
    }

    // Wait for first to finish (it resolves after abort)
    await firstOpenFloor

    // Should have closed events from both (first is aborted, second completes)
    const closedEvents = webContents.send.mock.calls.filter(
      (call) => call[1]?.type === 'open_floor_closed'
    )
    expect(closedEvents.length).toBeGreaterThanOrEqual(1)
  })
})
