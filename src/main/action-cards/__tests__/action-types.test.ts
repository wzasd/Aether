/**
 * Unit tests for Action Card payload validation.
 *
 * Covers: action-types.ts — validateActionPayload, generateDedupeKey, getDefaultExpiryAt
 */

import { describe, it, expect } from 'vitest'
import {
  validateActionPayload,
  generateDedupeKey,
  getDefaultExpiryAt,
  isValidActionType,
  isActiveStatus,
  isTerminalStatus,
} from '../action-types'
import type { ActionType } from '../action-types'

// ─── ActionType Validation ──────────────────────────────────────────────────

describe('isValidActionType', () => {
  it('returns true for valid action types', () => {
    expect(isValidActionType('memory:activate')).toBe(true)
    expect(isValidActionType('memory:bulk_activate')).toBe(true)
    expect(isValidActionType('provider_config:update')).toBe(true)
    expect(isValidActionType('agent:create')).toBe(true)
  })

  it('returns false for invalid action types', () => {
    expect(isValidActionType('unknown:action')).toBe(false)
    expect(isValidActionType('')).toBe(false)
    expect(isValidActionType('memory')).toBe(false)
  })
})

// ─── Status Helpers ─────────────────────────────────────────────────────────

describe('isActiveStatus', () => {
  it('returns true for pending and executing', () => {
    expect(isActiveStatus('pending')).toBe(true)
    expect(isActiveStatus('executing')).toBe(true)
  })

  it('returns false for terminal statuses', () => {
    expect(isActiveStatus('executed')).toBe(false)
    expect(isActiveStatus('rejected')).toBe(false)
    expect(isActiveStatus('expired')).toBe(false)
    expect(isActiveStatus('failed')).toBe(false)
  })
})

describe('isTerminalStatus', () => {
  it('returns true for executed, rejected, expired', () => {
    expect(isTerminalStatus('executed')).toBe(true)
    expect(isTerminalStatus('rejected')).toBe(true)
    expect(isTerminalStatus('expired')).toBe(true)
  })

  it('returns false for non-terminal statuses', () => {
    expect(isTerminalStatus('pending')).toBe(false)
    expect(isTerminalStatus('executing')).toBe(false)
    expect(isTerminalStatus('failed')).toBe(false)
  })
})

// ─── memory:activate ────────────────────────────────────────────────────────

describe('validateActionPayload — memory:activate', () => {
  it('accepts valid payload', () => {
    const result = validateActionPayload('memory:activate', {
      type: 'memory:activate',
      memoryItemId: '550e8400-e29b-41d4-a716-446655440000',
    })
    expect(result.valid).toBe(true)
  })

  it('rejects missing memoryItemId', () => {
    const result = validateActionPayload('memory:activate', {
      type: 'memory:activate',
    })
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('memoryItemId')
  })

  it('rejects non-UUID memoryItemId', () => {
    const result = validateActionPayload('memory:activate', {
      type: 'memory:activate',
      memoryItemId: 'not-a-uuid',
    })
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('UUID')
  })
})

// ─── memory:bulk_activate ───────────────────────────────────────────────────

describe('validateActionPayload — memory:bulk_activate', () => {
  it('accepts valid payload with 1-50 UUIDs', () => {
    const ids = Array.from({ length: 3 }, () => '550e8400-e29b-41d4-a716-446655440000')
    const result = validateActionPayload('memory:bulk_activate', {
      type: 'memory:bulk_activate',
      memoryItemIds: ids,
    })
    expect(result.valid).toBe(true)
  })

  it('rejects empty array', () => {
    const result = validateActionPayload('memory:bulk_activate', {
      type: 'memory:bulk_activate',
      memoryItemIds: [],
    })
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('at least 1')
  })

  it('rejects array with more than 50 items', () => {
    const ids = Array.from({ length: 51 }, () => '550e8400-e29b-41d4-a716-446655440000')
    const result = validateActionPayload('memory:bulk_activate', {
      type: 'memory:bulk_activate',
      memoryItemIds: ids,
    })
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('at most 50')
  })

  it('rejects non-array memoryItemIds', () => {
    const result = validateActionPayload('memory:bulk_activate', {
      type: 'memory:bulk_activate',
      memoryItemIds: 'not-an-array',
    })
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('array')
  })

  it('rejects array with non-UUID items', () => {
    const result = validateActionPayload('memory:bulk_activate', {
      type: 'memory:bulk_activate',
      memoryItemIds: ['invalid-uuid'],
    })
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('UUID')
  })
})

// ─── provider_config:update ─────────────────────────────────────────────────

describe('validateActionPayload — provider_config:update', () => {
  it('accepts valid payload with allowed patch fields', () => {
    const result = validateActionPayload('provider_config:update', {
      type: 'provider_config:update',
      providerId: 'openai',
      patch: {
        modelOverride: 'gpt-4o',
        reasoningEffort: 'high',
        maxTokens: 4096,
      },
    })
    expect(result.valid).toBe(true)
  })

  it('accepts payload with partial patch', () => {
    const result = validateActionPayload('provider_config:update', {
      type: 'provider_config:update',
      providerId: 'openai',
      patch: { maxTokens: 8192 },
    })
    expect(result.valid).toBe(true)
  })

  it('rejects empty providerId', () => {
    const result = validateActionPayload('provider_config:update', {
      type: 'provider_config:update',
      providerId: '',
      patch: {},
    })
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('providerId')
  })

  it('rejects extra patch keys (strict whitelist)', () => {
    const result = validateActionPayload('provider_config:update', {
      type: 'provider_config:update',
      providerId: 'openai',
      patch: { apiKey: 'sk-xxx' },
    })
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('not allowed')
  })

  it('rejects invalid reasoningEffort value', () => {
    const result = validateActionPayload('provider_config:update', {
      type: 'provider_config:update',
      providerId: 'openai',
      patch: { reasoningEffort: 'ultra' },
    })
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('reasoningEffort')
  })

  it('rejects maxTokens below minimum', () => {
    const result = validateActionPayload('provider_config:update', {
      type: 'provider_config:update',
      providerId: 'openai',
      patch: { maxTokens: 512 },
    })
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('1024')
  })

  it('rejects maxTokens above maximum', () => {
    const result = validateActionPayload('provider_config:update', {
      type: 'provider_config:update',
      providerId: 'openai',
      patch: { maxTokens: 999999 },
    })
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('200000')
  })

  it('rejects non-integer maxTokens', () => {
    const result = validateActionPayload('provider_config:update', {
      type: 'provider_config:update',
      providerId: 'openai',
      patch: { maxTokens: 4096.5 },
    })
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('integer')
  })

  it('rejects missing patch object', () => {
    const result = validateActionPayload('provider_config:update', {
      type: 'provider_config:update',
      providerId: 'openai',
    })
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('patch')
  })
})

// ─── agent:create ───────────────────────────────────────────────────────────

describe('validateActionPayload — agent:create', () => {
  it('accepts valid payload', () => {
    const result = validateActionPayload('agent:create', {
      type: 'agent:create',
      name: 'Code Reviewer',
      rolePrompt: 'Review code for quality',
      profileId: 'default',
    })
    expect(result.valid).toBe(true)
  })

  it('rejects empty name', () => {
    const result = validateActionPayload('agent:create', {
      type: 'agent:create',
      name: '',
      rolePrompt: 'Review code',
      profileId: 'default',
    })
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('name')
  })

  it('rejects name over 80 characters', () => {
    const result = validateActionPayload('agent:create', {
      type: 'agent:create',
      name: 'A'.repeat(81),
      rolePrompt: 'Review code',
      profileId: 'default',
    })
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('80')
  })

  it('rejects rolePrompt over 2000 characters', () => {
    const result = validateActionPayload('agent:create', {
      type: 'agent:create',
      name: 'Agent',
      rolePrompt: 'X'.repeat(2001),
      profileId: 'default',
    })
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('2000')
  })

  it('rejects empty profileId', () => {
    const result = validateActionPayload('agent:create', {
      type: 'agent:create',
      name: 'Agent',
      rolePrompt: 'Review code',
      profileId: '',
    })
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('profileId')
  })
})

// ─── generateDedupeKey ──────────────────────────────────────────────────────

describe('generateDedupeKey', () => {
  it('uses memoryItemId for memory:activate', () => {
    const key = generateDedupeKey('memory:activate', { memoryItemId: 'abc-123' })
    expect(key).toBe('abc-123')
  })

  it('uses sorted IDs for memory:bulk_activate', () => {
    const key = generateDedupeKey('memory:bulk_activate', {
      memoryItemIds: ['c', 'a', 'b'],
    })
    expect(key).toBe('bulk:a,b,c')
  })

  it('uses provider ID for provider_config:update', () => {
    const key = generateDedupeKey('provider_config:update', { providerId: 'openai' })
    expect(key).toBe('provider:openai')
  })

  it('uses agent name for agent:create', () => {
    const key = generateDedupeKey('agent:create', { name: 'Reviewer' })
    expect(key).toBe('agent:Reviewer')
  })
})

// ─── getDefaultExpiryAt ─────────────────────────────────────────────────────

describe('getDefaultExpiryAt', () => {
  it('returns undefined for memory:activate', () => {
    expect(getDefaultExpiryAt('memory:activate')).toBeUndefined()
  })

  it('returns undefined for memory:bulk_activate', () => {
    expect(getDefaultExpiryAt('memory:bulk_activate')).toBeUndefined()
  })

  it('returns a future timestamp for provider_config:update', () => {
    const expiry = getDefaultExpiryAt('provider_config:update')
    expect(expiry).toBeDefined()
    const now = Math.floor(Date.now() / 1000)
    // Should be roughly 24 hours from now
    expect(expiry!).toBeGreaterThan(now)
    expect(expiry!).toBeLessThanOrEqual(now + 24 * 60 * 60)
  })

  it('returns a future timestamp for agent:create', () => {
    const expiry = getDefaultExpiryAt('agent:create')
    expect(expiry).toBeDefined()
    const now = Math.floor(Date.now() / 1000)
    expect(expiry!).toBeGreaterThan(now)
    expect(expiry!).toBeLessThanOrEqual(now + 24 * 60 * 60)
  })
})
