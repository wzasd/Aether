/**
 * DaemonCore — unified daemon orchestrator with zero Electron imports.
 *
 * This is the Step 3 (ADR-017) core class. All previously-Electron-resolved
 * dependencies (paths, secrets, webContents) are injected via DaemonCoreConfig.
 *
 * The existing `Daemon` class becomes an adapter that wraps DaemonCore
 * and provides the Electron-specific wiring (WebContents, app.getPath, etc.)
 */

import { bus } from './event-bus'
import { taskQueue } from './task-queue'
import { runtimeRegistry } from './runtime-registry'
import { agentMemory, type MemoryEntry } from './agent-memory'
import { initAgentMemory } from './init-agent-memory'
import type { SessionConfig } from '../ai/provider'
import type { AgentProfile } from '../ai/a2a-types'
import { A2AMemoryDistiller } from '../ai/a2a-memory-distiller'
import { writeObservabilityEvent } from '../core/logging'
import { expireActionCards, registerExecutor } from '../action-cards/executor-registry'
import { memoryActivateExecutor } from '../action-cards/executors/memory-activate-executor'
import { memoryBulkActivateExecutor } from '../action-cards/executors/memory-bulk-activate-executor'
import { getBridgeApiServer } from './bridge-api'
import { cleanupBridgeConfig } from './bridge-config'
import { getRendererApiServer } from './renderer-api'
import { sseBroadcaster } from './sse-broadcaster'
import type { AppPaths } from '../core/app-paths'
import type { SecretsBackend } from '../core/secrets-backend'

export interface DaemonCoreConfig {
  /** Resolved filesystem paths (replaces app.getPath calls) */
  readonly paths: AppPaths
  /** Encryption backend (replaces safeStorage) */
  readonly secrets: SecretsBackend
  /** Renderer API port (default 5175, configurable via env var) */
  readonly rendererPort: number
  /** Whether to run in headless mode (no Electron shell) */
  readonly headless: boolean
  /** Max concurrent tasks per agent */
  readonly maxConcurrentTasks: number
  /** Task polling interval in ms */
  readonly pollIntervalMs: number
  /** Daemon heartbeat interval in ms (separate from SSE keepalive at 15s) */
  readonly daemonHeartbeatIntervalMs: number
}

const DEFAULT_CORE_CONFIG: Partial<DaemonCoreConfig> = {
  maxConcurrentTasks: 3,
  pollIntervalMs: 500,
  daemonHeartbeatIntervalMs: 30000,
  headless: false,
}

export class DaemonCore {
  private config: DaemonCoreConfig
  private profiles: AgentProfile[] = []
  private baseConfig: SessionConfig | null = null

  private running = false
  private abortController: AbortController | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private trackedConversations = new Set<string>()
  private memoryDistiller = new A2AMemoryDistiller()

  constructor(config: DaemonCoreConfig) {
    this.config = { ...DEFAULT_CORE_CONFIG, ...config } as DaemonCoreConfig
  }

  /** Initialize the daemon core with profiles and config */
  async initialize(
    profiles: AgentProfile[],
    baseConfig: SessionConfig
  ): Promise<void> {
    this.profiles = profiles
    this.baseConfig = baseConfig

    await runtimeRegistry.initialize(profiles, baseConfig)
    console.info('[DaemonCore] initialized with', profiles.length, 'profiles')
  }

  /** Start the daemon core — all resident runtimes + polling loops */
  async start(): Promise<void> {
    if (this.running) return
    this.running = true
    this.abortController = new AbortController()

    try {
      // Clean up stale tasks from previous sessions
      taskQueue.clearStaleTasks()

      // Register action card executors
      registerExecutor('memory:activate', memoryActivateExecutor)
      registerExecutor('memory:bulk_activate', memoryBulkActivateExecutor)

      // Start Bridge API Server for MCP chat-bridge sidecars (ADR-015)
      const bridgeApi = getBridgeApiServer()
      const bridgePort = await bridgeApi.start()
      console.info('[DaemonCore] Bridge API server started on port', bridgePort)

      // Start Renderer API Server for frontend communication (ADR-016)
      const rendererApi = getRendererApiServer()
      const rendererPort = await rendererApi.start(this.config.rendererPort)
      console.info('[DaemonCore] Renderer API server started on port', rendererPort)

      // Wire Renderer API Server with daemon core for endpoint wiring
      rendererApi.setDaemon(this)

      // Clean up stale bridge configs from previous sessions
      for (const profile of this.profiles) {
        cleanupBridgeConfig(profile.id)
      }

      const expiryResult = expireActionCards()
      if (expiryResult.expired > 0 || expiryResult.recovered > 0) {
        console.info('[DaemonCore] action card cleanup:', expiryResult)
      }

      // Proactively initialize MEMORY.md for all enabled agents
      await initAgentMemory(this.profiles)

      // Start all resident runtimes
      await runtimeRegistry.startAll()

      // Start task polling loop
      this.pollTimer = setInterval(() => {
        this.pollTasks().catch((err) => {
          console.error('[DaemonCore] pollTasks error:', err)
        })
      }, this.config.pollIntervalMs)

      // Start daemon heartbeat (separate from SSE keepalive at 15s)
      this.heartbeatTimer = setInterval(() => {
        this.heartbeat()
      }, this.config.daemonHeartbeatIntervalMs)

      // Subscribe to system events
      bus.subscribe('system:abort', (event) => {
        console.info('[DaemonCore] abort received for conversation:', event.conversationId)
        this.abortConversation(event.conversationId)
      })
      bus.subscribe('conversation:completed', (event) => {
        this.handleConversationCompleted(event.conversationId).catch((err) => {
          const error = err instanceof Error ? err.message : String(err)
          writeObservabilityEvent('memory_distill:failed', {
            conversationId: event.conversationId,
            error,
          })
          console.warn('[DaemonCore] memory distill failed:', event.conversationId, err)
        })
      })

      writeObservabilityEvent('daemon_core:started', {
        headless: this.config.headless,
        rendererPort,
        bridgePort,
      })
      console.info('[DaemonCore] started')
    } catch (err) {
      // Rollback: clean up partially-started resources
      this.running = false
      await this.stop().catch(() => {}) // best-effort cleanup
      throw err
    }
  }

  /** Stop the daemon core — abort all runtimes and clear timers */
  async stop(): Promise<void> {
    if (!this.running) return
    this.running = false

    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }

    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }

    await runtimeRegistry.stopAll()

    // Stop Bridge API Server
    const bridgeApi = getBridgeApiServer()
    await bridgeApi.stop()

    // Stop Renderer API Server
    const rendererApi = getRendererApiServer()
    await rendererApi.stop()

    writeObservabilityEvent('daemon_core:stopped', {})
    console.info('[DaemonCore] stopped')
  }

  /** User sends a message — publish event for event-driven agent trigger */
  async onUserMessage(
    conversationId: string,
    message: string,
    context: Array<{ role: string; content: string }>
  ): Promise<void> {
    runtimeRegistry.resetConversationTracking(conversationId)

    bus.publish({
      type: 'message:new',
      conversationId,
      actorType: 'user',
      actorId: null,
      payload: { message, context },
    })

    // SSE broadcast (no webContents dependency)
    sseBroadcaster.broadcastAIEvent('open_floor:start', { conversationId })

    this.trackedConversations.add(conversationId)
  }

  /** Abort all tasks for a conversation */
  abortConversation(conversationId: string): void {
    const cancelled = taskQueue.cancelConversation(conversationId)
    console.info(
      '[DaemonCore] cancelled tasks for', conversationId,
      ':', cancelled.pending, 'pending,', cancelled.claimed, 'claimed,', cancelled.running, 'running'
    )

    for (const resident of runtimeRegistry.getAllActive()) {
      const activeTasks = taskQueue.getAgentActiveTasks(resident.profile.id)
      const hasConversationTask = activeTasks.some((t) => t.conversationId === conversationId)
      if (hasConversationTask) {
        resident.runtime.abort()
        resident.isProcessing = false
      }
    }

    runtimeRegistry.resetConversationTracking(conversationId)
    this.trackedConversations.delete(conversationId)

    sseBroadcaster.broadcastAIEvent('system:abort', { conversationId })
  }

  /** Check if daemon core is running */
  isRunning(): boolean {
    return this.running
  }

  private async pollTasks(): Promise<void> {
    if (!this.running || !this.abortController) return
    if (this.abortController.signal.aborted) return

    let anyTaskExecuted = false

    for (const resident of runtimeRegistry.getAllActive()) {
      if (resident.isProcessing) continue

      const pendingCount = taskQueue.countPending(resident.profile.id)
      if (pendingCount === 0) continue

      const activeCount = resident.claimedTasks.size
      if (activeCount >= resident.maxConcurrentTasks) continue

      anyTaskExecuted = true
      runtimeRegistry.claimAndExecute(resident.profile.id).catch((err) => {
        console.error('[DaemonCore] claimAndExecute error:', err)
      })
    }

    if (anyTaskExecuted || this.trackedConversations.size > 0) {
      this.checkConversationsComplete()
    }
  }

  private async checkConversationsComplete(): Promise<void> {
    for (const conversationId of Array.from(this.trackedConversations)) {
      const allTasks = taskQueue.getConversationTasks(conversationId)
      const hasActiveOrPending = allTasks.some((t) =>
        t.status === 'pending' || t.status === 'claimed' || t.status === 'running'
      )
      if (!hasActiveOrPending && allTasks.length > 0) {
        const participantIds = Array.from(new Set(allTasks.map((t) => t.agentProfileId)))
        for (const profileId of participantIds) {
          const agentTasks = allTasks.filter((t) => t.agentProfileId === profileId && t.result && t.result !== '[NO_REPLY]')
          if (agentTasks.length > 0) {
            const lastTask = agentTasks[agentTasks.length - 1]
            const entry: MemoryEntry = {
              topic: this.extractTopic(lastTask.message),
              conclusion: this.summarizeForMemory(lastTask.result!),
              category: this.categorizeForMemory(lastTask.result!),
              source: 'conversation_end',
              timestamp: Date.now(),
            }
            agentMemory.append(profileId, entry).catch((err) => {
              console.warn(`[DaemonCore] memory update failed for ${profileId}:`, err)
            })
          }
        }

        bus.publish({
          type: 'conversation:completed',
          conversationId,
          actorType: 'system',
          actorId: null,
          payload: { participantIds },
        })

        this.trackedConversations.delete(conversationId)
      }
    }
  }

  private async handleConversationCompleted(conversationId: string): Promise<void> {
    const distillate = await this.memoryDistiller.distillChain(conversationId)
    if (!distillate) {
      writeObservabilityEvent('memory_distill:completed', {
        conversationId,
        itemCount: 0,
        reason: 'empty_distillate',
      })
      return
    }

    const itemCount = await this.memoryDistiller.persistToMemoryPalace(distillate)
    writeObservabilityEvent('memory_distill:completed', {
      conversationId,
      itemCount,
      taskCount: distillate.taskCount,
      agentCount: distillate.agentChain.length,
    })
    sseBroadcaster.broadcastAIEvent('open_floor:complete', { conversationId })
  }

  private heartbeat(): void {
    const activeRuntimes = runtimeRegistry.getAllActive()
    const totalPending = taskQueue.countAllPending()

    sseBroadcaster.broadcast('daemon:heartbeat', {
      activeRuntimes: activeRuntimes.length,
      pendingTasks: totalPending,
      timestamp: Date.now(),
    })

    console.debug('[DaemonCore] heartbeat — active:', activeRuntimes.length, 'pending:', totalPending)
  }

  private extractTopic(message: string): string {
    const firstLine = message.split('\n')[0] ?? ''
    return firstLine.slice(0, 80)
  }

  private summarizeForMemory(result: string): string {
    return result.slice(0, 200)
  }

  private categorizeForMemory(reply: string): MemoryEntry['category'] {
    const lower = reply.toLowerCase()
    if (lower.includes('决策') || lower.includes('decided') || lower.includes('决定')) return 'decision'
    if (lower.includes('偏好') || lower.includes('建议') || lower.includes('prefer') || lower.includes('recommend')) return 'preference'
    if (lower.includes('反馈') || lower.includes('review') || lower.includes('feedback')) return 'feedback'
    return 'context'
  }
}