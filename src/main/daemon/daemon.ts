/**
 * Daemon — local agent runtime for bytro 2.0.
 *
 * Inspired by Multica's Daemon (server/internal/daemon/daemon.go).
 * Replaces the temporary-process model with a long-lived resident runtime.
 *
 * Responsibilities:
 * - Start/stop resident Agent runtimes
 * - Poll TaskQueue and dispatch tasks to agents
 * - Manage EventBus subscriptions
 * - Heartbeat / health monitoring
 */

import type { WebContents } from 'electron'
import { bus } from './event-bus'
import { taskQueue } from './task-queue'
import { runtimeRegistry } from './runtime-registry'
import type { SessionConfig } from '../ai/provider'
import type { AgentProfile } from '../ai/a2a-types'

export interface DaemonConfig {
  maxConcurrentTasks: number
  pollIntervalMs: number
  heartbeatIntervalMs: number
}

const DEFAULT_CONFIG: DaemonConfig = {
  maxConcurrentTasks: 3,
  pollIntervalMs: 500, // 500ms poll interval for responsiveness
  heartbeatIntervalMs: 30000,
}

export class Daemon {
  private config: DaemonConfig
  private profiles: AgentProfile[] = []
  private baseConfig: SessionConfig | null = null
  private webContents: WebContents | null = null

  private running = false
  private abortController: AbortController | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null

  constructor(config: Partial<DaemonConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /** Initialize the daemon with profiles and config */
  async initialize(
    profiles: AgentProfile[],
    baseConfig: SessionConfig,
    webContents: WebContents
  ): Promise<void> {
    this.profiles = profiles
    this.baseConfig = baseConfig
    this.webContents = webContents

    await runtimeRegistry.initialize(profiles, baseConfig)
    console.info('[Daemon] initialized with', profiles.length, 'profiles')
  }

  /** Start the daemon — all resident runtimes + polling loops */
  async start(): Promise<void> {
    if (this.running) return
    this.running = true
    this.abortController = new AbortController()

    // Start all resident runtimes
    await runtimeRegistry.startAll()

    // Start task polling loop
    this.pollTimer = setInterval(() => {
      this.pollTasks().catch((err) => {
        console.error('[Daemon] pollTasks error:', err)
      })
    }, this.config.pollIntervalMs)

    // Start heartbeat
    this.heartbeatTimer = setInterval(() => {
      this.heartbeat()
    }, this.config.heartbeatIntervalMs)

    // Subscribe to system events
    bus.subscribe('system:abort', (event) => {
      console.info('[Daemon] abort received for conversation:', event.conversationId)
      this.abortConversation(event.conversationId)
    })

    console.info('[Daemon] started')
  }

  /** Stop the daemon — abort all runtimes and clear timers */
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
    console.info('[Daemon] stopped')
  }

  /** User sends a message — publish event for event-driven agent trigger */
  async onUserMessage(
    conversationId: string,
    message: string,
    context: Array<{ role: string; content: string }>
  ): Promise<void> {
    // Publish event to bus — RuntimeRegistry subscribers will decide
    // which agents should respond and enqueue tasks accordingly
    bus.publish({
      type: 'message:new',
      conversationId,
      actorType: 'user',
      actorId: null,
      payload: { message, context },
    })

    // Notify frontend that Open Floor started
    this.sendToRenderer('ai:event', {
      type: 'open_floor:start',
      conversationId,
    })
  }

  /** Abort all tasks for a conversation */
  abortConversation(conversationId: string): void {
    const cancelled = taskQueue.cancelPending(conversationId)
    console.info('[Daemon] cancelled', cancelled, 'pending tasks for', conversationId)

    for (const resident of runtimeRegistry.getAllActive()) {
      // Only abort if this runtime has active tasks for the target conversation
      const activeTasks = taskQueue.getAgentActiveTasks(resident.profile.id)
      const hasConversationTask = activeTasks.some((t) => t.conversationId === conversationId)
      if (hasConversationTask) {
        resident.runtime.abort()
      }
    }

    this.sendToRenderer('ai:event', {
      type: 'system:abort',
      conversationId,
    })
  }

  /** Check if daemon is running */
  isRunning(): boolean {
    return this.running
  }

  private async pollTasks(): Promise<void> {
    if (!this.running || !this.abortController) return
    if (this.abortController.signal.aborted) return

    let anyTaskExecuted = false

    for (const resident of runtimeRegistry.getAllActive()) {
      // Check if this agent has capacity and pending tasks
      const pendingCount = taskQueue.countPending(resident.profile.id)
      if (pendingCount === 0) continue

      const activeCount = resident.claimedTasks.size
      if (activeCount >= resident.maxConcurrentTasks) continue

      // Claim and execute (non-blocking)
      anyTaskExecuted = true
      runtimeRegistry.claimAndExecute(resident.profile.id).catch((err) => {
        console.error('[Daemon] claimAndExecute error:', err)
      })
    }

    // Check if all tasks for all conversations are done
    if (anyTaskExecuted) {
      this.checkConversationsComplete()
    }
  }

  private checkConversationsComplete(): void {
    // Get all unique conversation IDs with pending/claimed/running tasks
    const activeConversations = new Set<string>()
    for (const resident of runtimeRegistry.getAllActive()) {
      const tasks = taskQueue.getAgentActiveTasks(resident.profile.id)
      for (const t of tasks) {
        activeConversations.add(t.conversationId)
      }
    }

    // For conversations with no active tasks, emit closed event
    for (const conversationId of activeConversations) {
      let hasActive = false
      for (const resident of runtimeRegistry.getAllActive()) {
        const tasks = taskQueue.getAgentActiveTasks(resident.profile.id)
        if (tasks.some((t) => t.conversationId === conversationId)) {
          hasActive = true
          break
        }
      }
      if (!hasActive) {
        bus.publish({
          type: 'open_floor:closed',
          conversationId,
          actorType: 'system',
          actorId: null,
          payload: { reason: 'all_tasks_complete' },
        })
      }
    }
  }

  private heartbeat(): void {
    const activeRuntimes = runtimeRegistry.getAllActive()
    const totalPending = this.profiles.reduce((sum, p) => {
      if (!p.isEnabled) return sum
      return sum + taskQueue.countPending(p.id)
    }, 0)

    console.debug('[Daemon] heartbeat — active:', activeRuntimes.length, 'pending:', totalPending)
  }

  private sendToRenderer(channel: string, data: unknown): void {
    if (this.webContents && !this.webContents.isDestroyed()) {
      this.webContents.send(channel, data)
    }
  }
}

/** Singleton daemon instance */
export const daemon = new Daemon()
