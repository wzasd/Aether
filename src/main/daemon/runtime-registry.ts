/**
 * RuntimeRegistry — manages resident AgentRuntime instances.
 *
 * In bytro 2.0 Daemon architecture, each enabled AgentProfile
 * gets a long-lived Runtime that subscribes to the EventBus.
 */

import { AgentRuntime } from '../ai/agent-runtime'
import type { AgentProfile } from '../ai/a2a-types'
import { bus, type BusEvent } from './event-bus'
import { taskQueue, type ClaimResult } from './task-queue'
import type { SessionConfig } from '../ai/provider'

export interface ResidentRuntime {
  profile: AgentProfile
  runtime: AgentRuntime
  isActive: boolean
  maxConcurrentTasks: number
  claimedTasks: Set<string>
}

export class RuntimeRegistry {
  private runtimes = new Map<string, ResidentRuntime>() // profileId -> ResidentRuntime
  private config: SessionConfig | null = null

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
        maxConcurrentTasks: 2, // default, could be configurable per agent
        claimedTasks: new Set(),
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

    for (const [profileId, resident] of this.runtimes) {
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
    for (const [profileId, resident] of this.runtimes) {
      if (resident.isActive) {
        try {
          await resident.runtime.dispose()
          resident.isActive = false
          console.info('[RuntimeRegistry] stopped:', resident.profile.name)
        } catch (err) {
          console.error('[RuntimeRegistry] stop failed:', resident.profile.name, err)
        }
      }
    }
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

    const claim: ClaimResult = taskQueue.claim(profileId, resident.maxConcurrentTasks)
    if (claim.reason !== 'claimed' || !claim.task) return

    const task = claim.task
    resident.claimedTasks.add(task.id)
    taskQueue.start(task.id)

    try {
      const context = task.context ? JSON.parse(task.context) as Array<{ role: string; content: string }> : []

      const result = await resident.runtime.onObservation({
        conversationId: task.conversationId,
        message: task.message,
        context,
        collaborationMode: 'open_floor',
      })

      if (result.reply) {
        taskQueue.complete(task.id, result.reply)

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
    }
  }

  private onMessageNew(resident: ResidentRuntime, event: BusEvent): void {
    if (!resident.isActive) return

    // Enqueue a task for this agent to process the new message
    const payload = event.payload as { message: string; context?: Array<{ role: string; content: string }> }
    taskQueue.enqueue({
      conversationId: event.conversationId,
      agentProfileId: resident.profile.id,
      message: payload.message,
      context: payload.context,
    })
  }

  private onMessageReply(resident: ResidentRuntime, event: BusEvent): void {
    if (!resident.isActive) return
    // When another agent replies, this agent may want to respond
    // The decision is made by the LLM in onObservation based on message content
    const payload = event.payload as { content: string; agentName: string }

    // Build a follow-up task
    taskQueue.enqueue({
      conversationId: event.conversationId,
      agentProfileId: resident.profile.id,
      message: `${payload.agentName} 回复了：\n\n${payload.content}\n\n你怎么看？`,
    })
  }

  private onAbort(resident: ResidentRuntime, event: BusEvent): void {
    if (!resident.isActive) return
    // Cancel pending tasks for this conversation
    taskQueue.cancelPending(event.conversationId)
    // Abort active runtime if working on this conversation
    resident.runtime.abort()
  }
}

/** Singleton registry */
export const runtimeRegistry = new RuntimeRegistry()
