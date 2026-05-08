// ACP (Agent Communication Protocol) — JSON-RPC 2.0 over stdio

export const JSONRPC_VERSION = '2.0' as const

// ─── Wire types ───────────────────────────────────────────────────────────────

export interface AcpRequest {
  jsonrpc: typeof JSONRPC_VERSION
  id: number
  method: string
  params?: Record<string, unknown>
}

export interface AcpResponse {
  jsonrpc: typeof JSONRPC_VERSION
  id: number
  result?: unknown
  error?: { code: number; message: string }
}

export interface AcpNotification {
  jsonrpc: typeof JSONRPC_VERSION
  method: string
  params?: Record<string, unknown>
}

export type AcpMessage = AcpRequest | AcpResponse | AcpNotification

// ─── Initialize ───────────────────────────────────────────────────────────────

export interface AcpInitializeResult {
  protocolVersion: number
  agentInfo: { name: string; version: string; title?: string } | null
  authMethods: Array<{ id: string; name: string; [key: string]: unknown }>
  capabilities: {
    loadSession: boolean
    sessionCapabilities: {
      resume: Record<string, unknown> | null
      close: Record<string, unknown> | null
      fork: Record<string, unknown> | null
      list: Record<string, unknown> | null
    }
    _meta: Record<string, unknown>
  }
  modes: AcpSessionModes | null
}

// ─── Session ──────────────────────────────────────────────────────────────────

export interface AcpSessionModels {
  currentModelId?: string
  availableModels?: Array<{ id?: string; modelId?: string; name?: string }>
}

export interface AcpSessionModes {
  currentModeId?: string
  availableModes?: Array<{ id: string; name?: string; description?: string }>
}

export interface AcpSessionConfigOption {
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

// ─── Session updates (incoming from CLI) ─────────────────────────────────────

export const ACP_METHODS = {
  SESSION_UPDATE: 'session/update',
  REQUEST_PERMISSION: 'session/request_permission',
  READ_TEXT_FILE: 'fs/read_text_file',
  WRITE_TEXT_FILE: 'fs/write_text_file',
  SET_CONFIG_OPTION: 'session/set_config_option',
} as const

export interface AcpToolCallContentItem {
  type: 'content' | 'diff'
  content?: { type: 'text'; text: string }
  path?: string
  oldText?: string | null
  newText?: string
}

export interface AcpPermissionOption {
  optionId: string
  name: string
  kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always'
}

export interface AcpPermissionRequest {
  sessionId: string
  options: AcpPermissionOption[]
  toolCall: {
    toolCallId: string
    rawInput?: { command?: string; description?: string; [key: string]: unknown }
    status?: string
    title?: string
    kind?: string
    content?: AcpToolCallContentItem[]
  }
}

// ─── Discriminated union of incoming server→client messages ──────────────────

export type AcpSessionUpdateKind =
  | { sessionUpdate: 'agent_message_chunk'; content: { type: 'text' | 'image'; text?: string } }
  | { sessionUpdate: 'agent_thought_chunk'; content: { type: 'text'; text: string } }
  | { sessionUpdate: 'tool_call'; toolCallId: string; status: string; title: string; kind: string; rawInput?: Record<string, unknown>; content?: AcpToolCallContentItem[] }
  | { sessionUpdate: 'tool_call_update'; toolCallId: string; status: 'completed' | 'failed'; rawInput?: Record<string, unknown>; content?: Array<{ type: 'content'; content: { type: 'text'; text: string } }> }
  | { sessionUpdate: 'plan'; entries: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed' }> }
  | { sessionUpdate: 'config_option_update'; configOptions: AcpSessionConfigOption[] }
  | { sessionUpdate: 'usage_update'; used: number; size: number; cost?: { amount: number; currency: string } }
  | { sessionUpdate: 'available_commands_update'; availableCommands: Array<{ name: string; description: string }> }
  | { sessionUpdate: 'user_message_chunk'; content: { type: 'text'; text?: string } }
