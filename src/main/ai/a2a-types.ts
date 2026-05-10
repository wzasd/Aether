export const MAX_DELEGATION_DEPTH = 5
export const MAX_TASKS_PER_CONVERSATION = 20
export const OPEN_FLOOR_TIMEOUT_MS = 5 * 60 * 1000  // 5 minute discussion window
export const OPEN_FLOOR_MAX_ROUNDS = 2  // max rounds for iterative open floor

export type A2AStatus = 'pending' | 'working' | 'completed' | 'failed'
export type ExecutionMode = 'serial' | 'parallel'
export type CollaborationMode = 'orchestrated' | 'open_floor'
export type PermissionMode = 'manual' | 'autoEdit' | 'plan' | 'fullAuto' | 'trusted'

export type ReflowState = 'pending' | 'running' | 'partial' | 'done' | 'timeout' | 'failed'

export interface ObservationTool {
  name: string
  description: string
  parameters: Record<string, { type: string; description: string }>
  execute: (args: Record<string, unknown>) => Promise<string>
}

export interface Observation {
  conversationId: string
  message: string
  context: Array<{ role: string; content: string }>
  collaborationMode: 'open_floor'
  tools?: ObservationTool[]
}

export interface OpenFloorResponse {
  agentId: string
  agentName: string
  content: string
  timestamp: number
  relevanceScore: number
}

export interface OpenFloorState {
  conversationId: string
  status: 'active' | 'closing' | 'closed'
  startTime: number
  endTime?: number
  responses: OpenFloorResponse[]
  pendingAgents: string[]
  skippedAgents: string[]
}

export interface PartialResult {
  fromProfileId: string
  output: string
  status: 'ok' | 'failed'
}

export interface A2ATask {
  id: string
  conversationId: string
  fromProfileId: string | null
  toProfileId: string
  message: string
  contextSnapshot: string
  status: A2AStatus
  depth: number
  chain: string[]
  executionMode: ExecutionMode
  providerOverride?: string
  modelOverride?: string
  readOnly?: boolean
  createdAt: number
  completedAt?: number
  result?: string
  /** Source of the task: 'user' = user-initiated, 'agent-scan' = from agent output scanning */
  source?: 'user' | 'agent-scan'
  /** ProfileId to aggregate results back to (for parallel multi-agent reflow) */
  callbackTo?: string
  /** Deadline timestamp for task timeout */
  timeoutAt?: number
  /** Reflow state machine state */
  reflowState?: ReflowState
  /** Accumulated partial results from child agents in a reflow group */
  partialResults?: PartialResult[]
  /** Parent task id for continuity capsule lineage (not persisted to DB) */
  parentTaskId?: string
  /** Position in the serial chain (1-based, not persisted to DB) */
  chainIndex?: number
  /** Total tasks in the serial chain (not persisted to DB) */
  chainTotal?: number
}

export interface ParsedMention {
  agentName: string
  taskContent: string
}

export type EdgeType = 'user-mention' | 'agent-mention' | 'capability-route' | 'feedback'

export interface AgentTaskEdge {
  id: string
  conversationId: string
  fromNodeId: string | null
  toNodeId: string
  edgeType: EdgeType
  label?: string
  createdAt: number
}

// Shared agent profile shape (main process copy — renderer has its own in the store)
export interface AgentProfile {
  id: string
  workspaceId: string | null
  name: string
  role: string
  model: string
  description: string | null
  systemPrompt: string | null
  preferredProvider?: string
  isEnabled: boolean
  sortOrder: number
  createdAt: number
  updatedAt: number
  capabilities?: string[]
  whenToUse?: string
  outputContract?: string
  customEnv?: Record<string, string>
  customArgs?: string[]
}

// ─── Layer 1: Intent ─────────────────────────────────────────────────────────

export type Intent =
  | { type: 'user_message' }
  | { type: 'mention'; target: string; task: string }
  | { type: 'capability_route'; capability: string; task: string }
  | { type: 'all'; task: string }

// ─── Layer 3: PlannedTask ─────────────────────────────────────────────────────

export type ContextStrategy = 'conversation' | 'handoff' | 'review' | 'summary' | 'default'

export interface PlannedTask {
  toProfileId: string
  toProfileName: string
  fromProfileId: string | null
  fromProfileName: string | null
  message: string
  edgeType: EdgeType
  edgeLabel: string
  contextStrategy: ContextStrategy
  readOnly?: boolean
  fromAgentOutput?: string
}

export interface ExecutionPlan {
  tasks: PlannedTask[]
  executionMode: ExecutionMode
}
