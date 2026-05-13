import { EventEmitter } from 'events'
import { aiEngine } from './engine'
import { scanAgentOutput } from './agent-output-scanner'
import { resolveRuntime } from './runtime-resolver'
import type { AgentProfile, Observation, ObservationTool } from './a2a-types'
import type { SessionConfig, Session } from './provider'
import type { AIEvent } from './types'
import type { ParsedMention } from './a2a-types'
import { OPEN_FLOOR_INSTRUCTION, OPEN_FLOOR_ALLOWED_TOOLS } from './prompts/open-floor'
import { agentMemory } from '../daemon/agent-memory'
import { StallDetector } from './stall-detector'

export interface AgentMentionEvent {
  type: 'agent_mention'
  mentions: ParsedMention[]
  fromProfileId: string
  fullText: string
}

export type AgentRuntimeEvent = AIEvent | AgentMentionEvent

export function assessOpenFloorRelevance(params: {
  topic: string
  myCapabilities: string[]
  myInterests: string
}): { score: number } {
  const topicLower = params.topic.toLowerCase()

  // Capability match: does the topic contain any of my capability keywords?
  const capabilityMatch = params.myCapabilities.some((cap) =>
    topicLower.includes(cap.toLowerCase())
  )

  // Interest match: does my whenToUse overlap with the topic? For CJK topics,
  // also allow the shorter topic phrase to be contained in the longer interest text.
  const interestTokens = params.myInterests
    .toLowerCase()
    .split(/[\s,，、。；;：:（）()]+/)
    .filter((t) => t.length > 1)
  const interestMatch = interestTokens.some((token) =>
    topicLower.includes(token) || token.includes(topicLower)
  )

  let score = 0.35 // Default opt-in floor for Open Floor so discussions do not dead-end.
  if (capabilityMatch) score += 0.4
  if (interestMatch) score += 0.25

  return { score: Math.min(1, score) }
}

export class AgentRuntime extends EventEmitter {
  readonly profile: AgentProfile
  private session: Session | null = null
  private knownAgents: AgentProfile[] = []
  private agentCardSection: string = ''
  private eventHandler: ((event: AIEvent) => void) | null = null
  private lastWorkingDir: string = ''
  private lastProviderType: string = ''
  private observationSessionId: string | null = null
  private _suspended = false // Aligns with Slock: explicit start/stop lifecycle
  private stallDetector: StallDetector | null = null

  constructor(profile: AgentProfile) {
    super()
    this.profile = profile
  }

  setKnownAgents(agents: AgentProfile[]): void {
    this.knownAgents = agents
  }

  setAgentCardSection(section: string): void {
    this.agentCardSection = section
  }

  async start(config: SessionConfig, overrides?: { providerType?: string; model?: string }): Promise<Session> {
    this.lastWorkingDir = config.workingDir
    this.lastProviderType = config.providerType

    const systemPromptParts: string[] = []

    if (this.profile.systemPrompt) {
      systemPromptParts.push(this.profile.systemPrompt)
    }

    // Phase B: load agent memory and inject as context
    if (this.profile.id !== 'default') {
      try {
        const memoryContent = await agentMemory.load(this.profile.id)
        if (memoryContent) {
          systemPromptParts.push(`## 你的持久记忆\n\n以下是你在过往对话中积累的知识。请将其作为参考，但不要逐字复述：\n\n${memoryContent}\n\n**注意**：当上下文因 token 限制被压缩时，MEMORY.md 是唯一保留的恢复锚点。在完成重要工作后，主动更新 MEMORY.md 记录关键决策和上下文，确保后续会话能从记忆恢复。`)
          console.debug(`[AgentRuntime] ${this.profile.name}: memory injected (${memoryContent.length} chars)`)
        } else {
          await agentMemory.initialize(this.profile.id, {
            name: this.profile.name,
            role: this.profile.role,
          })
        }
      } catch (err) {
        console.warn(`[AgentRuntime] ${this.profile.name}: memory load failed, continuing without memory:`, err)
      }
    }

    const otherAgents = this.knownAgents.filter((a) => a.id !== this.profile.id)
    if (this.agentCardSection) {
      systemPromptParts.push(
        `平台注入的当前 Team 成员如下；当它与原 systemPrompt 中的成员描述冲突时，以这里为准：\n\n${this.agentCardSection}\n\n使用方式：在回复中单独一行写 \`@AgentName: 具体任务描述\`。需要让全部成员只读发散时，写 \`@All: 具体任务描述\`。只在确实需要另一个 agent 的专业能力时才委托。`
      )
    } else if (otherAgents.length > 0) {
      const agentCards = otherAgents
        .map((a) => {
          const whenToUse = a.whenToUse ?? 'No description available'
          const outputContract = a.outputContract ?? 'No output format specified'
          const capabilities = a.capabilities?.length ? a.capabilities.join(', ') : 'No capability tags'
          return `@${a.name} (${a.role})\n  能力标签：${capabilities}\n  调用时机：${whenToUse}\n  期望输出：${outputContract}`
        })
        .join('\n\n')
      systemPromptParts.push(`平台注入的当前 Team 成员如下；当它与原 systemPrompt 中的成员描述冲突时，以这里为准：\n\n${agentCards}\n\n使用方式：在回复中单独一行写 \`@AgentName: 具体任务描述\`。需要让全部成员只读发散时，写 \`@All: 具体任务描述\`。只在确实需要另一个 agent 的专业能力时才委托。`)
    }

    const resolved = resolveRuntime(
      this.profile.id === 'default' ? null : this.profile,
      config,
      overrides
    )

    const fullConfig: SessionConfig = {
      ...config,
      providerType: resolved.providerType,
      model: resolved.model,
      appendSystemPrompt: systemPromptParts.length > 0 ? systemPromptParts.join('\n\n') : undefined
    }

    this.session = await aiEngine.startSession(fullConfig)
    this.attachEventHandler()

    // Initialize stall detector for this provider
    this.stallDetector = new StallDetector(
      this.profile.id,
      this.profile.name,
      resolved.providerType
    )

    return this.session
  }

  /** For backward compatibility — name-only delegation */
  setKnownAgentNames(names: string[]): void {
    this.knownAgents = names.map((name) => ({
      id: name.toLowerCase(),
      workspaceId: null,
      name,
      role: 'unknown',
      model: '',
      description: null,
      systemPrompt: null,
      isEnabled: true,
      sortOrder: 0,
      createdAt: 0,
      updatedAt: 0
    }))
  }

  send(content: string): void {
    if (!this.session) throw new Error(`AgentRuntime[${this.profile.name}]: not started`)
    aiEngine.sendMessage(this.session.id, content)
  }

  async switchModel(modelId: string): Promise<void> {
    if (!this.session) throw new Error(`AgentRuntime[${this.profile.name}]: not started`)
    await aiEngine.setModel(this.session.id, modelId)
  }

  respondPermission(approved: boolean): void {
    if (!this.session) return
    aiEngine.respondPermission(this.session.id, approved)
  }

  respondQuestion(answer: string): void {
    if (!this.session) return
    aiEngine.respondQuestion(this.session.id, answer)
  }

  abort(): void {
    if (this.session) aiEngine.abort(this.session.id)
    if (this.observationSessionId) {
      aiEngine.abort(this.observationSessionId)
      this.observationSessionId = null
    }
  }

  /** Suspend the runtime — abort active sessions but keep profile/config (aligns with Slock: explicit stop) */
  suspend(): void {
    this._suspended = true
    this.abort()
    console.info(`[AgentRuntime] ${this.profile.name}: suspended`)
  }

  /** Resume the runtime from suspended state (aligns with Slock: explicit start) */
  async resume(config: SessionConfig, overrides?: { providerType?: string; model?: string }): Promise<Session> {
    this._suspended = false
    const session = await this.start(config, overrides)
    console.info(`[AgentRuntime] ${this.profile.name}: resumed`)
    return session
  }

  /** Check if the runtime is suspended */
  get isSuspended(): boolean {
    return this._suspended
  }

  // ─── Open Floor / Observation Mode ─────────────────────────────────────────

  async onObservation(obs: Observation): Promise<{ reply?: string; relevanceScore: number }> {
    // Compute relevance for UI display and diagnostics only — not a hard gate.
    // The agent's LLM decides whether to participate via its Open Floor system prompt.
    const relevance = await this.assessRelevance({
      topic: obs.message,
      myCapabilities: this.profile.capabilities ?? [],
      myInterests: this.profile.whenToUse ?? '',
    })

    // Always attempt to generate a reply — the agent's LLM self-judges relevance.
    try {
      const raw = await this.generateObservationReply(obs)
      const trimmed = raw?.trim() ?? ''
      // Normalize machine-readable sentinels: NO_REPLY / [NO_REPLY] / empty → silent
      if (trimmed === 'NO_REPLY' || trimmed === '[NO_REPLY]' || trimmed === '') {
        return { relevanceScore: relevance.score }
      }
      return { reply: raw, relevanceScore: relevance.score }
    } catch {
      return { relevanceScore: relevance.score }
      // Swallow generation errors — orchestrator will record as skipped
    }
  }

  // ─── Tool Calling ─────────────────────────────────────────────────────────

  /** Build tool definitions section for the system prompt. */
  private buildToolPrompt(tools?: ObservationTool[]): string {
    if (!tools || tools.length === 0) return ''

    const toolDescs = tools.map(t => {
      const params = Object.entries(t.parameters)
        .map(([name, def]) => `  - ${name} (${def.type}): ${def.description}`)
        .join('\n')
      return `### ${t.name}\n${t.description}\n参数:\n${params}`
    }).join('\n\n')

    return `## 可用工具

你可以调用以下工具获取更多信息。将工具调用放在回复末尾，使用以下格式：

<tool_call>
<name>工具名称</name>
<parameters>
{"参数名": "参数值"}
</parameters>
</tool_call>

系统会执行工具并将结果返回给你，然后你可以继续生成回复。每个回复最多包含一个工具调用。

${toolDescs}`
  }

  /** Parse a tool call from LLM response text. Only matches at end of response to avoid
   *  false positives from code blocks or explanations. Returns null if no tool call found. */
  private parseToolCall(text: string): { name: string; args: Record<string, unknown> } | null {
    // Anchor to end of text — tool calls should only appear as the final action
    const match = text.match(/<tool_call>([\s\S]*?)<\/tool_call>\s*$/)
    if (!match) return null

    const block = match[1]
    const nameMatch = block.match(/<name>(.*?)<\/name>/)
    if (!nameMatch) return null

    const name = nameMatch[1].trim()
    let args: Record<string, unknown> = {}

    const paramsMatch = block.match(/<parameters>([\s\S]*?)<\/parameters>/)
    if (paramsMatch) {
      try {
        args = JSON.parse(paramsMatch[1].trim())
      } catch {
        // Non-JSON parameters — keep empty args
      }
    }

    return { name, args }
  }

  /** Execute a tool call and return the result as a string. */
  private async executeTool(
    toolCall: { name: string; args: Record<string, unknown> },
    obs: Observation
  ): Promise<string> {
    const tool = obs.tools?.find(t => t.name === toolCall.name)
    if (!tool) return `错误: 未知工具 "${toolCall.name}"`

    try {
      return await tool.execute(toolCall.args)
    } catch (err) {
      return `工具执行错误: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  /** Wait for the next complete/done/error event on a session.
   *  Returns accumulated pure text (excluding tool-call XML), matching
   *  Slock's block-level separation of text vs tool_use content.
   *  Includes a 5-minute timeout to prevent infinite hangs if the CLI
   *  process stops emitting events. */
  private waitForReply(sessionId: string): Promise<string> {
    const REPLY_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

    return new Promise<string>((resolve) => {
      let settled = false
      let accumulatedText = ''
      const safeResolve = (value: string): void => {
        if (settled) return
        settled = true
        clearTimeout(timeoutHandle)
        aiEngine.offEvent(sessionId, handler)
        resolve(value)
      }

      const handler = (event: AIEvent): void => {
        // Accumulate text deltas (skip tool-call XML)
        if (event.type === 'text_delta' && event.delta) {
          accumulatedText += event.delta
        }
        if (event.type === 'complete') {
          aiEngine.offEvent(sessionId, handler)
          // Use accumulated text if available; fall back to fullText
          safeResolve(accumulatedText || (event.fullText as string) || '')
        }
        if (event.type === 'done' || event.type === 'error') {
          aiEngine.offEvent(sessionId, handler)
          safeResolve(accumulatedText)
        }
      }
      aiEngine.onEvent(sessionId, handler)

      const timeoutHandle = setTimeout(() => {
        console.warn(`[AgentRuntime] ${this.profile.name} waitForReply timed out after ${REPLY_TIMEOUT_MS / 1000}s`)
        safeResolve(accumulatedText)
      }, REPLY_TIMEOUT_MS)
    })
  }

  /** Wait for the next complete reply while streaming text_delta events to the bus.
   *  Emits `agent:stream` events for each delta so the frontend can render
   *  partial output in real time.
   *  Includes a 5-minute timeout to prevent infinite hangs if the CLI
   *  process stops emitting events.
   *
   *  **Slock-aligned fix**: Only accumulates and streams pure text content,
   *  not tool-call XML. When the LLM emits tool calls (e.g. `<invoke>` XML
   *  or `tool_start` events), those deltas are suppressed from the stream
   *  and not included in the final reply. This matches Slock's block-level
   *  separation where `kind: "text"` and `kind: "tool_call"` are distinct. */
  private waitForReplyWithStreaming(sessionId: string, conversationId: string): Promise<string> {
    const REPLY_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

    // Start stall detection monitoring for this reply.
    // Stop any previous monitoring first as a safety net — if a prior
    // temporary session's safeResolve never fired (process crash without
    // done/error event), the timer would still be running.
    if (this.stallDetector) {
      this.stallDetector.stopMonitoring()
      this.stallDetector.startMonitoring(conversationId, sessionId)
    }

    return new Promise<string>((resolve) => {
      let settled = false
      let accumulatedText = '' // Pure text only — excludes tool-call XML
      let insideToolCall = false // Track whether we're inside a tool_use block
      const safeResolve = (value: string): void => {
        if (settled) return
        settled = true
        clearTimeout(timeoutHandle)
        aiEngine.offEvent(sessionId, handler)
        // Stop stall detection monitoring when reply completes
        if (this.stallDetector) {
          this.stallDetector.stopMonitoring()
        }
        resolve(value)
      }

      const handler = (event: AIEvent): void => {
        // Forward every event to stall detector for activity tracking
        if (this.stallDetector) {
          this.stallDetector.recordEvent(event)
        }

        // Track tool call boundaries — suppress streaming inside tool calls
        if (event.type === 'tool_start') {
          insideToolCall = true
          return
        }
        if (event.type === 'tool_result') {
          insideToolCall = false
          return
        }

        // Stream partial text to the bus for real-time rendering
        // Only stream if we're NOT inside a tool call block
        if (event.type === 'text_delta' && event.delta && !insideToolCall) {
          accumulatedText += event.delta
          this.emit('stream', {
            type: 'agent:stream',
            conversationId,
            agentProfileId: this.profile.id,
            agentName: this.profile.name,
            delta: event.delta,
          })
        }

        // On complete: return accumulated pure text, NOT fullText
        // (fullText may contain tool-call XML that we don't want in the reply)
        if (event.type === 'complete') {
          // Reset insideToolCall in case tool_result was never emitted (CLI crash)
          insideToolCall = false
          // If we accumulated text via text_delta, use that (pure text only).
          // Fall back to fullText only if no deltas were received (edge case
          // for providers that emit complete without text_delta).
          const reply = accumulatedText || (event.fullText as string) || ''
          safeResolve(reply)
        }
        if (event.type === 'done' || event.type === 'error') {
          insideToolCall = false
          safeResolve(accumulatedText)
        }
      }

      // Register handler BEFORE sending the message to prevent the race
      // condition where CLI events arrive before the handler is attached.
      aiEngine.onEvent(sessionId, handler)

      const timeoutHandle = setTimeout(() => {
        console.warn(`[AgentRuntime] ${this.profile.name} reply timed out after ${REPLY_TIMEOUT_MS / 1000}s`)
        safeResolve(accumulatedText)
      }, REPLY_TIMEOUT_MS)
    })
  }

  private async generateObservationReply(obs: Observation): Promise<string> {
    const MAX_TOOL_CALLS = 5

    // Start a temporary session for the observation response.
    const resolved = resolveRuntime(
      this.profile.id === 'default' ? null : this.profile,
      {
        providerType: this.lastProviderType,
        model: this.profile.model,
      },
      undefined
    )

    // Assemble system prompt
    const systemPromptParts: string[] = []

    if (this.profile.systemPrompt) {
      systemPromptParts.push(this.profile.systemPrompt)
    }
    systemPromptParts.push(OPEN_FLOOR_INSTRUCTION)

    const hasTools = obs.tools && obs.tools.length > 0
    const toolPrompt = hasTools ? this.buildToolPrompt(obs.tools) : ''
    if (toolPrompt) {
      systemPromptParts.push(toolPrompt)
    }

    const otherAgents = this.knownAgents.filter((a) => a.id !== this.profile.id)
    if (otherAgents.length > 0) {
      const agentCards = otherAgents
        .map((a) => {
          const whenToUse = a.whenToUse ?? 'No description available'
          const capabilities = a.capabilities?.length ? a.capabilities.join(', ') : 'No capability tags'
          return `@${a.name} (${a.role}): ${capabilities} — ${whenToUse}`
        })
        .join('\n')
      systemPromptParts.push(
        `其他参与者（你可以看到他们的所有发言）：\n${agentCards}\n\n` +
        `重要：这是一个群聊环境，所有人的消息你都能看到。` +
        `不需要说"我看不到其他 Agent 的回复"——你在上下文中直接就能看到。` +
        `如果需要让某个 Agent 特别注意到某件事，可以在消息里 @AgentName: 你的问题`
      )
    }

    const fullConfig: SessionConfig = {
      providerType: resolved.providerType,
      model: resolved.model,
      workingDir: this.lastWorkingDir,
      permissionMode: 'trusted',
      appendSystemPrompt: systemPromptParts.join('\n\n'),
    }

    // Build message content — always pre-inject recent context so the agent
    // can see peer messages even if it doesn't use the readMessages tool.
    const messageParts: string[] = []
    const contextText = obs.context
      .map((m) => `[${m.role}]: ${m.content}`)
      .join('\n')
    if (contextText) {
      messageParts.push(`## 讨论上下文\n\n${contextText}`)
    }
    messageParts.push(
      `## 当前话题\n\n${obs.message}`,
      `\n你是 @${this.profile.name}，团队的 ${this.profile.role}。上面的讨论上下文中包含了所有参与者的发言——你可以直接看到每个人的观点。像平时群里聊天一样发表你的看法，不用太正式。`
    )
    const messageContent = messageParts.join('\n---\n\n')

    const tempSession = await aiEngine.startSession(fullConfig)
    this.observationSessionId = tempSession.id
    try {
      let toolCallCount = 0
      let lastReply = ''
      let lastToolResult = '' // Track last tool result for fallback summary

      // Register event handler BEFORE sending the message to prevent the race
      // condition where CLI events arrive before waitForReplyWithStreaming
      // attaches its handler. The first iteration awaits the reply promise
      // first, then sends the initial message; subsequent iterations send
      // tool result messages at the end of the loop body.
      let replyPromise = this.waitForReplyWithStreaming(tempSession.id, obs.conversationId)
      aiEngine.sendMessage(tempSession.id, messageContent)

      // toolCallCount tracks how many tool calls have been EXECUTED.
      // Entry: 0→1→2→3→4 each execute; entry=5 hits >=MAX_TOOL_CALLS and blocks the 6th.
      // So MAX_TOOL_CALLS=5 allows exactly 5 tool calls.
      // XML tool_call parse/execute loop
      while (toolCallCount <= MAX_TOOL_CALLS) {
        const reply = await replyPromise
        if (!reply) break

        lastReply = reply

        // Try to parse a tool call
        const toolCall = this.parseToolCall(reply)
        if (!toolCall || toolCallCount >= MAX_TOOL_CALLS) {
          return lastReply
        }

        toolCallCount++

        // Execute tool and send result back
        console.debug(`[AgentRuntime] ${this.profile.name} tool_call #${toolCallCount}: ${toolCall.name}(${JSON.stringify(toolCall.args)})`)
        const toolResult = await this.executeTool(toolCall, obs)
        lastToolResult = toolResult // Store for fallback summary
        console.debug(`[AgentRuntime] ${this.profile.name} tool_result #${toolCallCount}: ${toolCall.name} → ${toolResult.length} chars`)
        const resultMessage = [
          `工具执行结果:`,
          `<tool_result name="${toolCall.name}">`,
          toolResult,
          `</tool_result>`,
          '',
          '请基于以上结果继续回复。',
        ].join('\n')
        // Register handler before sending the next message (same race fix)
        replyPromise = this.waitForReplyWithStreaming(tempSession.id, obs.conversationId)
        aiEngine.sendMessage(tempSession.id, resultMessage)
      }

      // FR-5.2: If agent executed tool calls but produced no text output,
      // generate a fallback summary from the last tool result so the user
      // sees what the agent did, rather than a silent [NO_REPLY].
      if (!lastReply && toolCallCount > 0) {
        const summary = lastToolResult.length > 100
          ? lastToolResult.slice(0, 100) + '…'
          : lastToolResult
        return `已执行 ${toolCallCount} 次工具调用。${summary}`
      }

      return lastReply || ''
    } finally {
      this.observationSessionId = null
      // Safety net: stop stall detector monitoring if safeResolve never fired
      // (e.g. process crash without done/error event). Without this, the
      // stallDetector timer keeps running and may interfere with the next
      // temporary session's monitoring cycle.
      this.stallDetector?.stopMonitoring()
      await aiEngine.endSession(tempSession.id).catch(() => {})
    }
  }

  private async assessRelevance(params: {
    topic: string
    myCapabilities: string[]
    myInterests: string
  }): Promise<{ score: number }> {
    return assessOpenFloorRelevance(params)
  }

  // ─── Session lifecycle ─────────────────────────────────────────────────────

  async dispose(): Promise<void> {
    if (!this.session) return
    const sessionId = this.session.id
    if (this.eventHandler) {
      aiEngine.offEvent(sessionId, this.eventHandler)
      this.eventHandler = null
    }
    await aiEngine.endSession(sessionId)
    this.session = null
    this.removeAllListeners()
  }

  get sessionId(): string | null {
    return this.session?.id ?? null
  }

  get isActive(): boolean {
    return this.session !== null
  }

  private getKnownAgentNames(): string[] {
    const names = this.knownAgents.map((a) => a.name)
    return names.length > 0 ? [...names, 'All'] : names
  }

  private attachEventHandler(): void {
    if (!this.session) return

    const handler = (event: AIEvent): void => {
      this.emit('event', event)

      if (event.type === 'complete' && this.knownAgents.length > 0) {
        const scanned = scanAgentOutput(event.fullText, this.profile.id, this.knownAgents)
        if (scanned.length > 0) {
          const mentions = scanned
            .map((s) => {
              const rawContent = s.lineContent.slice(s.mentionText.length).trim()
              const taskContent = rawContent.replace(/^:\s*/, '')
              return { agentName: s.targetName, taskContent }
            })
            .filter((m) => m.taskContent.length > 0)

          if (mentions.length > 0) {
            const mentionEvent: AgentMentionEvent = {
              type: 'agent_mention',
              mentions,
              fromProfileId: this.profile.id,
              fullText: event.fullText
            }
            this.emit('mention', mentionEvent)
          }
        }
      }
    }

    this.eventHandler = handler
    aiEngine.onEvent(this.session.id, handler)
  }
}
