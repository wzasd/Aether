import { AIProvider, Session, SessionConfig } from './provider'
import type { AIEvent } from './types'

export class AIEngine {
  private provider: AIProvider | null = null
  private sessions: Map<string, Session> = new Map()

  setProvider(provider: AIProvider): void {
    this.provider = provider
  }

  async startSession(config: SessionConfig): Promise<Session> {
    if (!this.provider) throw new Error('No AI provider configured')
    const session = await this.provider.startSession(config)
    this.sessions.set(session.id, session)
    return session
  }

  async endSession(sessionId: string): Promise<void> {
    if (!this.provider) return
    await this.provider.endSession(sessionId)
    this.sessions.delete(sessionId)
  }

  sendMessage(sessionId: string, content: string): void {
    if (!this.provider) throw new Error('No AI provider configured')
    this.provider.sendMessage(sessionId, content)
  }

  respondPermission(sessionId: string, approved: boolean): void {
    if (!this.provider) return
    this.provider.respondPermission(sessionId, approved)
  }

  respondQuestion(sessionId: string, answer: string): void {
    if (!this.provider) return
    this.provider.respondQuestion(sessionId, answer)
  }

  abort(sessionId: string): void {
    if (!this.provider) return
    this.provider.abort(sessionId)
  }

  onEvent(sessionId: string, handler: (event: AIEvent) => void): void {
    if (!this.provider) return
    this.provider.onEvent(sessionId, handler)
  }

  offEvent(sessionId: string, handler: (event: AIEvent) => void): void {
    if (!this.provider) return
    this.provider.offEvent(sessionId, handler)
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId)
  }
}

export const aiEngine = new AIEngine()
