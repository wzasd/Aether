import type { AIEvent, PermissionMode } from './types'

export interface SessionConfig {
  model: 'opus' | 'sonnet' | 'haiku'
  permissionMode: PermissionMode
  workingDir: string
  sessionId?: string
}

export interface Session {
  id: string
  providerType: string
  config: SessionConfig
  status: 'idle' | 'running' | 'waiting_permission' | 'waiting_question' | 'error'
  createdAt: number
}

export interface AIProvider {
  readonly type: string
  startSession(config: SessionConfig): Promise<Session>
  endSession(sessionId: string): Promise<void>
  sendMessage(sessionId: string, content: string): void
  respondPermission(sessionId: string, approved: boolean): void
  respondQuestion(sessionId: string, answer: string): void
  abort(sessionId: string): void
  onEvent(sessionId: string, handler: (event: AIEvent) => void): void
  offEvent(sessionId: string, handler: (event: AIEvent) => void): void
}
