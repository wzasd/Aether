import type { CLIProvider, ConfigOption, ModelInfo, Session, SessionConfig } from './provider'
import type { AIEvent } from './types'
import type { ProviderRegistry } from './provider-registry'
import { providerRegistry } from './provider-registry'

type SessionRecord = { session: Session; provider: CLIProvider }

export class AIEngine {
  private registry: ProviderRegistry
  private sessions: Map<string, SessionRecord> = new Map()

  constructor(registry: ProviderRegistry = providerRegistry) {
    this.registry = registry
  }

  async startSession(config: SessionConfig): Promise<Session> {
    const provider = this.registry.get(config.providerType)
    if (!provider) throw new Error(`Provider ${config.providerType} not available`)
    const session = await provider.startSession(config)
    this.sessions.set(session.id, { session, provider })
    return session
  }

  async endSession(sessionId: string): Promise<void> {
    const record = this.sessions.get(sessionId)
    if (!record) return
    await record.provider.endSession(sessionId)
    this.sessions.delete(sessionId)
  }

  sendMessage(sessionId: string, content: string, opts?: { parentToolUseId?: string }): void {
    const record = this.sessions.get(sessionId)
    if (!record) throw new Error('Session not found')
    record.provider.sendMessage(sessionId, content, opts)
  }

  respondPermission(sessionId: string, approved: boolean): void {
    const record = this.sessions.get(sessionId)
    if (!record) return
    record.provider.respondPermission(sessionId, approved)
  }

  respondQuestion(sessionId: string, answer: string): void {
    const record = this.sessions.get(sessionId)
    if (!record) return
    record.provider.respondQuestion(sessionId, answer)
  }

  abort(sessionId: string): void {
    const record = this.sessions.get(sessionId)
    if (!record) return
    record.provider.abort(sessionId)
  }

  onEvent(sessionId: string, handler: (event: AIEvent) => void): void {
    const record = this.sessions.get(sessionId)
    if (!record) return
    record.provider.onEvent(sessionId, handler)
  }

  offEvent(sessionId: string, handler: (event: AIEvent) => void): void {
    const record = this.sessions.get(sessionId)
    if (!record) return
    record.provider.offEvent(sessionId, handler)
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId)?.session
  }

  getAvailableModels(sessionId: string): ModelInfo[] {
    const record = this.sessions.get(sessionId)
    if (!record?.provider.getAvailableModels) return []
    return record.provider.getAvailableModels(sessionId)
  }

  async setModel(sessionId: string, modelId: string): Promise<void> {
    const record = this.sessions.get(sessionId)
    if (!record?.provider.setModel) return
    await record.provider.setModel(sessionId, modelId)
  }

  getConfigOptions(sessionId: string): ConfigOption[] | null {
    const record = this.sessions.get(sessionId)
    if (!record?.provider.getConfigOptions) return null
    return record.provider.getConfigOptions(sessionId)
  }

  async setConfigOption(sessionId: string, optionId: string, value: string): Promise<void> {
    const record = this.sessions.get(sessionId)
    if (!record?.provider.setConfigOption) return
    await record.provider.setConfigOption(sessionId, optionId, value)
  }
}

export const aiEngine = new AIEngine()
