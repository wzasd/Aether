import type { AIEvent, PermissionMode } from './types'
import type { BridgeConfig } from '../chat-bridge/types'

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
  /** Whether this provider supports resuming sessions across user turns.
   *  PTY/long-running providers (Claude) and stateful CLI providers (OpenCode)
   *  should set this to true. Per-turn spawn providers (Kimi, Codex, Gemini,
   *  Copilot, Cursor) should set false to avoid stale --resume crashes. */
  supportsCrossTurnResume?: boolean
}

// ─── Provider Config (non-sensitive, stored in DB) ───

export interface ProviderConfig {
  enabled: boolean
  profileId?: string
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
  /** Bridge sidecar config — set by daemon when chat-bridge MCP sidecar is enabled.
   *  Contains the MCP config file path that includes the "chat" server definition.
   *  Provider's buildMcpArgs() injects --mcp-config-file pointing to this config.
   *  ADR-015: Chat Bridge MCP Sidecar */
  bridgeConfig?: BridgeConfig
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
