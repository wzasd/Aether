import type { AIEvent, PermissionMode } from './types'

// ─── Permission Flags ───

export interface PermissionFlagMap {
  manual: string[]
  autoEdit: string[]
  plan: string[]
  fullAuto: string[]
  trusted: string[]
}

// ─── Model Info ───

export interface ModelInfo {
  id: string
  name: string
  contextWindow: number
  maxOutputTokens?: number
}

// ─── Provider Meta ───


export interface ProviderMeta {
  id: string
  name: string
  binary: string
  vendor: string
  models: ModelInfo[]
  permissionFlags: PermissionFlagMap
  supportsStreamJson: boolean
  supportsInteractive: boolean
}

// ─── Provider Config (non-sensitive, stored in DB) ───

export interface ProviderConfig {
  enabled: boolean
  binaryPath?: string
  extraEnv?: Record<string, string>
}

// ─── Session Config ───

export interface SessionConfig {
  providerType: string
  model: string
  permissionMode: PermissionMode
  workingDir: string
  sessionId?: string
  appendSystemPrompt?: string
}

// ─── Session ───

export interface Session {
  id: string
  providerType: string
  config: SessionConfig
  status: 'idle' | 'running' | 'waiting_permission' | 'waiting_question' | 'error'
  createdAt: number
}

// ─── Config Option (exposed to UI for model/param switching) ───

export interface ConfigOption {
  id: string
  name?: string
  label?: string
  description?: string
  category?: string
  type: 'select' | 'boolean' | 'string'
  currentValue?: string
  selectedValue?: string
  options?: Array<{ value: string; name?: string; label?: string }>
}

// ─── CLI Provider Interface ───

export interface CLIProvider {
  readonly meta: ProviderMeta

  detect(): Promise<string | null>
  initialize(config: ProviderConfig): Promise<void>

  startSession(config: SessionConfig): Promise<Session>
  endSession(sessionId: string): Promise<void>
  sendMessage(sessionId: string, content: string, opts?: { parentToolUseId?: string }): void
  respondPermission(sessionId: string, approved: boolean): void
  respondQuestion(sessionId: string, answer: string): void
  abort(sessionId: string): void
  onEvent(sessionId: string, handler: (event: AIEvent) => void): void
  offEvent(sessionId: string, handler: (event: AIEvent) => void): void

  getAvailableModels?(sessionId: string): ModelInfo[]
  setModel?(sessionId: string, modelId: string): Promise<void>
  getConfigOptions?(sessionId: string): ConfigOption[] | null
  setConfigOption?(sessionId: string, optionId: string, value: string): Promise<void>
}
