import { randomUUID } from 'crypto'
import type { WebContents } from 'electron'
import { getDb } from '../core/db'
import { createCandidate } from '../core/memory-index'
import { AgentRuntime } from './agent-runtime'
import type { AgentProfile, A2ATask, ParsedMention, ExecutionMode, PlannedTask, CollaborationMode, OpenFloorState, OpenFloorResponse } from './a2a-types'
import type { ReflowGroup } from './reflow-orchestrator'
import { MAX_DELEGATION_DEPTH, MAX_TASKS_PER_CONVERSATION, OPEN_FLOOR_TIMEOUT_MS } from './a2a-types'
import { extractCandidates } from './memory-extractor'
import { buildInjectionPrompt } from './memory-injection'
import { getTeam } from './team-config'
import { rowToProfile, type AgentProfileRow } from './profile-utils'
import type { SessionConfig } from './provider'
import { InvocationQueue } from './invocation-queue'
import { ContinuityCapsuleManager, formatContinuationPrompt } from './continuity-capsule'
import { ReflowOrchestrator } from './reflow-orchestrator'
import { A2AMemoryDistiller } from './a2a-memory-distiller'
import { writeObservabilityEvent } from '../core/logging'

// Layer 1
import { parseIntents } from './intent-parser'
import type { ParsedIntent } from './intent-parser'
import { parseMentions, stripMentionSegments } from './mention-parser'
// Layer 2
import { checkIntent, checkTeamMembership, checkLoopDetection } from './policy-gate'
// Layer 3
import { planRouting } from './routing-planner'
// Layer 4
import { assembleContext } from './context-assembler'

function defaultProfile(model: string): AgentProfile {
  return {
    id: 'default',
    workspaceId: null,
    name: 'Assistant',
    role: 'assistant',
    model,
    description: null,
    systemPrompt: null,
    isEnabled: true,
    sortOrder: -1,
    createdAt: 0,
    updatedAt: 0
  }
}

function runtimeKey(conversationId: string, profileId: string, taskId?: string): string {
  // Include taskId in the key so parallel tasks for the same profile don't
  // overwrite each other's runtimes in the active-runtime map.
  return taskId
    ? `${conversationId}:${profileId}:${taskId}`
    : `${conversationId}:${profileId}`
}

const FILE_OPERATION_TOOLS = new Set(['Write', 'Edit', 'Delete', 'NotebookEdit'])

function isFileTool(toolName: string): boolean {
  const segments = toolName.split('__')
  return FILE_OPERATION_TOOLS.has(segments[segments.length - 1])
}

class AgentOrchestrator {
  private runtimes: Map<string, AgentRuntime> = new Map()
  private invocationQueue = new InvocationQueue()
  private drainingQueues: Set<string> = new Set()
  private baseConfigs: Map<string, SessionConfig> = new Map()
  private webContentsMap: Map<string, WebContents> = new Map()
  // Persists the last Claude CLI session ID for primary agents so the next
  // turn can pass --resume <sessionId> and skip context injection entirely.
  // Key: `conversationId:profileId`. Value includes a config fingerprint so
  // stale entries are discarded when provider/model/workingDir/permissionMode change.
  private primarySessionIds: Map<string, { sessionId: string; fingerprint: string }> = new Map()
  private zombieTaskIds: Set<string> = new Set()
  // Completion hooks for chain callbacks — registered when an agent-scan task
  // is scheduled, invoked when the task completes to create a feedback task
  // for the parent agent.
  private completionHooks = new Map<string, (task: A2ATask, output: string) => void>()
  private capsuleManager = new ContinuityCapsuleManager()
  private reflowOrchestrator = new ReflowOrchestrator()
  private memoryDistiller = new A2AMemoryDistiller()

  // Open Floor state tracking — keyed by conversationId
  private openFloorStates: Map<string, OpenFloorState> = new Map()
  // Conversation-level collaboration mode — keyed by conversationId
  private conversationModes: Map<string, CollaborationMode> = new Map()
  // AbortControllers for open floor discussions — keyed by conversationId
  private openFloorControllers: Map<string, AbortController> = new Map()

  constructor() {
    // Start reflow timeout guard
    this.reflowOrchestrator.setTimeoutCallback((group) => {
      // Timeout: build partial aggregation with completed + missing results
      const parentTask = this.findParentTaskForReflow(group)
      if (parentTask) {
        const aggregatedMessage = this.reflowOrchestrator.buildAggregationMessage(group)
        this.createFeedbackTask(parentTask, parentTask, aggregatedMessage, group.id)
          .then(() => this.reflowOrchestrator.disposeGroup(group.id))
          .catch(() => this.reflowOrchestrator.disposeGroup(group.id))
      }
    })
    this.reflowOrchestrator.startTimeoutGuard()

    // Start zombie defense: detect tasks stuck in 'working' > 10min
    this.invocationQueue.startZombieDefense(
      (taskId) => {
        const db = getDb()
        const row = db.prepare(`SELECT status FROM a2a_tasks WHERE id = ?`).get(taskId) as { status: string } | undefined
        return row?.status as A2ATask['status'] | undefined
      },
      (taskId) => {
        const db = getDb()
        const row = db.prepare(`SELECT * FROM a2a_tasks WHERE id = ?`).get(taskId) as Record<string, unknown> | undefined
        if (!row) return
        const task = this.rowToTask(row)

        // Abort the runtime so the hung executeTask() promise resolves
        const key = runtimeKey(task.conversationId, task.toProfileId, task.id)
        const runtime = this.runtimes.get(key)
        if (runtime?.isActive) {
          this.zombieTaskIds.add(taskId)
          runtime.abort()
          writeObservabilityEvent('runtime:terminated', { taskId, conversationId: task.conversationId, profileId: task.toProfileId, runtimeKey: key, reason: 'zombie' })
          this.runtimes.delete(key)
        }
        this.invocationQueue.markDone(task.conversationId)

        this.updateTaskStatus(taskId, 'failed')
        this.invokeCompletionHook(task, '任务执行超时（僵尸任务），已自动终止')
        const wc = this.webContentsMap.get(task.conversationId)
        if (wc && !wc.isDestroyed()) {
          this.appendSystemMessage(wc, task.conversationId, `任务 ${taskId} 执行超时，已自动终止`)
          this.send(wc, 'a2a:taskCompleted', { taskId, conversationId: task.conversationId, error: 'Zombie task timeout' })
        }
      }
    )
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  async sendUserMessage(
    conversationId: string,
    profileId: string | null,
    content: string,
    sessionConfig: SessionConfig,
    executionMode: ExecutionMode,
    webContents: WebContents,
    overrides?: { providerType?: string; model?: string },
    initialMentions?: string,
    collaborationMode?: CollaborationMode
  ): Promise<void> {
    this.webContentsMap.set(conversationId, webContents)
    this.invocationQueue.clear(conversationId)

    // Store collaboration mode for this conversation
    const mode: CollaborationMode = collaborationMode
      ?? this.conversationModes.get(conversationId)
      ?? 'orchestrated'
    this.conversationModes.set(conversationId, mode)

    // Open Floor branch: broadcast to all team agents, skip normal pipeline
    if (mode === 'open_floor') {
      // Stop any active Open Floor for this conversation before starting a new round.
      // Without this, the old state/runtimes leak and the new executeOpenFloor
      // overwrites the AbortController, making the previous round unstoppable.
      const prevState = this.openFloorStates.get(conversationId)
      if (prevState?.status === 'active') {
        this.stopOpenFloor(conversationId)
      }
      this.baseConfigs.set(conversationId, sessionConfig)
      await this.executeOpenFloor(conversationId, content, webContents)
      return
    }

    // ─── Orchestrated branch (existing logic) ───

    const profile = profileId
      ? (this.loadProfile(profileId) ?? defaultProfile(sessionConfig.model))
      : defaultProfile(sessionConfig.model)

    // Check if primary agent has a resumable session from a previous turn.
    // Discard the stored entry if provider/model/workingDir/permissionMode changed.
    const resumeKey = `${conversationId}:${profile.id}`
    const configFingerprint = `${sessionConfig.providerType}:${sessionConfig.model}:${sessionConfig.workingDir}:${sessionConfig.permissionMode}`
    const stored = this.primarySessionIds.get(resumeKey)
    const resumeSessionId = stored?.fingerprint === configFingerprint ? stored.sessionId : undefined
    if (stored && !resumeSessionId) this.primarySessionIds.delete(resumeKey)
    const isResuming = Boolean(resumeSessionId)

    // Inject the resume session ID into config so base-cli-provider passes --resume
    const effectiveConfig: SessionConfig = resumeSessionId
      ? { ...sessionConfig, sessionId: resumeSessionId }
      : sessionConfig
    this.baseConfigs.set(conversationId, effectiveConfig)

    // Memory injection
    const workspaceId = this.getConversationWorkspaceId(conversationId)

    // Parse @mentions from the user's message — both from the dedicated
    // initialMentions field (NewTaskDialog) and inline in the chat input.
    const knownNames = this.collectKnownNames()
    const capabilities = this.collectKnownCapabilities(this.loadAllEnabledProfiles())
    const allNames = [...knownNames, ...capabilities, 'All']
    const inlineMentions = parseMentions(content, allNames)
    const combinedMentionText = [
      initialMentions?.trim(),
      ...inlineMentions.map((m) => `@${m.agentName}: ${m.taskContent}`)
    ].filter(Boolean).join('\n')

    // Strip @mention patterns from the primary agent's message
    let primaryContent = content
    if (combinedMentionText) {
      primaryContent = stripMentionSegments(content)
    }
    const isAllMentions = combinedMentionText && !primaryContent

    // Auto-switch to parallel when user @mentions multiple agents
    const combinedMentions = parseMentions(combinedMentionText, allNames)
    const effectiveExecutionMode = combinedMentions.length > 1 ? 'parallel' : executionMode

    // Direct routing: when the entire message is @mentions, skip primary
    // agent execution and route straight to the target agent(s).
    // Delegated agent output is emitted as a completion event and persisted by
    // the renderer as the target agent's visible reply (Path A).
    if (isAllMentions) {
      const memInjection = buildInjectionPrompt(combinedMentionText, workspaceId)
      const mentionWithMemory = memInjection.count > 0
        ? `${memInjection.prompt}\n\n---\n\n${combinedMentionText}`
        : combinedMentionText
      await this.dispatchIntents(
        conversationId, mentionWithMemory, profile,
        ['user'], 0, effectiveExecutionMode, effectiveConfig, webContents,
        undefined, true
      )
      await this.drainSerialQueue(conversationId, webContents)
      return
    }

    const memoryInjection = buildInjectionPrompt(primaryContent, workspaceId)
    const augmentedContent = memoryInjection.count > 0
      ? `${memoryInjection.prompt}\n\n---\n\n${primaryContent}`
      : primaryContent

    // Layer 4: conversation history for primary task.
    // When resuming, the CLI already has the history — skip injection to avoid duplication.
    const contextSnapshot = isResuming ? '' : assembleContext({
      conversationId,
      strategy: 'conversation',
      fromAgentName: null,
      fromAgentProfileId: null,
      toAgentName: profile.name,
      toAgentRole: profile.role,
      instruction: content,
    })

    const task: A2ATask = {
      id: randomUUID(),
      conversationId,
      fromProfileId: null,
      toProfileId: profile.id,
      message: augmentedContent,
      contextSnapshot,
      status: 'working',
      depth: 0,
      chain: ['user'],
      executionMode: effectiveExecutionMode,
      providerOverride: overrides?.providerType,
      modelOverride: overrides?.model,
      createdAt: Math.floor(Date.now() / 1000)
    }

    this.persistTask(task)
    this.persistEdge({ id: randomUUID(), conversationId, fromNodeId: null, toNodeId: task.id, edgeType: 'user-mention', label: 'User → Task' })
    this.send(webContents, 'a2a:taskCreated', task)

    // Route @mentions — both from UI initialMentions and inline in chat input.
    if (combinedMentionText) {
      await this.dispatchIntents(
        conversationId, combinedMentionText, profile,
        task.chain, task.depth + 1, effectiveExecutionMode, sessionConfig, webContents,
        undefined, true
      )
    }

    await this.executeTask(task, profile, sessionConfig, effectiveExecutionMode, webContents)
    // Always drain — agent-scan handoffs may enqueue tasks even in parallel root runs
    await this.drainSerialQueue(conversationId, webContents)
  }

  abort(conversationId: string): void {
    this.invocationQueue.clear(conversationId)
    this.capsuleManager.clearConversation(conversationId)
    // Clear stored session IDs so an aborted session is never resumed
    for (const key of Array.from(this.primarySessionIds.keys())) {
      if (key.startsWith(`${conversationId}:`)) this.primarySessionIds.delete(key)
    }
    const prefix = `${conversationId}:`
    this.runtimes.forEach((runtime, key) => {
      if (key.startsWith(prefix)) {
        if (runtime.isActive) {
          runtime.abort()
          writeObservabilityEvent('runtime:terminated', { conversationId, profileId: key.split(':')[1], runtimeKey: key, reason: 'aborted' })
        }
        this.runtimes.delete(key)
      }
    })
  }

  respondPermission(conversationId: string, approved: boolean, profileId: string, taskId?: string): void {
    if (!approved) {
      writeObservabilityEvent('permission:denied', { conversationId, profileId, taskId })
      this.abort(conversationId); return
    }
    writeObservabilityEvent('permission:granted', { conversationId, profileId, taskId })
    // Route by exact runtime key when taskId is known; fall back to prefix
    // scan for backwards compatibility with callers that don't supply taskId.
    if (taskId) {
      const exactKey = runtimeKey(conversationId, profileId, taskId)
      const runtime = this.runtimes.get(exactKey)
      if (runtime?.isActive) {
        runtime.respondPermission(approved)
        return
      }
    } else {
      const prefix = `${conversationId}:${profileId}:`
      const activeRuntime = Array.from(this.runtimes.entries()).find(
        ([key, rt]) => key.startsWith(prefix) && rt.isActive
      )
      if (activeRuntime) {
        activeRuntime[1].respondPermission(approved)
        return
      }
    }
    // Fail closed: if no exact runtime matches, the permission request is stale.
    writeObservabilityEvent('permission:abandoned', { conversationId, profileId, taskId, reason: 'stale' })
    const wc = this.webContentsMap.get(conversationId)
    if (wc && !wc.isDestroyed()) {
      this.appendSystemMessage(wc, conversationId, `权限响应超时：目标 Agent 会话已结束`)
    }
  }

  respondQuestion(conversationId: string, answer: string, profileId: string, taskId?: string): void {
    if (taskId) {
      const exactKey = runtimeKey(conversationId, profileId, taskId)
      const runtime = this.runtimes.get(exactKey)
      if (runtime?.isActive) {
        runtime.respondQuestion(answer)
        return
      }
    } else {
      const prefix = `${conversationId}:${profileId}:`
      const activeRuntime = Array.from(this.runtimes.entries()).find(
        ([key, rt]) => key.startsWith(prefix) && rt.isActive
      )
      if (activeRuntime) {
        activeRuntime[1].respondQuestion(answer)
        return
      }
    }
    writeObservabilityEvent('permission:abandoned', { conversationId, profileId, taskId, reason: 'stale_question' })
    const wc = this.webContentsMap.get(conversationId)
    if (wc && !wc.isDestroyed()) {
      this.appendSystemMessage(wc, conversationId, `问题回答超时：目标 Agent 会话已结束`)
    }
  }

  private hasActiveRuntime(conversationId: string): boolean {
    const prefix = `${conversationId}:`
    let active = false
    this.runtimes.forEach((runtime, key) => {
      if (key.startsWith(prefix) && runtime.isActive) active = true
    })
    return active
  }

  getActiveTasks(conversationId: string): A2ATask[] {
    const db = getDb()
    const rows = db.prepare(
      `SELECT * FROM a2a_tasks WHERE conversation_id = ? AND status IN ('pending','working') ORDER BY created_at ASC`
    ).all(conversationId) as Array<Record<string, unknown>>
    return rows.map((r) => this.rowToTask(r))
  }

  getActiveGraph(conversationId: string): {
    nodes: A2ATask[]
    edges: Array<{ id: string; conversationId: string; fromNodeId: string | null; toNodeId: string; edgeType: string; label?: string; createdAt: number }>
  } {
    const db = getDb()
    const nodeRows = db.prepare(
      `SELECT * FROM a2a_tasks WHERE conversation_id = ? AND status IN ('pending','working','completed') ORDER BY created_at ASC`
    ).all(conversationId) as Array<Record<string, unknown>>
    const nodes = nodeRows.map((r) => this.rowToTask(r))

    const edgeRows = db.prepare(
      `SELECT id, conversation_id, from_node_id, to_node_id, edge_type, label, created_at FROM agent_task_edges WHERE conversation_id = ? ORDER BY created_at ASC`
    ).all(conversationId) as Array<Record<string, unknown>>
    const edges = edgeRows.map((r) => ({
      id: r.id as string,
      conversationId: r.conversation_id as string,
      fromNodeId: (r.from_node_id as string) ?? null,
      toNodeId: r.to_node_id as string,
      edgeType: r.edge_type as string,
      label: (r.label as string) ?? undefined,
      createdAt: r.created_at as number
    }))

    return { nodes, edges }
  }

  // ─── Layer 1+2+3: Intent dispatch ────────────────────────────────────────────
  // Called from:
  //   - sendUserMessage (initialMentions)
  //   - executeTask mention event (agent-initiated mentions)

  private async dispatchIntents(
    conversationId: string,
    text: string,
    fromProfile: AgentProfile,
    chain: string[],
    depth: number,
    executionMode: ExecutionMode,
    baseConfig: SessionConfig,
    webContents: WebContents,
    fromAgentOutput?: string,
    isUserInitiated?: boolean,
    syntheticIntents?: ParsedIntent[],
    parentTask?: A2ATask
  ): Promise<void> {
    const teamId = this.getConversationTeamId(conversationId)
    const team = teamId ? getTeam(teamId) : undefined
    const teamMembers = teamId ? this.loadTeamMemberProfiles(teamId) : this.loadAllEnabledProfiles()
    const policy = team?.policies ?? null

    // Layer 1: parse intents (or use pre-built synthetic intents)
    const knownCapabilities = this.collectKnownCapabilities(teamMembers)
    const parsedIntents = syntheticIntents ?? parseIntents(text, {
      knownAgentNames: [...teamMembers.map((m) => m.name), ...(teamId ? ['All'] : [])],
      knownCapabilities,
    })
    writeObservabilityEvent('intent:dispatched', { conversationId, profileId: fromProfile.id, intentCount: parsedIntents.filter(i => i.intent.type !== 'user_message').length, source: isUserInitiated ? 'user' : 'agent-scan' })
    for (const { intent } of parsedIntents) {
      if (intent.type === 'user_message') continue

      // Count how many tasks this intent would create (routing-planner excludes fromProfile for @All)
      const intendedTaskCount = intent.type === 'all' ? Math.max(0, teamMembers.length - 1) : 1

      // Layer 2: policy gate
      const policyCtx = {
        policy,
        fromProfile,
        teamMemberIds: new Set(teamMembers.map((m) => m.id)),
        currentDepth: depth,
        maxDepth: MAX_DELEGATION_DEPTH,
        currentTaskCount: this.getTaskCount(conversationId),
        maxTaskCount: MAX_TASKS_PER_CONVERSATION,
        intendedTaskCount,
        isUserInitiated,
      }

      const verdict = checkIntent(intent, policyCtx)
      if (verdict.allowed === false) {
        this.appendSystemMessage(webContents, conversationId, verdict.reason)
        continue
      }

      // Layer 3: routing planner
      // When user directly @mentions, treat source as 'default' so edge shows user->target
      const effectiveFromProfile = isUserInitiated ? defaultProfile(baseConfig.model) : fromProfile
      const routingResult = planRouting(intent, { fromProfile: effectiveFromProfile, teamMembers, policy })
      if (routingResult.ok === false) {
        const msg = this.routingErrorMessage(routingResult.error)
        this.appendSystemMessage(webContents, conversationId, msg)
        continue
      }

      const { plan } = routingResult
      if (plan.tasks.length === 0) continue

      const scheduledTaskIds: string[] = []
      for (const planned of plan.tasks) {
        // Team membership check (only if in a team)
        if (teamId && policy) {
          const memberVerdict = checkTeamMembership(planned.toProfileId, policyCtx)
          if (memberVerdict.allowed === false) {
            this.appendSystemMessage(webContents, conversationId, memberVerdict.reason)
            continue
          }
        }

        // Loop detection
        const loopVerdict = checkLoopDetection(chain, planned.toProfileId)
        if (loopVerdict.allowed === false) {
          const chainNames = chain.map((id) => this.profileName(id)).join(' → ')
          this.appendSystemMessage(webContents, conversationId, `${loopVerdict.reason}（链路：${chainNames}）`)
          continue
        }

        const taskId = await this.scheduleTask(
          conversationId, { ...planned, fromAgentOutput }, chain, depth,
          plan.executionMode, baseConfig, webContents,
          isUserInitiated ? 'user' : 'agent-scan',
          parentTask
        )
        if (taskId) scheduledTaskIds.push(taskId)
      }

      // If multiple parallel tasks were scheduled, create a reflow group for aggregation
      if (scheduledTaskIds.length > 1 && plan.executionMode === 'parallel' && parentTask) {
        this.reflowOrchestrator.createGroup(
          parentTask.toProfileId,
          parentTask.id,
          scheduledTaskIds
        )
      }
    }
  }

  // ─── Open Floor ────────────────────────────────────────────────────────────

  /**
   * Execute an open_floor discussion. Broadcasts the user message to all
   * enabled agents in the team (or all enabled profiles if no team is set).
   * Each agent independently assesses relevance and may reply. No task chain
   * is created, no A2A tracking, no DB persistence for discussion messages.
   */
  private async executeOpenFloor(
    conversationId: string,
    message: string,
    webContents: WebContents
  ): Promise<void> {
    // Create Open Floor state
    const state: OpenFloorState = {
      conversationId,
      status: 'active',
      startTime: Date.now(),
      responses: [],
      pendingAgents: [],
      skippedAgents: [],
    }
    this.openFloorStates.set(conversationId, state)

    // Create AbortController so stopOpenFloor can interrupt
    const abortController = new AbortController()
    this.openFloorControllers.set(conversationId, abortController)

    // Load team members (or all enabled profiles if no team)
    const teamId = this.getConversationTeamId(conversationId)
    const profiles = teamId
      ? this.loadTeamMemberProfiles(teamId)
      : this.loadAllEnabledProfiles()

    if (profiles.length === 0) {
      this.appendSystemMessage(webContents, conversationId, '没有可用的 Agent 参与讨论')
      state.status = 'closed'
      state.endTime = Date.now()
      this.openFloorControllers.delete(conversationId)
      return
    }

    state.pendingAgents = profiles.map((p) => p.id)

    // Use Sets for thread-safe tracking across concurrent agent promises.
    // Avoids O(n²) array filter calls and the risk of interleaved reads/writes
    // when multiple promises complete at roughly the same time.
    const completedAgents = new Set<string>()
    const skippedAgentsSet = new Set<string>()

    // Build full conversation context
    const context = await this.buildConversationContext(conversationId)

    // Broadcast to all agents in parallel
    const baseConfig = this.baseConfigs.get(conversationId)
    const promises = profiles.map(async (profile) => {
      // Check early exit before starting any work
      if (state.status !== 'active' || abortController.signal.aborted) return

      try {
        // Start a runtime for this agent if needed for observation
        const runtime = new AgentRuntime(profile)
        runtime.setKnownAgents(profiles)

        // Register runtime so it can be aborted/cleaned up
        const key = runtimeKey(conversationId, profile.id, 'open-floor')
        this.runtimes.set(key, runtime)

        try {
          // Start the runtime with base config (or defaults) so it can generate
          let startFailed = false
          if (baseConfig) {
            await runtime.start(baseConfig).catch(() => {
              // If start fails, agent can't participate — silently skip
              skippedAgentsSet.add(profile.id)
              startFailed = true
            })
            if (startFailed) return
          } else {
            skippedAgentsSet.add(profile.id)
            return
          }

          // Check abort before expensive observation call
          if (state.status !== 'active' || abortController.signal.aborted) return

          // Push observation to the agent
          const result = await runtime.onObservation({
            conversationId,
            message,
            context,
            collaborationMode: 'open_floor',
          })

          if (result.reply) {
            state.responses.push({
              agentId: profile.id,
              agentName: profile.name,
              content: result.reply,
              timestamp: Date.now(),
              relevanceScore: result.relevanceScore,
            })
            completedAgents.add(profile.id)

            // Emit observation immediately for streaming-like UX —
            // each agent's reply appears as soon as it finishes, not batched at the end.
            if (!webContents.isDestroyed()) {
              webContents.send('ai:event', {
                type: 'agent_observation',
                conversationId,
                agentProfileId: profile.id,
                agentName: profile.name,
                content: result.reply,
                timestamp: Date.now(),
                relevanceScore: result.relevanceScore,
              })
            }
          } else {
            skippedAgentsSet.add(profile.id)
          }
        } finally {
          // Clean up the runtime and remove from registry
          await runtime.dispose().catch(() => {})
          this.runtimes.delete(key)
        }
      } catch {
        skippedAgentsSet.add(profile.id)
      }
    })

    // Wait for responses (with timeout OR abort signal)
    await Promise.race([
      Promise.all(promises),
      new Promise<void>((resolve) => {
        const timeoutId = setTimeout(resolve, OPEN_FLOOR_TIMEOUT_MS)
        abortController.signal.addEventListener('abort', () => {
          clearTimeout(timeoutId)
          resolve()
        })
      }),
    ])

    // Sync Set-based tracking back to state arrays for downstream readers
    state.pendingAgents = profiles.map((p) => p.id).filter((id) => !completedAgents.has(id) && !skippedAgentsSet.has(id))
    state.skippedAgents = Array.from(skippedAgentsSet)

    // Mark closed
    state.status = 'closed'
    state.endTime = Date.now()
    this.openFloorControllers.delete(conversationId)

    // Observations are emitted immediately when each agent finishes (see promise handler above).
    // This gives a streaming-like UX where replies appear one-by-one instead of all at once.

    // Summary message
    const total = state.responses.length
    const skipped = state.skippedAgents.length
    if (!webContents.isDestroyed()) {
      const summary = `🧠 自由讨论结束：${total} 个 Agent 回复，${skipped} 个静默`
      this.appendSystemMessage(webContents, conversationId, summary)
      webContents.send('ai:event', {
        type: 'open_floor_closed',
        conversationId,
        totalResponses: total,
        skippedAgents: skipped,
      })
    }

    writeObservabilityEvent('open_floor:completed', {
      conversationId,
      totalResponses: total,
      skippedAgents: skipped,
    })
  }

  /** Stop an active open floor discussion early */
  stopOpenFloor(conversationId: string): void {
    const state = this.openFloorStates.get(conversationId)
    if (state && state.status === 'active') {
      state.status = 'closing'

      // Abort the AbortController so Promise.race resolves early and
      // each agent's promise loop exits at the next check point
      const controller = this.openFloorControllers.get(conversationId)
      if (controller) {
        controller.abort()
        this.openFloorControllers.delete(conversationId)
      }

      // Abort all registered Open Floor runtimes to interrupt in-flight LLM calls
      const prefix = `${conversationId}:`
      this.runtimes.forEach((runtime, key) => {
        if (key.startsWith(prefix) && runtime.isActive) {
          runtime.abort()
          writeObservabilityEvent('runtime:terminated', {
            conversationId,
            profileId: key.split(':')[1],
            runtimeKey: key,
            reason: 'open_floor_stopped',
          })
        }
      })

      writeObservabilityEvent('open_floor:stopped', { conversationId })
    }
  }

  /** Build conversation context for open floor observation */
  private async buildConversationContext(
    conversationId: string
  ): Promise<Array<{ role: string; content: string }>> {
    const db = getDb()
    const rows = db.prepare(
      `SELECT role, content FROM messages
       WHERE conversation_id = ? AND content IS NOT NULL
       ORDER BY created_at ASC
       LIMIT 20`
    ).all(conversationId) as Array<{ role: string; content: string }>
    return rows
  }

  // ─── Layer 5: Task scheduling ─────────────────────────────────────────────

  private async scheduleTask(
    conversationId: string,
    planned: PlannedTask,
    chain: string[],
    depth: number,
    executionMode: ExecutionMode,
    baseConfig: SessionConfig,
    webContents: WebContents,
    source?: 'user' | 'agent-scan',
    parentTask?: A2ATask
  ): Promise<string | undefined> {
    // Ping-pong detection
    if (this.isPingPong(chain, planned.toProfileId)) {
      const fromName = this.profileName(chain[chain.length - 1] ?? 'user')
      const toName = this.profileName(planned.toProfileId)
      this.appendSystemMessage(webContents, conversationId, `检测到 ${fromName} ↔ ${toName} 循环委托，已阻断`)
      return undefined
    }

    const toProfile = this.loadProfile(planned.toProfileId)
    if (!toProfile) return undefined

    // Layer 4: assemble context
    const contextSnapshot = assembleContext({
      conversationId,
      strategy: planned.contextStrategy,
      fromAgentName: planned.fromProfileName,
      fromAgentProfileId: planned.fromProfileId,
      fromAgentOutput: planned.fromAgentOutput,
      toAgentName: toProfile.name,
      toAgentRole: toProfile.role,
      instruction: planned.message,
    })

    const task: A2ATask = {
      id: randomUUID(),
      conversationId,
      fromProfileId: planned.fromProfileId,
      toProfileId: planned.toProfileId,
      message: planned.message,
      contextSnapshot,
      status: 'pending',
      depth,
      chain: [...chain, planned.toProfileId],
      executionMode,
      readOnly: planned.readOnly,
      createdAt: Math.floor(Date.now() / 1000),
      source: source ?? 'user',
      parentTaskId: parentTask?.id
    }

    this.persistTask(task)
    this.persistEdge({
      id: randomUUID(),
      conversationId,
      fromNodeId: planned.fromProfileId,
      toNodeId: task.id,
      edgeType: planned.edgeType,
      label: planned.edgeLabel,
    })
    this.send(webContents, 'a2a:taskCreated', task)

    // Register completion hook so the parent agent automatically receives a
    // feedback follow-up when the child task completes. This applies both to
    // agent-initiated @mentions and user-initiated @mentions — without it,
    // delegated agents finish silently and never report back.
    if (parentTask) {
      this.registerCompletionHook(task.id, (completedTask, output) => {
        this.handleChildComplete(parentTask, completedTask, output)
      })
    }

    if (executionMode === 'parallel') {
      this.invocationQueue.trackParallel(conversationId, task.id)
      writeObservabilityEvent('task:enqueued', { taskId: task.id, conversationId, profileId: task.toProfileId, runtimeKey: runtimeKey(conversationId, task.toProfileId, task.id) })
      this.executeTask(task, toProfile, baseConfig, executionMode, webContents).catch(() => {})
    } else {
      const position = this.invocationQueue.enqueue(conversationId, task)
      writeObservabilityEvent('task:enqueued', { taskId: task.id, conversationId, profileId: task.toProfileId, runtimeKey: runtimeKey(conversationId, task.toProfileId, task.id) })
      if (webContents && !webContents.isDestroyed()) {
        this.send(webContents, 'a2a:taskQueued', { taskId: task.id, conversationId, position })
      }
    }

    return task.id
  }

  // ─── Layer 5: Task execution ─────────────────────────────────────────────

  private async executeTask(
    task: A2ATask,
    profile: AgentProfile,
    baseConfig: SessionConfig,
    executionMode: ExecutionMode,
    webContents: WebContents
  ): Promise<void> {
    const conversationId = task.conversationId
    const key = runtimeKey(conversationId, profile.id, task.id)
    this.updateTaskStatus(task.id, 'working')
    writeObservabilityEvent('task:started', { taskId: task.id, conversationId, profileId: profile.id })

    // Create or load continuity capsule for this task
    let capsule = this.capsuleManager.getByTaskId(task.id)
    if (!capsule) {
      const parentCapsuleId = task.parentTaskId
        ? this.capsuleManager.getByTaskId(task.parentTaskId)?.id
        : undefined
      capsule = this.capsuleManager.create(task, parentCapsuleId, task.chainIndex, task.chainTotal)
    }

    // If this task is resuming a sealed parent session, prepend a continuation
    // prompt so the Agent knows it's picking up where it left off.
    const parentCapsule = task.parentTaskId
      ? this.capsuleManager.getByTaskId(task.parentTaskId)
      : undefined
    const continuationPrefix = parentCapsule && this.capsuleManager.isSessionResumable(parentCapsule.id)
      ? formatContinuationPrompt(parentCapsule) + '\n\n'
      : ''

    // Accumulate agent output for completion hooks (chain callbacks)
    let accumulatedOutput = ''
    let terminalError: string | null = null

    const allEnabledProfiles = this.loadAllEnabledProfiles()
    const runtime = new AgentRuntime(profile)
    runtime.setKnownAgents(allEnabledProfiles)

    // Agent card injection — team members only, exclude self
    const teamId = this.getConversationTeamId(conversationId)
    const agentCardSection = teamId ? this.buildAgentCardSection(teamId, profile.id) : ''
    runtime.setAgentCardSection(agentCardSection)
    this.runtimes.set(key, runtime)

    runtime.on('event', (event) => {
      if (event.type === 'complete' && event.fullText) {
        accumulatedOutput = event.fullText as string
      }
      if (event.type === 'tool_start' && isFileTool(event.toolName)) {
        if (task.readOnly) {
          this.appendSystemMessage(webContents, conversationId, `只读任务禁止文件修改工具 ${event.toolName}，已停止该 Agent`)
          runtime.abort()
          return
        }
      }
      if (!webContents.isDestroyed()) {
        webContents.send('ai:event', {
          ...event,
          conversationId,
          agentProfileId: profile.id === 'default' ? null : profile.id,
          taskId: task.id,
          sessionId: runtime.sessionId
        })
      }
    })

    // Handle agent-initiated @mentions — dispatch through the full 5-layer pipeline.
    // Track pending dispatch so executeTask can wait for it before returning;
    // otherwise drainSerialQueue may run before child tasks are enqueued.
    let pendingMentionDispatch: Promise<void> | null = null

    runtime.on('mention', (mentionEvent: { mentions: ParsedMention[]; fromProfileId: string; fullText: string }) => {
      const mentionText = mentionEvent.mentions
        .map((m) => `@${m.agentName}: ${m.taskContent}`)
        .join('\n')
      pendingMentionDispatch = this.dispatchIntents(
        conversationId, mentionText, profile,
        task.chain, task.depth + 1, executionMode, baseConfig, webContents,
        mentionEvent.fullText, undefined, undefined,
        task
      ).catch(() => {})
    })

    const messageContent = task.contextSnapshot
      ? `${continuationPrefix}${task.contextSnapshot}\n\n---\n\n你的任务：\n${task.message}`
      : `${continuationPrefix}${task.message}`

    try {
      const taskTableOverrides = this.getTaskTableOverrides(conversationId)
      const a2aTaskOverrides = task.providerOverride || task.modelOverride
        ? { providerType: task.providerOverride, model: task.modelOverride }
        : undefined
      const memberOverrides = this.getTeamMemberRuntimeOverrides(conversationId, profile.id)
      const runtimeOverrides = this.mergeRuntimeOverrides(memberOverrides, a2aTaskOverrides, taskTableOverrides)
      const runtimeConfig = task.readOnly ? { ...baseConfig, permissionMode: 'manual' as const } : baseConfig

      await runtime.start(runtimeConfig, runtimeOverrides)
      writeObservabilityEvent('runtime:started', { taskId: task.id, conversationId, profileId: profile.id, runtimeKey: key })
      const sessionIdAtStart = runtime.sessionId

      // ACP protocol leverage: ensure the correct model is loaded.
      // Switch to the resolved model (honoring task/member overrides) rather
      // than the profile default, so task-level model selection is respected.
      const resolvedModel = runtimeOverrides?.model ?? profile.model
      if (sessionIdAtStart && resolvedModel) {
        try {
          await runtime.switchModel(resolvedModel)
        } catch {
          // Non-ACP providers may not support dynamic model switching
        }
      }

      // Seal the continuity capsule with the session ID for potential resume
      if (capsule && sessionIdAtStart) {
        this.capsuleManager.seal(capsule.id, sessionIdAtStart, 0)
      }

      await new Promise<void>((resolve) => {
        runtime.on('event', (event) => {
          if (event.type === 'done' || event.type === 'error') {
            if (event.type === 'error') terminalError = event.error
            // Wait for any mention dispatch to finish before resolving,
            // so child tasks are enqueued before drainSerialQueue runs.
            const finalize = (): void => { resolve() }
            if (pendingMentionDispatch) {
              pendingMentionDispatch.then(finalize).catch(finalize)
            } else {
              finalize()
            }
          }
        })
        runtime.send(messageContent)
      })

      await runtime.dispose()
      this.runtimes.delete(key)
      writeObservabilityEvent('runtime:terminated', { taskId: task.id, conversationId, profileId: profile.id, runtimeKey: key, reason: 'completed' })

      if (this.zombieTaskIds.delete(task.id)) {
        return
      }

      if (terminalError) {
        throw new Error(terminalError)
      }

      this.invocationQueue.untrackParallel(task.id)
      this.updateTaskStatus(task.id, 'completed')
      writeObservabilityEvent('task:completed', { taskId: task.id, conversationId, profileId: profile.id, runtimeKey: key })
      if (capsule) this.capsuleManager.complete(capsule.id, 'completed')
      this.invokeCompletionHook(task, accumulatedOutput)
      this.send(webContents, 'a2a:taskCompleted', { taskId: task.id, conversationId })
      this.extractMemoryCandidates(conversationId, profile)

      // Persist session ID for primary agent so the next user turn can --resume
      // instead of injecting conversation history. Store with a config fingerprint
      // so stale entries are discarded if provider/model/workingDir/permissionMode change.
      if (task.depth === 0 && !task.readOnly && sessionIdAtStart) {
        const fingerprint = `${baseConfig.providerType}:${baseConfig.model}:${baseConfig.workingDir}:${baseConfig.permissionMode}`
        this.primarySessionIds.set(`${conversationId}:${profile.id}`, { sessionId: sessionIdAtStart, fingerprint })
      }

      // Serial queue draining is handled by the caller (sendUserMessage) to avoid nested recursion
    } catch (error) {
      await runtime.dispose().catch(() => {})
      this.runtimes.delete(key)
      writeObservabilityEvent('runtime:terminated', { taskId: task.id, conversationId: task.conversationId, profileId: profile.id, runtimeKey: key, reason: 'crashed' })
      this.invocationQueue.untrackParallel(task.id)
      this.updateTaskStatus(task.id, 'failed')
      writeObservabilityEvent('task:failed', { taskId: task.id, conversationId: task.conversationId, profileId: profile.id, runtimeKey: key, error: String(error) })
      if (capsule) this.capsuleManager.complete(capsule.id, 'needs_owner', String(error))
      this.invokeCompletionHook(task, accumulatedOutput || String(error))
      this.send(webContents, 'a2a:taskCompleted', { taskId: task.id, conversationId, error: String(error) })

      // Clear stored session ID so a failed session is never blindly resumed.
      if (task.depth === 0) {
        this.primarySessionIds.delete(`${conversationId}:${profile.id}`)
      }
    }
  }

  // ─── Ping-pong detection ──────────────────────────────────────────────────

  private isPingPong(chain: string[], nextProfileId: string): boolean {
    const agentChain = [...chain, nextProfileId].filter((id) => id !== 'user')
    if (agentChain.length < 4) return false
    const len = agentChain.length
    const a = agentChain[len - 4]
    const b = agentChain[len - 3]
    const c = agentChain[len - 2]
    const d = agentChain[len - 1]
    return a === c && b === d && a !== b
  }

  // ─── Serial queue ─────────────────────────────────────────────────────────

  private async drainSerialQueue(
    conversationId: string,
    webContents: WebContents
  ): Promise<void> {
    if (this.drainingQueues.has(conversationId)) return

    const baseConfig = this.baseConfigs.get(conversationId)
    if (!baseConfig) return

    this.drainingQueues.add(conversationId)
    try {
      while (true) {
        const queued = this.invocationQueue.dequeue(conversationId)
        if (!queued) break
        const next = queued.task
        this.invocationQueue.markProcessing(conversationId, next.id)
        const profile = this.loadProfile(next.toProfileId) ?? defaultProfile(baseConfig.model)
        try {
          await this.executeTask(next, profile, baseConfig, next.executionMode, webContents)
        } catch {
          // Error already handled inside executeTask; continue with next task
        } finally {
          this.invocationQueue.markDone(conversationId)
        }
        // Yield to the microtask queue so that any completion hooks fired
        // synchronously inside executeTask (e.g. handleChildComplete →
        // createFeedbackTask) have a chance to enqueue follow-up tasks
        // before we check the queue again.
        await Promise.resolve()
      }
    } finally {
      this.drainingQueues.delete(conversationId)
    }

    // Chain-level memory distillation: when the root capsule is completed and
    // no tasks are actively running, extract cross-agent conventions and lessons.
    const rootCapsule = this.capsuleManager.getRootCapsule(conversationId)
    const activeTasks = this.getActiveTasks(conversationId)
    if (rootCapsule?.ballState === 'completed' && activeTasks.length === 0) {
      this.memoryDistiller.distillChain(conversationId).then((d) => {
        if (d) this.memoryDistiller.persistToMemoryPalace(d)
      }).catch(() => {
        // Swallow distillation errors to avoid breaking the task flow
      })
    }
  }

  // ─── DB helpers ───────────────────────────────────────────────────────────

  private loadProfile(id: string): AgentProfile | null {
    if (id === 'default') return null
    const db = getDb()
    const row = db.prepare(
      `SELECT id, workspace_id, name, role, model, description, system_prompt,
              preferred_provider, capabilities, when_to_use, output_contract,
              is_enabled, sort_order, created_at, updated_at
       FROM agent_profile_configs WHERE id = ?`
    ).get(id) as AgentProfileRow | undefined
    return row ? rowToProfile(row) : null
  }

  private loadAllEnabledProfiles(): AgentProfile[] {
    const db = getDb()
    const rows = db.prepare(
      `SELECT id, workspace_id, name, role, model, description, system_prompt,
              preferred_provider, capabilities, when_to_use, output_contract,
              is_enabled, sort_order, created_at, updated_at
       FROM agent_profile_configs WHERE is_enabled = 1 ORDER BY sort_order ASC`
    ).all() as AgentProfileRow[]
    return rows.map(rowToProfile)
  }

  private loadTeamMemberProfiles(teamId: string): AgentProfile[] {
    const team = getTeam(teamId)
    if (!team?.members || team.members.length === 0) return []
    const memberIds = team.members.map((m) => m.profileId)
    const db = getDb()
    const placeholders = memberIds.map(() => '?').join(',')
    const rows = db.prepare(
      `SELECT id, workspace_id, name, role, model, description, system_prompt,
              preferred_provider, capabilities, when_to_use, output_contract,
              is_enabled, sort_order, created_at, updated_at
       FROM agent_profile_configs WHERE id IN (${placeholders}) AND is_enabled = 1`
    ).all(...memberIds) as AgentProfileRow[]
    return rows.map(rowToProfile)
  }

  private collectKnownNames(): string[] {
    return this.loadAllEnabledProfiles().map((p) => p.name)
  }

  private collectKnownCapabilities(profiles: AgentProfile[]): string[] {
    const caps = new Set<string>()
    for (const p of profiles) {
      for (const c of p.capabilities ?? []) caps.add(c.toLowerCase())
    }
    return Array.from(caps)
  }

  private getConversationTeamId(conversationId: string): string | null {
    const db = getDb()
    const row = db.prepare(`SELECT team_id FROM conversations WHERE id = ?`).get(conversationId) as { team_id: string | null } | undefined
    return row?.team_id ?? null
  }

  private getConversationWorkspaceId(conversationId: string): string | null {
    const db = getDb()
    const row = db.prepare(`SELECT workspace_id FROM conversations WHERE id = ?`).get(conversationId) as { workspace_id: string | null } | undefined
    return row?.workspace_id ?? null
  }

  private getTaskTableOverrides(conversationId: string): { providerType?: string; model?: string } | undefined {
    const db = getDb()
    const row = db.prepare(
      `SELECT t.provider_override, t.model_override FROM conversations c JOIN tasks t ON t.id = c.task_id WHERE c.id = ?`
    ).get(conversationId) as { provider_override: string | null; model_override: string | null } | undefined
    if (!row?.provider_override && !row?.model_override) return undefined
    return { providerType: row.provider_override ?? undefined, model: row.model_override ?? undefined }
  }

  private getTeamMemberRuntimeOverrides(conversationId: string, profileId: string): { providerType?: string; model?: string } | undefined {
    const teamId = this.getConversationTeamId(conversationId)
    if (!teamId) return undefined
    const member = getTeam(teamId)?.members?.find((m) => m.profileId === profileId)
    if (!member?.providerOverride && !member?.modelOverride) return undefined
    return { providerType: member.providerOverride, model: member.modelOverride }
  }

  private mergeRuntimeOverrides(
    memberOverrides?: { providerType?: string; model?: string },
    a2aTaskOverrides?: { providerType?: string; model?: string },
    taskTableOverrides?: { providerType?: string; model?: string }
  ): { providerType?: string; model?: string } | undefined {
    const merged = {
      providerType: taskTableOverrides?.providerType ?? a2aTaskOverrides?.providerType ?? memberOverrides?.providerType,
      model: taskTableOverrides?.model ?? a2aTaskOverrides?.model ?? memberOverrides?.model,
    }
    return merged.providerType || merged.model ? merged : undefined
  }

  private getTaskCount(conversationId: string): number {
    const db = getDb()
    const row = db.prepare(`SELECT COUNT(*) AS cnt FROM a2a_tasks WHERE conversation_id = ?`).get(conversationId) as { cnt: number }
    return row.cnt
  }

  private buildAgentCardSection(teamId: string, excludeProfileId: string): string {
    const profiles = this.loadTeamMemberProfiles(teamId).filter((p) => p.id !== excludeProfileId)
    if (profiles.length === 0) return ''
    const entries = profiles.map((p) => {
      const whenToUse = p.whenToUse || '未指定'
      const outputContract = p.outputContract || '未指定'
      return `**@${p.name}（${p.role}）**\n- 职责：${whenToUse}\n- 期望输出：${outputContract}\n- 用法：\`@${p.name}: [任务描述]\``
    })
    return `## 团队成员\n\n${entries.join('\n\n')}`
  }

  private extractMemoryCandidates(conversationId: string, profile: AgentProfile): void {
    const db = getDb()
    const convRow = db.prepare(`SELECT workspace_id FROM conversations WHERE id = ?`).get(conversationId) as { workspace_id: string | null } | undefined
    if (!convRow?.workspace_id) return

    const msgRow = db.prepare(
      `SELECT id, content FROM messages WHERE conversation_id = ? AND role = 'assistant' AND content IS NOT NULL ORDER BY created_at DESC LIMIT 1`
    ).get(conversationId) as { id: string; content: string } | undefined
    if (!msgRow) return

    const candidates = extractCandidates({ workspaceId: convRow.workspace_id, conversationId, messageId: msgRow.id, agentRole: profile.role, fullText: msgRow.content })
    const now = Math.floor(Date.now() / 1000)
    for (const c of candidates) {
      createCandidate({
        id: randomUUID(),
        workspace_id: convRow.workspace_id,
        kind: c.kind,
        title: c.title,
        content: c.content,
        source_conversation_id: conversationId,
        source_message_id: msgRow.id,
        confidence: c.confidence,
        status: 'captured'
      })
    }
  }

  private persistTask(task: A2ATask): void {
    const db = getDb()
    db.prepare(`
      INSERT OR IGNORE INTO a2a_tasks
        (id, conversation_id, from_profile_id, to_profile_id, message, context_snapshot, status, depth, chain, execution_mode, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(task.id, task.conversationId, task.fromProfileId, task.toProfileId, task.message, task.contextSnapshot, task.status, task.depth, JSON.stringify(task.chain), task.executionMode, task.source ?? null, task.createdAt)
  }

  private persistEdge(edge: { id: string; conversationId: string; fromNodeId: string | null; toNodeId: string; edgeType: string; label?: string }): void {
    const db = getDb()
    db.prepare(`
      INSERT OR IGNORE INTO agent_task_edges (id, conversation_id, from_node_id, to_node_id, edge_type, label, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(edge.id, edge.conversationId, edge.fromNodeId, edge.toNodeId, edge.edgeType, edge.label ?? null, Math.floor(Date.now() / 1000))
  }

  private updateTaskStatus(taskId: string, status: A2ATask['status']): void {
    const db = getDb()
    const now = Math.floor(Date.now() / 1000)
    if (status === 'completed' || status === 'failed') {
      db.prepare(`UPDATE a2a_tasks SET status = ?, completed_at = ? WHERE id = ?`).run(status, now, taskId)
    } else {
      db.prepare(`UPDATE a2a_tasks SET status = ? WHERE id = ?`).run(status, taskId)
    }
  }

  private rowToTask(row: Record<string, unknown>): A2ATask {
    return {
      id: row.id as string,
      conversationId: row.conversation_id as string,
      fromProfileId: (row.from_profile_id as string | null) ?? null,
      toProfileId: row.to_profile_id as string,
      message: row.message as string,
      contextSnapshot: (row.context_snapshot as string) ?? '',
      status: row.status as A2ATask['status'],
      depth: row.depth as number,
      chain: (() => { try { return JSON.parse((row.chain as string) ?? '[]') } catch { return [] } })(),
      executionMode: (row.execution_mode as ExecutionMode) ?? 'serial',
      source: (row.source as 'user' | 'agent-scan' | undefined) ?? undefined,
      createdAt: row.created_at as number,
      completedAt: row.completed_at as number | undefined,
      result: row.result as string | undefined
    }
  }

  private profileName(id: string): string {
    if (id === 'user') return 'User'
    if (id === 'default') return 'Assistant'
    return this.loadProfile(id)?.name ?? id
  }

  private findParentTaskForReflow(group: ReflowGroup): A2ATask | undefined {
    const db = getDb()
    const row = db.prepare(`SELECT * FROM a2a_tasks WHERE id = ?`).get(group.triggerTaskId) as Record<string, unknown> | undefined
    return row ? this.rowToTask(row) : undefined
  }

  private appendSystemMessage(webContents: WebContents, conversationId: string, content: string): void {
    if (!webContents.isDestroyed()) webContents.send('ai:event', { type: 'system_message', conversationId, content })
  }

  private send(webContents: WebContents, channel: string, payload: unknown): void {
    if (!webContents.isDestroyed()) webContents.send(channel, payload)
  }

  private routingErrorMessage(error: { type: string; agentName?: string; capability?: string }): string {
    switch (error.type) {
      case 'no_target': return `找不到 Agent "${error.agentName}"，委托被忽略`
      case 'no_capability_match': return `没有 Agent 具备能力 "${error.capability}"，委托被忽略`
      case 'no_reviewers': return `未找到 code-review 能力的 Agent`
      default: return '路由错误，委托被忽略'
    }
  }

  // ─── Chain Callbacks (Completion Hooks) ────────────────────────────────────

  private registerCompletionHook(
    taskId: string,
    hook: (task: A2ATask, output: string) => void
  ): void {
    this.completionHooks.set(taskId, hook)
  }

  private invokeCompletionHook(task: A2ATask, output: string): void {
    const hook = this.completionHooks.get(task.id)
    if (hook) {
      try {
        hook(task, output)
      } catch {
        // Swallow hook errors to avoid breaking the task execution flow
      }
      this.completionHooks.delete(task.id)
    }
  }

  private async handleChildComplete(
    parentTask: A2ATask,
    childTask: A2ATask,
    childOutput: string
  ): Promise<void> {
    const group = this.reflowOrchestrator.getGroupForTask(childTask.id)

    if (group) {
      // Part of a reflow group — record result and check readiness.
      // onChildComplete/onChildFail internally call tryAggregate(); we only
      // need to inspect the resulting group state here.
      if (childTask.status === 'failed') {
        this.reflowOrchestrator.onChildFail(childTask.id, childOutput)
      } else {
        this.reflowOrchestrator.onChildComplete(childTask.id, childOutput)
      }

      // If state is still 'running', more children are pending.
      if (group.state === 'running') return

      // Group is ready — create a single aggregated feedback task
      const aggregatedMessage = this.reflowOrchestrator.buildAggregationMessage(group)
      await this.createFeedbackTask(parentTask, childTask, aggregatedMessage, group.id)
      this.reflowOrchestrator.disposeGroup(group.id)
    } else {
      // Single child — direct feedback
      await this.createFeedbackTask(parentTask, childTask, childOutput)
    }
  }

  private async createFeedbackTask(
    parentTask: A2ATask,
    childTask: A2ATask,
    childOutput: string,
    reflowGroupId?: string
  ): Promise<void> {
    // Route the child result back to the immediate delegating agent.
    const feedbackToProfileId = parentTask.toProfileId
    if (!feedbackToProfileId) return
    const conversationId = parentTask.conversationId
    const webContents = this.webContentsMap.get(conversationId)

    const feedbackDepth = childTask.depth + 1
    if (feedbackDepth > MAX_DELEGATION_DEPTH) {
      if (webContents && !webContents.isDestroyed()) {
        this.appendSystemMessage(webContents, conversationId, `反馈任务已达最大委托深度（${MAX_DELEGATION_DEPTH}），已阻断`)
      }
      return
    }

    if (this.getTaskCount(conversationId) + 1 > MAX_TASKS_PER_CONVERSATION) {
      if (webContents && !webContents.isDestroyed()) {
        this.appendSystemMessage(webContents, conversationId, `反馈任务将超过任务数上限（${MAX_TASKS_PER_CONVERSATION}），已阻断`)
      }
      return
    }

    if (this.isPingPong(childTask.chain, feedbackToProfileId)) {
      if (webContents && !webContents.isDestroyed()) {
        const fromName = this.profileName(childTask.toProfileId)
        const toName = this.profileName(feedbackToProfileId)
        this.appendSystemMessage(webContents, conversationId, `检测到 ${fromName} ↔ ${toName} 反馈循环，已阻断`)
      }
      return
    }

    const truncatedOutput = childOutput.length > 2000
      ? childOutput.slice(0, 2000) + '\n\n[输出过长，已截断...]'
      : childOutput

    const feedbackMessage = reflowGroupId
      ? childOutput
      : `[@${childTask.toProfileId} 的任务已完成]\n\n${truncatedOutput}\n\n请查看结果并决定下一步行动。`

    const feedbackTask: A2ATask = {
      id: randomUUID(),
      conversationId,
      fromProfileId: childTask.toProfileId,
      toProfileId: feedbackToProfileId,
      message: feedbackMessage,
      contextSnapshot: assembleContext({
        conversationId,
        strategy: 'handoff',
        fromAgentName: this.profileName(childTask.toProfileId),
        fromAgentProfileId: childTask.toProfileId,
        fromAgentOutput: childOutput,
        toAgentName: this.profileName(feedbackToProfileId),
        toAgentRole: this.loadProfile(feedbackToProfileId)?.role ?? 'assistant',
        instruction: feedbackMessage,
      }),
      status: 'pending',
      depth: feedbackDepth,
      chain: [...childTask.chain, feedbackToProfileId],
      executionMode: 'serial',
      source: 'agent-scan',
      createdAt: Math.floor(Date.now() / 1000)
    }

    this.persistTask(feedbackTask)
    writeObservabilityEvent('feedback:created', { taskId: feedbackTask.id, conversationId: feedbackTask.conversationId, profileId: feedbackToProfileId, runtimeKey: runtimeKey(feedbackTask.conversationId, feedbackToProfileId, feedbackTask.id) })
    this.persistEdge({
      id: randomUUID(),
      conversationId: feedbackTask.conversationId,
      fromNodeId: childTask.id,
      toNodeId: feedbackTask.id,
      edgeType: 'feedback',
      label: reflowGroupId
        ? `Reflow aggregate → ${feedbackToProfileId}`
        : `@${childTask.toProfileId} complete → ${feedbackToProfileId}`
    })

    const position = this.invocationQueue.enqueue(
      feedbackTask.conversationId,
      feedbackTask,
      `feedback:${childTask.id}→${feedbackToProfileId}`
    )

    if (webContents && !webContents.isDestroyed()) {
      this.send(webContents, 'a2a:taskCreated', feedbackTask)
      this.send(webContents, 'a2a:taskQueued', { taskId: feedbackTask.id, conversationId: feedbackTask.conversationId, position })
      if (!this.hasActiveRuntime(feedbackTask.conversationId)) {
        void this.drainSerialQueue(feedbackTask.conversationId, webContents)
      }
    }
  }
}

export const orchestrator = new AgentOrchestrator()
