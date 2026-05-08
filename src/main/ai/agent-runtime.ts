import { EventEmitter } from 'events'
import { aiEngine } from './engine'
import { scanAgentOutput } from './agent-output-scanner'
import { resolveRuntime } from './runtime-resolver'
import type { AgentProfile } from './a2a-types'
import type { SessionConfig, Session } from './provider'
import type { AIEvent } from './types'
import type { ParsedMention } from './a2a-types'

export interface AgentMentionEvent {
  type: 'agent_mention'
  mentions: ParsedMention[]
  fromProfileId: string
  fullText: string
}

export type AgentRuntimeEvent = AIEvent | AgentMentionEvent

export class AgentRuntime extends EventEmitter {
  readonly profile: AgentProfile
  private session: Session | null = null
  private knownAgents: AgentProfile[] = []
  private agentCardSection: string = ''
  private eventHandler: ((event: AIEvent) => void) | null = null

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
    if (!this.session) return
    aiEngine.abort(this.session.id)
  }

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
