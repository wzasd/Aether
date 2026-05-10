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
import { agentMemory, type MemoryEntry } from './agent-memory'
import { initAgentMemory } from './init-agent-memory'
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
  private trackedConversations = new Set<string>()

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

    // Clean up stale tasks from previous sessions
    taskQueue.clearStaleTasks()

    // Proactively initialize MEMORY.md for all enabled agents
    await initAgentMemory(this.profiles)

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
    // Reset tracking for this conversation (prevents stale responseCounts from blocking)
    runtimeRegistry.resetConversationTracking(conversationId)

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

    // Track conversation for completion detection
    this.trackedConversations.add(conversationId)
  }

  /** Abort all tasks for a conversation — cancel pending/claimed/running + abort runtimes */
  abortConversation(conversationId: string): void {
    // Cancel all tasks in TaskQueue (pending + claimed + running)
    const cancelled = taskQueue.cancelConversation(conversationId)
    console.info(
      '[Daemon] cancelled tasks for', conversationId,
      ':', cancelled.pending, 'pending,', cancelled.claimed, 'claimed,', cancelled.running, 'running'
    )

    // Abort any runtimes actively processing tasks for this conversation
    for (const resident of runtimeRegistry.getAllActive()) {
      const activeTasks = taskQueue.getAgentActiveTasks(resident.profile.id)
      const hasConversationTask = activeTasks.some((t) => t.conversationId === conversationId)
      if (hasConversationTask) {
        resident.runtime.abort()
        resident.isProcessing = false
      }
    }

    // Reset tracking in RuntimeRegistry
    runtimeRegistry.resetConversationTracking(conversationId)

    // Remove from tracked conversations
    this.trackedConversations.delete(conversationId)

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
      // Aligns with Slock: skip if agent is already processing (busy state)
      if (resident.isProcessing) continue

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

  private async checkConversationsComplete(): Promise<void> {
    for (const conversationId of Array.from(this.trackedConversations)) {
      const allTasks = taskQueue.getConversationTasks(conversationId)
      const hasActiveOrPending = allTasks.some((t) =>
        t.status === 'pending' || t.status === 'claimed' || t.status === 'running'
      )
      if (!hasActiveOrPending && allTasks.length > 0) {
        // Phase B: trigger memory update for agents that participated
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
              console.warn(`[Daemon] memory update failed for ${profileId}:`, err)
            })
          }
        }

        bus.publish({
          type: 'open_floor:closed',
          conversationId,
          actorType: 'system',
          actorId: null,
          payload: { reason: 'all_tasks_complete' },
        })
        this.trackedConversations.delete(conversationId)
      }
    }
  }

  // ─── Phase B: Memory helpers (rule-driven, zero token cost) ───────────

  private extractTopic(message: string): string {
    // Take the first line or first 100 chars, whichever is shorter
    const firstLine = message.split('\n')[0].replace(/^##\s*/, '').trim()
    return firstLine.length > 100 ? firstLine.slice(0, 97) + '...' : firstLine
  }

  private summarizeForMemory(reply: string): string {
    // Take first 200 chars as summary, strip markdown formatting
    const clean = reply.replace(/[#*`>|]/g, '').replace(/\n+/g, ' ').trim()
    return clean.length > 200 ? clean.slice(0, 197) + '...' : clean
  }

  private categorizeForMemory(reply: string): MemoryEntry['category'] {
    const lower = reply.toLowerCase()
    if (lower.includes('决策') || lower.includes('decided') || lower.includes('决定')) return 'decision'
    if (lower.includes('偏好') || lower.includes('建议') || lower.includes('prefer') || lower.includes('recommend')) return 'preference'
    if (lower.includes('反馈') || lower.includes('review') || lower.includes('feedback')) return 'feedback'
    return 'context'
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
