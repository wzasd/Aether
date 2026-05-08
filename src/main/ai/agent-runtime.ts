import { EventEmitter } from 'events'
import { aiEngine } from './engine'
import { scanAgentOutput } from './agent-output-scanner'
import { resolveRuntime } from './runtime-resolver'
import type { AgentProfile, Observation } from './a2a-types'
import type { SessionConfig, Session } from './provider'
import type { AIEvent } from './types'
import type { ParsedMention } from './a2a-types'
import { OPEN_FLOOR_INSTRUCTION, OPEN_FLOOR_ALLOWED_TOOLS } from './prompts/open-floor'

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

  private async generateObservationReply(obs: Observation): Promise<string> {
    // Start a temporary session for the observation response.
    // Uses cached workingDir/providerType from the last start() call.
    const resolved = resolveRuntime(
      this.profile.id === 'default' ? null : this.profile,
      {
        providerType: this.lastProviderType,
        model: this.profile.model,
      },
      undefined
    )

    // Assemble the Open Floor instruction with context
    const systemPromptParts: string[] = []

    if (this.profile.systemPrompt) {
      systemPromptParts.push(this.profile.systemPrompt)
    }
    systemPromptParts.push(OPEN_FLOOR_INSTRUCTION)

    const otherAgents = this.knownAgents.filter((a) => a.id !== this.profile.id)
    if (otherAgents.length > 0) {
      const agentCards = otherAgents
        .map((a) => {
          const whenToUse = a.whenToUse ?? 'No description available'
          const capabilities = a.capabilities?.length ? a.capabilities.join(', ') : 'No capability tags'
          return `@${a.name} (${a.role}): ${capabilities} — ${whenToUse}`
        })
        .join('\n')
      systemPromptParts.push(`其他参与者：\n${agentCards}\n\n如果需要追问特定 Agent，可以 @AgentName: 你的问题`)
    }

    const fullConfig: SessionConfig = {
      providerType: resolved.providerType,
      model: resolved.model,
      workingDir: this.lastWorkingDir,
      permissionMode: 'trusted',
      appendSystemPrompt: systemPromptParts.join('\n\n'),
    }

    // Build the full message content
    const contextText = obs.context
      .map((m) => `[${m.role}]: ${m.content}`)
      .join('\n')
    const messageContent = [
      `## 讨论上下文\n\n${contextText}`,
      `\n---\n\n## 当前话题\n\n${obs.message}`,
      `\n\n请根据你的角色 @${this.profile.name}（${this.profile.role}）判断是否参与讨论。Open Floor 鼓励多视角碰撞——如果你有相关视角、补充或不同看法，请从专业角度给出简短观点（3-5 句话）。不确定时倾向参与。`,
    ].join('\n')

    const tempSession = await aiEngine.startSession(fullConfig)
    this.observationSessionId = tempSession.id
    try {
      let reply = ''
      await new Promise<void>((resolve) => {
        const handler = (event: AIEvent): void => {
          if (event.type === 'complete' && event.fullText) {
            reply = event.fullText as string
          }
          if (event.type === 'done' || event.type === 'error') {
            aiEngine.offEvent(tempSession.id, handler)
            resolve()
          }
        }
        aiEngine.onEvent(tempSession.id, handler)
        aiEngine.sendMessage(tempSession.id, messageContent)
      })

      return reply || ''
    } finally {
      this.observationSessionId = null
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
