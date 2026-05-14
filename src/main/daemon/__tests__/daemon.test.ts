import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AgentProfile } from '../../ai/a2a-types'
import type { SessionConfig } from '../../ai/provider'

const mockObservations = new Map<string, (obs: { message: string; conversationId: string }) => Promise<{ reply?: string; relevanceScore: number }>>()
const mockMemoryDistiller = vi.hoisted(() => ({
  distillChain: vi.fn(),
  persistToMemoryPalace: vi.fn(),
}))

// Hoist mock values so they're available when vi.mock() factories execute
const { mockAppPaths, mockSecretsBackend } = vi.hoisted(() => {
  const mockAppPaths = {
    dataDir: '/tmp/bytro-test/data',
    logDir: '/tmp/bytro-test/logs',
    homeDir: '/tmp/bytro-test/home',
    documentsDir: '/tmp/bytro-test/home/Documents',
    desktopDir: '/tmp/bytro-test/home/Desktop',
    downloadsDir: '/tmp/bytro-test/home/Downloads',
    tempDir: '/tmp/bytro-test/tmp',
  }

  const mockSecretsBackend = {
    backendName: 'key-file',
    encrypt: vi.fn((value: string) => Buffer.from(value)),
    decrypt: vi.fn((encrypted: Buffer) => encrypted.toString('utf8')),
    isAvailable: vi.fn(() => true),
  }

  return { mockAppPaths, mockSecretsBackend }
})

// Mock Electron-specific modules so Daemon adapter can run without Electron
vi.mock('../../core/app-paths', () => ({
  createElectronAppPaths: vi.fn(() => mockAppPaths),
}))

vi.mock('../../core/secrets-backend', () => ({
  createSecretsBackend: vi.fn(() => mockSecretsBackend),
  ElectronSafeStorageBackend: vi.fn(),
  KeyFileSecretsBackend: vi.fn(),
}))

vi.mock('../../ai/agent-runtime', () => ({
  AgentRuntime: vi.fn().mockImplementation((profile: AgentProfile) => ({
    profile,
    start: vi.fn(async () => ({ id: `session-${profile.id}` })),
    onObservation: vi.fn(async (obs: { message: string; conversationId: string }) => {
      const handler = mockObservations.get(profile.id)
      return handler ? handler(obs) : { reply: `${profile.name} says: ${obs.message}`, relevanceScore: 0.8 }
    }),
    abort: vi.fn(),
    suspend: vi.fn(),
    resume: vi.fn(async () => ({ id: `session-${profile.id}` })),
    isSuspended: false,
    dispose: vi.fn(async () => {}),
    setKnownAgents: vi.fn(),
  })),
}))

vi.mock('../../core/db')

vi.mock('../../core/logging', () => ({
  writeObservabilityEvent: vi.fn(),
}))

vi.mock('../../ai/a2a-memory-distiller', () => ({
  A2AMemoryDistiller: vi.fn().mockImplementation(() => mockMemoryDistiller),
}))

vi.mock('../sse-broadcaster', () => ({
  sseBroadcaster: {
    setWebContents: vi.fn(),
    broadcast: vi.fn(),
    broadcastAIEvent: vi.fn(),
  },
}))

vi.mock('../renderer-api', () => ({
  getRendererApiServer: vi.fn(() => ({
    start: vi.fn(async () => 5175),
    stop: vi.fn(async () => {}),
    broadcast: vi.fn(),
    setDaemon: vi.fn(),
  })),
}))

vi.mock('../bridge-api', () => ({
  getBridgeApiServer: vi.fn(() => ({
    start: vi.fn(async () => 5174),
    stop: vi.fn(async () => {}),
  })),
}))

vi.mock('../bridge-config', () => ({
  cleanupBridgeConfig: vi.fn(),
}))

vi.mock('../action-cards/executor-registry', () => ({
  registerExecutor: vi.fn(),
  expireActionCards: vi.fn(() => ({ expired: 0, recovered: 0 })),
}))

vi.mock('../init-agent-memory', () => ({
  initAgentMemory: vi.fn(async () => {}),
}))

import { Daemon } from '../daemon'
import { bus } from '../event-bus'
import { taskQueue } from '../task-queue'
import { runtimeRegistry } from '../runtime-registry'
import { resetMockDb } from '../../core/__mocks__/db'

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

describe('Daemon (Electron adapter)', () => {
  let daemon: Daemon

  beforeEach(() => {
    daemon = new Daemon({ pollIntervalMs: 50 })
    daemon.init() // Must call init() after construction — creates DaemonCore
    mockObservations.clear()
    bus.clear()
    vi.clearAllMocks()
    resetMockDb()
    runtimeRegistry.resetAllTracking()
    mockMemoryDistiller.distillChain.mockResolvedValue(null)
    mockMemoryDistiller.persistToMemoryPalace.mockResolvedValue(0)
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

    // Both agents should have tasks (may be pending, claimed, or running due to wakeup)
    const coderTasks = taskQueue.getConversationTasks('conv-1').filter((t) => t.agentProfileId === 'coder')
    const reviewerTasks = taskQueue.getConversationTasks('conv-1').filter((t) => t.agentProfileId === 'reviewer')
    expect(coderTasks.length).toBeGreaterThanOrEqual(1)
    expect(reviewerTasks.length).toBeGreaterThanOrEqual(1)
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

  it('publishes conversation:completed and runs memory distillation after all tasks finish', async () => {
    const wc = makeWebContents()
    await daemon.initialize(profiles.slice(0, 1), config, wc as never)
    await daemon.start()

    const completedHandler = vi.fn()
    bus.subscribe('conversation:completed', completedHandler)

    const distillate = {
      conversationId: 'conv-1',
      agentChain: ['coder'],
      taskCount: 1,
      maxDepth: 0,
      decisionPoints: [],
      conventions: [],
      failures: [],
    }
    mockMemoryDistiller.distillChain.mockResolvedValue(distillate)
    mockMemoryDistiller.persistToMemoryPalace.mockResolvedValue(1)

    mockObservations.set('coder', async () => ({
      reply: 'Coder reply',
      relevanceScore: 0.9,
    }))

    await daemon.onUserMessage('conv-1', 'test message', [])

    await vi.waitFor(() => {
      expect(completedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'conversation:completed',
          conversationId: 'conv-1',
        })
      )
    }, { timeout: 2000 })

    await vi.waitFor(() => {
      expect(mockMemoryDistiller.distillChain).toHaveBeenCalledWith('conv-1')
      expect(mockMemoryDistiller.persistToMemoryPalace).toHaveBeenCalledWith(distillate)
    }, { timeout: 2000 })
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
    mockObservations.set('reviewer', async () => ({
      reply: 'Reviewer reply',
      relevanceScore: 0.7,
    }))

    await daemon.onUserMessage('conv-1', 'test message', [])

    // Wait for poll loop to pick up and execute the tasks
    await vi.waitFor(() => {
      expect(replyHandler).toHaveBeenCalled()
    }, { timeout: 2000 })

    // At least one agent should have replied
    const calls = replyHandler.mock.calls.map((call: unknown[]) => call[0] as Record<string, unknown>)
    const hasReply = calls.some(
      (call) => call.type === 'message:reply' && typeof call.payload === 'object' && call.payload !== null && 'content' in (call.payload as Record<string, unknown>)
    )
    expect(hasReply).toBe(true)
  })

  it('cancels tasks on abortConversation', async () => {
    const wc = makeWebContents()
    await daemon.initialize(profiles, config, wc as never)
    await daemon.start()

    await daemon.onUserMessage('conv-1', 'test', [])
    const tasksBefore = taskQueue.getConversationTasks('conv-1')
    expect(tasksBefore.length).toBeGreaterThanOrEqual(1)

    daemon.abortConversation('conv-1')

    // After abort, no tasks should be in active states
    const tasksAfter = taskQueue.getConversationTasks('conv-1')
    const activeStatuses = new Set(['pending', 'claimed', 'running'])
    const hasActiveTasks = tasksAfter.some((t) => activeStatuses.has(t.status))
    expect(hasActiveTasks).toBe(false)
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

    // conv-b tasks should still exist and not be cancelled
    const convBTasks = taskQueue.getConversationTasks('conv-b')
    expect(convBTasks.length).toBeGreaterThanOrEqual(1)
    expect(convBTasks.every((t) => t.status !== 'cancelled')).toBe(true)
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
    const tasks = taskQueue.getConversationTasks('conv-1')
    expect(tasks.length).toBe(0)
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

  it('wires sseBroadcaster with webContents on start', async () => {
    const wc = makeWebContents()
    await daemon.initialize(profiles, config, wc as never)
    await daemon.start()

    // The adapter should wire webContents to sseBroadcaster
    const { sseBroadcaster } = await import('../sse-broadcaster')
    expect(sseBroadcaster.setWebContents).toHaveBeenCalledWith(wc)
  })

  it('disconnects sseBroadcaster on stop', async () => {
    const wc = makeWebContents()
    await daemon.initialize(profiles, config, wc as never)
    await daemon.start()

    await daemon.stop()

    const { sseBroadcaster } = await import('../sse-broadcaster')
    expect(sseBroadcaster.setWebContents).toHaveBeenCalledWith(null)
  })
})

describe('Daemon init wiring', () => {
  it('creates DaemonCore with Electron-specific config after init()', async () => {
    // Create a fresh Daemon instance — init() calls createElectronAppPaths + createSecretsBackend
    const daemon = new Daemon({ pollIntervalMs: 50 })
    daemon.init()

    const { createElectronAppPaths } = await import('../../core/app-paths')
    const { createSecretsBackend } = await import('../../core/secrets-backend')

    // init() should have called these
    expect(createElectronAppPaths).toHaveBeenCalled()
    expect(createSecretsBackend).toHaveBeenCalledWith({
      preferElectronSafeStorage: true,
      dataDir: mockAppPaths.dataDir,
    })

    await daemon.stop()
  })
})