/**
 * RuntimeRegistry — manages resident AgentRuntime instances.
 *
 * In bytro 2.0 Daemon architecture, each enabled AgentProfile
 * gets a long-lived Runtime that subscribes to the EventBus.
 */

import { AgentRuntime } from '../ai/agent-runtime'
import type { AgentProfile, ObservationTool } from '../ai/a2a-types'
import { bus, type BusEvent } from './event-bus'
import { taskQueue, type ClaimResult, type EnqueueTaskParams } from './task-queue'
import type { SessionConfig } from '../ai/provider'

/** A pending message waiting to be enqueued when the agent becomes idle */
interface PendingMessage {
  params: EnqueueTaskParams
  enqueuedAt: number
}

export interface ResidentRuntime {
  profile: AgentProfile
  runtime: AgentRuntime
  isActive: boolean
  isProcessing: boolean // Aligns with Slock: Agent has an active/busy state
  maxConcurrentTasks: number
  maxQueueSize: number // Aligns with Slock: per-Agent queue capacity (max=5)
  claimedTasks: Set<string>
  pendingMessages: PendingMessage[] // Aligns with Slock: per-Agent message queue
}

export class RuntimeRegistry {
  private runtimes = new Map<string, ResidentRuntime>() // profileId -> ResidentRuntime
  private config: SessionConfig | null = null

  // Loop safeguards per conversation
  private responseCounts = new Map<string, Map<string, number>>() // conversationId -> { agentProfileId -> count }
  private lastResponseTime = new Map<string, Map<string, number>>() // conversationId -> { agentProfileId -> timestamp }
  private readonly MAX_RESPONSES_PER_AGENT = 5
  private readonly COOLDOWN_MS = 2000
  private readonly CONVERSATION_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes

  /** Initialize all resident runtimes from profiles */
  async initialize(profiles: AgentProfile[], baseConfig: SessionConfig): Promise<void> {
    this.config = baseConfig

    for (const profile of profiles) {
      if (!profile.isEnabled) continue

      const runtime = new AgentRuntime(profile)
      const resident: ResidentRuntime = {
        profile,
        runtime,
        isActive: false,
        isProcessing: false,
        maxConcurrentTasks: 2,
        maxQueueSize: 5, // Aligns with Slock: max=5 concurrent per agent
        claimedTasks: new Set(),
        pendingMessages: [],
      }

      this.runtimes.set(profile.id, resident)

      // Subscribe to events this agent cares about
      bus.subscribe('message:new', (event) => this.onMessageNew(resident, event))
      bus.subscribe('message:reply', (event) => this.onMessageReply(resident, event))
      bus.subscribe('system:abort', (event) => this.onAbort(resident, event))
    }
  }

  /** Start all resident runtimes */
  async startAll(): Promise<void> {
    if (!this.config) throw new Error('RuntimeRegistry not initialized')

    for (const [profileId, resident] of Array.from(this.runtimes.entries())) {
      try {
        await resident.runtime.start(this.config)
        resident.isActive = true
        console.info('[RuntimeRegistry] started:', resident.profile.name)
      } catch (err) {
        console.error('[RuntimeRegistry] start failed:', resident.profile.name, err)
        resident.isActive = false
      }
    }
  }

  /** Stop all resident runtimes */
  async stopAll(): Promise<void> {
    for (const [profileId, resident] of Array.from(this.runtimes.entries())) {
      if (resident.isActive) {
        try {
          resident.runtime.suspend() // Aligns with Slock: explicit stop
          await resident.runtime.dispose()
          resident.isActive = false
          resident.isProcessing = false
          resident.pendingMessages = []
          console.info('[RuntimeRegistry] stopped:', resident.profile.name)
        } catch (err) {
          console.error('[RuntimeRegistry] stop failed:', resident.profile.name, err)
        }
      }
    }
  }

  /** Suspend a single agent (aligns with Slock: on-demand stop) */
  suspendAgent(profileId: string): boolean {
    const resident = this.runtimes.get(profileId)
    if (!resident || !resident.isActive) return false
    resident.runtime.suspend()
    resident.isProcessing = false
    console.info('[RuntimeRegistry] suspended:', resident.profile.name)
    return true
  }

  /** Resume a single agent (aligns with Slock: on-demand start) */
  async resumeAgent(profileId: string): Promise<boolean> {
    const resident = this.runtimes.get(profileId)
    if (!resident || !this.config) return false
    if (!resident.runtime.isActive) {
      try {
        await resident.runtime.resume(this.config)
      } catch (err) {
        console.error('[RuntimeRegistry] resume failed:', resident.profile.name, err)
        return false
      }
    }
    resident.isActive = true
    console.info('[RuntimeRegistry] resumed:', resident.profile.name)
    return true
  }

  /** Get a resident runtime by profile ID */
  get(profileId: string): ResidentRuntime | undefined {
    return this.runtimes.get(profileId)
  }

  /** Get all active runtimes */
  getAllActive(): ResidentRuntime[] {
    return Array.from(this.runtimes.values()).filter((r) => r.isActive)
  }

  /** Claim and execute the next task for an agent */
  async claimAndExecute(profileId: string): Promise<void> {
    const resident = this.runtimes.get(profileId)
    if (!resident || !resident.isActive) return

    // Aligns with Slock: skip if agent is already processing (busy state)
    if (resident.isProcessing) {
      console.debug('[RuntimeRegistry] agent busy, skipping claim:', resident.profile.name)
      return
    }

    const claim: ClaimResult = taskQueue.claim(profileId, resident.maxConcurrentTasks)
    if (claim.reason !== 'claimed' || !claim.task) return

    const task = claim.task
    resident.claimedTasks.add(task.id)
    resident.isProcessing = true // Aligns with Slock: mark as busy
    taskQueue.start(task.id)

    // Notify frontend that this agent has started thinking
    bus.publish({
      type: 'agent:thinking',
      conversationId: task.conversationId,
      actorType: 'agent',
      actorId: profileId,
      payload: {
        agentName: resident.profile.name,
        agentRole: resident.profile.role,
      },
    })

    try {
      const context = task.context ? JSON.parse(task.context) as Array<{ role: string; content: string }> : []

      // Build tools for Agent self-fetch (Path B — aligns with Slock/Multica pull model)
      const conversationId = task.conversationId
      const readMessagesTool: ObservationTool = {
        name: 'readMessages',
        description: '读取对话历史，了解最近的讨论内容和上下文。使用此工具可以帮助你做出更准确的判断和回复。',
        parameters: {
          limit: { type: 'number', description: '返回最近 N 条消息，默认50，最大100' },
        },
        execute: async (args: Record<string, unknown>) => {
          const limit = Math.min(typeof args.limit === 'number' ? args.limit : 50, 100)
          const history = taskQueue.getConversationHistory(conversationId, limit)
          return history.length > 0
            ? history.join('\n\n')
            : '（暂无对话历史）'
        },
      }

      // Aligns with Slock: reuse active runtime (process reuse).
      // Only start a new session if the runtime is not already active.
      if (!resident.runtime.isActive && this.config) {
        const lastSessionId = task.sessionId ?? taskQueue.getLastSessionId(task.conversationId, profileId)
        const resumeConfig = lastSessionId
          ? { ...this.config, sessionId: lastSessionId }
          : this.config
        await resident.runtime.start(resumeConfig)
      }

      const result = await resident.runtime.onObservation({
        conversationId: task.conversationId,
        message: task.message,
        context,
        collaborationMode: 'open_floor',
        tools: [readMessagesTool],
      })

      // Phase 3: Persist session ID for next round
      const sessionId = resident.runtime.sessionId
      if (sessionId) {
        taskQueue.updateSessionId(task.id, sessionId)
      }

      if (result.reply) {
        taskQueue.complete(task.id, result.reply)
        this.trackResponse(task.conversationId, profileId)

        // Publish the reply back to the bus so other agents can see it
        bus.publish({
          type: 'message:reply',
          conversationId: task.conversationId,
          actorType: 'agent',
          actorId: profileId,
          payload: {
            agentName: resident.profile.name,
            agentRole: resident.profile.role,
            content: result.reply,
            relevanceScore: result.relevanceScore,
          },
        })
      } else {
        taskQueue.complete(task.id, '[NO_REPLY]')
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      taskQueue.fail(task.id, errorMsg)
    } finally {
      resident.claimedTasks.delete(task.id)
      resident.isProcessing = false // Aligns with Slock: mark as idle
      // Dequeue pending messages now that agent is idle
      this.dequeuePending(resident)
    }
  }

  /** Dequeue pending messages for an idle agent (aligns with Slock: while busy → queue) */
  private dequeuePending(resident: ResidentRuntime): void {
    while (resident.pendingMessages.length > 0 && !resident.isProcessing) {
      const pending = resident.pendingMessages.shift()!
      taskQueue.enqueue(pending.params)
      console.debug('[RuntimeRegistry] dequeued pending message for:', resident.profile.name, '(queue:', resident.pendingMessages.length, ')')
    }
  }

  /**
   * Decide whether this agent should respond to a new message.
   * Uses a lightweight heuristic (no LLM call) for speed:
   * - Always respond to the first user message in a conversation
   * - Skip if agent has reached max responses
   * - Skip if agent is in cooldown period
   * - Skip if agent is the one who sent the message
   */
  private shouldRespond(resident: ResidentRuntime, event: BusEvent): boolean {
    if (!resident.isActive) return false

    const conversationId = event.conversationId
    const agentId = resident.profile.id

    // Don't respond to your own messages
    if (event.actorId === agentId) return false

    // Check max responses per conversation
    const convCounts = this.responseCounts.get(conversationId) ?? new Map()
    const count = convCounts.get(agentId) ?? 0
    if (count >= this.MAX_RESPONSES_PER_AGENT) {
      console.debug('[RuntimeRegistry] max responses reached:', resident.profile.name, conversationId)
      return false
    }

    // Check cooldown
    const convCooldowns = this.lastResponseTime.get(conversationId) ?? new Map()
    const lastTime = convCooldowns.get(agentId) ?? 0
    if (Date.now() - lastTime < this.COOLDOWN_MS) {
      console.debug('[RuntimeRegistry] cooldown active:', resident.profile.name, conversationId)
      return false
    }

    // Check conversation timeout
    // TODO: Track conversation start time and enforce timeout

    return true
  }

  /** Track that this agent has responded */
  private trackResponse(conversationId: string, agentProfileId: string): void {
    const convCounts = this.responseCounts.get(conversationId) ?? new Map()
    convCounts.set(agentProfileId, (convCounts.get(agentProfileId) ?? 0) + 1)
    this.responseCounts.set(conversationId, convCounts)

    const convCooldowns = this.lastResponseTime.get(conversationId) ?? new Map()
    convCooldowns.set(agentProfileId, Date.now())
    this.lastResponseTime.set(conversationId, convCooldowns)
  }

  /** Reset tracking for a conversation (called on abort/complete) */
  resetConversationTracking(conversationId: string): void {
    this.responseCounts.delete(conversationId)
    this.lastResponseTime.delete(conversationId)
  }

  /** Reset all tracking state (used in tests for isolation) */
  resetAllTracking(): void {
    this.responseCounts.clear()
    this.lastResponseTime.clear()
  }

  private onMessageNew(resident: ResidentRuntime, event: BusEvent): void {
    if (!this.shouldRespond(resident, event)) return

    const payload = event.payload as { content?: string; message?: string; role?: string; context?: Array<{ role: string; content: string }> }
    const messageContent = payload.content ?? payload.message ?? ''

    // Build context from event payload
    const context = payload.context ?? []

    const params: EnqueueTaskParams = {
      conversationId: event.conversationId,
      agentProfileId: resident.profile.id,
      message: messageContent,
      context,
    }

    // Aligns with Slock: if agent is busy, queue the message locally
    if (resident.isProcessing) {
      if (resident.pendingMessages.length < resident.maxQueueSize) {
        resident.pendingMessages.push({ params, enqueuedAt: Date.now() })
        console.debug('[RuntimeRegistry] queued message for busy agent:', resident.profile.name, '(queue:', resident.pendingMessages.length, ')')
      } else {
        console.warn('[RuntimeRegistry] queue full, dropping message for:', resident.profile.name)
      }
    } else {
      taskQueue.enqueue(params)
    }
  }

  private onMessageReply(_resident: ResidentRuntime, _event: BusEvent): void {
    // Phase A pull model: do NOT enqueue follow-up tasks on peer replies.
    // Agents self-fetch peer context via the readMessages tool in claimAndExecute.
    // The old enqueue loop caused 11+ replies and task pileup (pending: 31).
  }

  private onAbort(resident: ResidentRuntime, event: BusEvent): void {
    if (!resident.isActive) return
    // Cancel pending tasks for this conversation
    taskQueue.cancelPending(event.conversationId)
    // Abort active runtime if working on this conversation
    resident.runtime.abort()
    // Reset tracking for this conversation
    this.resetConversationTracking(event.conversationId)
  }
}

/** Singleton registry */
export const runtimeRegistry = new RuntimeRegistry()
