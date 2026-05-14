/**
 * Action Card type definitions and payload validation.
 *
 * Action Card is the human confirmation layer — agents propose side-effect
 * operations, but only after human commit does the mutation actually execute.
 * It is a bypass control plane, non-blocking to the agent execution chain.
 *
 * Design constraints (see docs/architecture/action-card-design.md):
 * - C5: Deduplication uses explicit dedupe_key, not JSON payload expression indexes
 * - C7: Validation failed → expired; transient failed → retry same card
 */

// ─── Action Card Status ─────────────────────────────────────────────────────

export type ActionCardStatus =
  | 'pending'
  | 'executing'
  | 'executed'
  | 'failed'
  | 'rejected'
  | 'expired'

const ACTIVE_STATUSES: ReadonlySet<ActionCardStatus> = new Set<ActionCardStatus>(['pending', 'executing'])
const TERMINAL_STATUSES: ReadonlySet<ActionCardStatus> = new Set<ActionCardStatus>(['executed', 'rejected', 'expired'])

export function isActiveStatus(status: ActionCardStatus): boolean {
  return ACTIVE_STATUSES.has(status)
}

export function isTerminalStatus(status: ActionCardStatus): boolean {
  return TERMINAL_STATUSES.has(status)
}

// ─── Action Type Discriminator ──────────────────────────────────────────────

export type ActionType =
  | 'memory:activate'
  | 'memory:bulk_activate'
  | 'provider_config:update'
  | 'agent:create'

const ACTION_TYPES: ReadonlySet<ActionType> = new Set<ActionType>([
  'memory:activate',
  'memory:bulk_activate',
  'provider_config:update',
  'agent:create',
])

export function isValidActionType(type: string): type is ActionType {
  return ACTION_TYPES.has(type as ActionType)
}

// ─── Payload Types ──────────────────────────────────────────────────────────

export interface MemoryActivatePayload {
  readonly type: 'memory:activate'
  readonly memoryItemId: string
}

export interface MemoryBulkActivatePayload {
  readonly type: 'memory:bulk_activate'
  readonly memoryItemIds: readonly string[]
}

export interface ProviderConfigUpdatePayload {
  readonly type: 'provider_config:update'
  readonly providerId: string
  readonly patch: Readonly<{
    readonly modelOverride?: string
    readonly reasoningEffort?: 'low' | 'medium' | 'high'
    readonly maxTokens?: number
  }>
}

export interface AgentCreatePayload {
  readonly type: 'agent:create'
  readonly name: string
  readonly rolePrompt: string
  readonly profileId: string
}

export type ActionPayload =
  | MemoryActivatePayload
  | MemoryBulkActivatePayload
  | ProviderConfigUpdatePayload
  | AgentCreatePayload

// ─── Payload Validation ─────────────────────────────────────────────────────

export interface ValidationResult {
  readonly valid: boolean
  readonly reason?: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

function validateMemoryActivatePayload(payload: Record<string, unknown>): ValidationResult {
  if (typeof payload.memoryItemId !== 'string' || !isUuid(payload.memoryItemId)) {
    return { valid: false, reason: 'memoryItemId must be a valid UUID' }
  }
  return { valid: true }
}

function validateMemoryBulkActivatePayload(payload: Record<string, unknown>): ValidationResult {
  if (!Array.isArray(payload.memoryItemIds)) {
    return { valid: false, reason: 'memoryItemIds must be an array' }
  }
  if (payload.memoryItemIds.length === 0) {
    return { valid: false, reason: 'memoryItemIds must have at least 1 item' }
  }
  if (payload.memoryItemIds.length > 50) {
    return { valid: false, reason: 'memoryItemIds must have at most 50 items' }
  }
  for (const id of payload.memoryItemIds) {
    if (typeof id !== 'string' || !isUuid(id)) {
      return { valid: false, reason: 'each memoryItemId must be a valid UUID' }
    }
  }
  return { valid: true }
}

const ALLOWED_PROVIDER_PATCH_KEYS = new Set(['modelOverride', 'reasoningEffort', 'maxTokens'])
const REASONING_EFFORT_VALUES = new Set(['low', 'medium', 'high'])

function validateProviderConfigUpdatePayload(payload: Record<string, unknown>): ValidationResult {
  if (typeof payload.providerId !== 'string' || payload.providerId.length === 0) {
    return { valid: false, reason: 'providerId must be a non-empty string' }
  }

  if (typeof payload.patch !== 'object' || payload.patch === null) {
    return { valid: false, reason: 'patch must be an object' }
  }

  const patch = payload.patch as Record<string, unknown>

  // Strict whitelist: no extra keys allowed (C3 — Agent cannot modify sensitive fields)
  for (const key of Object.keys(patch)) {
    if (!ALLOWED_PROVIDER_PATCH_KEYS.has(key)) {
      return { valid: false, reason: `patch key "${key}" is not allowed` }
    }
  }

  if (patch.modelOverride !== undefined && typeof patch.modelOverride !== 'string') {
    return { valid: false, reason: 'patch.modelOverride must be a string' }
  }

  if (patch.reasoningEffort !== undefined) {
    if (typeof patch.reasoningEffort !== 'string' || !REASONING_EFFORT_VALUES.has(patch.reasoningEffort)) {
      return { valid: false, reason: 'patch.reasoningEffort must be low, medium, or high' }
    }
  }

  if (patch.maxTokens !== undefined) {
    if (typeof patch.maxTokens !== 'number' || !Number.isInteger(patch.maxTokens)) {
      return { valid: false, reason: 'patch.maxTokens must be an integer' }
    }
    if (patch.maxTokens < 1024 || patch.maxTokens > 200000) {
      return { valid: false, reason: 'patch.maxTokens must be between 1024 and 200000' }
    }
  }

  return { valid: true }
}

function validateAgentCreatePayload(payload: Record<string, unknown>): ValidationResult {
  if (typeof payload.name !== 'string' || payload.name.length === 0) {
    return { valid: false, reason: 'name must be a non-empty string' }
  }
  if (payload.name.length > 80) {
    return { valid: false, reason: 'name must be at most 80 characters' }
  }
  if (payload.rolePrompt !== undefined && typeof payload.rolePrompt !== 'string') {
    return { valid: false, reason: 'rolePrompt must be a string' }
  }
  if (typeof payload.rolePrompt === 'string' && payload.rolePrompt.length > 2000) {
    return { valid: false, reason: 'rolePrompt must be at most 2000 characters' }
  }
  if (typeof payload.profileId !== 'string' || payload.profileId.length === 0) {
    return { valid: false, reason: 'profileId must be a non-empty string' }
  }
  return { valid: true }
}

const VALIDATORS: Record<ActionType, (payload: Record<string, unknown>) => ValidationResult> = {
  'memory:activate': validateMemoryActivatePayload,
  'memory:bulk_activate': validateMemoryBulkActivatePayload,
  'provider_config:update': validateProviderConfigUpdatePayload,
  'agent:create': validateAgentCreatePayload,
}

/**
 * Validate an action payload against its type-specific schema.
 * Returns { valid: true } or { valid: false, reason: '...' }.
 */
export function validateActionPayload(
  type: ActionType,
  payload: Record<string, unknown>
): ValidationResult {
  const validator = VALIDATORS[type]
  if (!validator) {
    return { valid: false, reason: `unknown action type: ${type}` }
  }
  return validator(payload)
}

// ─── Dedupe Key Generation ──────────────────────────────────────────────────

/**
 * Generate a dedupe_key for a given action type and payload.
 * C5: Deduplication uses explicit dedupe_key, not JSON payload expression indexes.
 */
export function generateDedupeKey(type: ActionType, payload: Record<string, unknown>): string {
  switch (type) {
    case 'memory:activate':
      return String(payload.memoryItemId)
    case 'memory:bulk_activate': {
      // Sort IDs for deterministic key regardless of order
      const ids = (payload.memoryItemIds as string[]).slice().sort().join(',')
      return `bulk:${ids}`
    }
    case 'provider_config:update':
      return `provider:${payload.providerId}`
    case 'agent:create':
      // Agent creation dedupes by name within workspace
      return `agent:${payload.name}`
  }
}

// ─── Expiry Policy ──────────────────────────────────────────────────────────

/**
 * Returns the default expiry timestamp (unix seconds) for an action type,
 * or undefined if the type does not expire.
 *
 * - memory:activate — no expiry (human should always see pending memory drafts)
 * - provider_config:update — 24 hours
 * - agent:create — 24 hours
 */
export function getDefaultExpiryAt(type: ActionType): number | undefined {
  switch (type) {
    case 'memory:activate':
    case 'memory:bulk_activate':
      return undefined
    case 'provider_config:update':
    case 'agent:create':
      return Math.floor(Date.now() / 1000) + 24 * 60 * 60
    default:
      return undefined
  }
}
