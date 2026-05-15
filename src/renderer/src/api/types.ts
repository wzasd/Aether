/**
 * Renderer API Shared Types — common interfaces for HTTP client modules.
 *
 * ADR-019: Renderer HTTP Migration
 */

/** Session configuration for chat and orchestrator sessions. */
export interface SessionConfig {
  providerType?: string
  model: string
  permissionMode: string
  workingDir: string
  sessionId?: string
}

/** AI event payload received via SSE or IPC. */
export interface AIEvent {
  type: string
  sessionId?: string
  [key: string]: unknown
}

/** Configuration option for a chat session. */
export interface ConfigOption {
  id: string
  name?: string
  label?: string
  category?: string
  type: string
  currentValue?: string
  options?: Array<{ value: string; name?: string }>
}

/** Available model info for a chat session. */
export interface AvailableModel {
  id: string
  name: string
  contextWindow: number
}