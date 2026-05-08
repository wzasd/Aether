import { describe, expect, it, vi, beforeEach } from 'vitest'
import { resolveRuntime } from './runtime-resolver'
import type { AgentProfile } from './a2a-types'

const mockClaudeProvider = {
  meta: {
    id: 'claude-cli',
    name: 'Claude',
    binary: 'claude',
    vendor: 'Anthropic',
    models: [
      { id: 'claude-opus-4-7', name: 'Claude Opus 4.7', contextWindow: 200000 },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', contextWindow: 200000 }
    ],
    permissionFlags: { manual: ['default'], autoEdit: ['acceptEdits'], plan: ['plan'], fullAuto: ['bypassPermissions'] },
    supportsStreamJson: true,
    supportsInteractive: true
  }
} as const

const mockCodexProvider = {
  meta: {
    id: 'codex-cli',
    name: 'Codex',
    binary: 'codex',
    vendor: 'OpenAI',
    models: [
      { id: 'o3', name: 'O3', contextWindow: 200000 }
    ],
    permissionFlags: { manual: ['default'], autoEdit: ['acceptEdits'], plan: ['plan'], fullAuto: ['bypassPermissions'] },
    supportsStreamJson: true,
    supportsInteractive: true
  }
} as const

vi.mock('./provider-registry', () => ({
  providerRegistry: {
    get: (id: string) => {
      if (id === 'claude-cli') return mockClaudeProvider
      if (id === 'codex-cli') return mockCodexProvider
      return undefined
    },
    getAll: () => [mockClaudeProvider, mockCodexProvider]
  }
}))

describe('resolveRuntime', () => {
  describe('provider resolution', () => {
    it('uses profile preferredProvider when valid', () => {
      const profile: AgentProfile = {
        id: 'test',
        workspaceId: null,
        name: 'Test',
        role: 'coder',
        model: 'claude-sonnet-4-6',
        description: null,
        systemPrompt: null,
        preferredProvider: 'codex-cli',
        isEnabled: true,
        sortOrder: 0,
        createdAt: 0,
        updatedAt: 0
      }

      const result = resolveRuntime(profile, { providerType: 'claude-cli', model: 'claude-opus-4-7' })

      expect(result.providerType).toBe('codex-cli')
      expect(result.provider).toBe(mockCodexProvider)
    })

    it('falls back to baseConfig providerType when profile preferredProvider is invalid', () => {
      const profile: AgentProfile = {
        id: 'test',
        workspaceId: null,
        name: 'Test',
        role: 'coder',
        model: 'claude-sonnet-4-6',
        description: null,
        systemPrompt: null,
        preferredProvider: 'invalid-provider',
        isEnabled: true,
        sortOrder: 0,
        createdAt: 0,
        updatedAt: 0
      }

      const result = resolveRuntime(profile, { providerType: 'codex-cli', model: 'o3' })

      expect(result.providerType).toBe('codex-cli')
    })

    it('falls back to system default when both profile and baseConfig are invalid', () => {
      const profile: AgentProfile = {
        id: 'test',
        workspaceId: null,
        name: 'Test',
        role: 'coder',
        model: 'claude-sonnet-4-6',
        description: null,
        systemPrompt: null,
        preferredProvider: 'invalid',
        isEnabled: true,
        sortOrder: 0,
        createdAt: 0,
        updatedAt: 0
      }

      const result = resolveRuntime(profile, { providerType: 'also-invalid', model: 'claude-sonnet-4-6' })

      expect(result.providerType).toBe('claude-cli')
    })

    it('falls back to system default when profile is null', () => {
      const result = resolveRuntime(null, { providerType: 'invalid', model: 'claude-sonnet-4-6' })

      expect(result.providerType).toBe('claude-cli')
    })

    it('falls back to baseConfig when profile has no preferredProvider', () => {
      const profile: AgentProfile = {
        id: 'test',
        workspaceId: null,
        name: 'Test',
        role: 'coder',
        model: 'claude-sonnet-4-6',
        description: null,
        systemPrompt: null,
        isEnabled: true,
        sortOrder: 0,
        createdAt: 0,
        updatedAt: 0
      }

      const result = resolveRuntime(profile, { providerType: 'codex-cli', model: 'o3' })

      expect(result.providerType).toBe('codex-cli')
    })
  })

  describe('model resolution', () => {
    it('uses profile model when valid for resolved provider', () => {
      const profile: AgentProfile = {
        id: 'test',
        workspaceId: null,
        name: 'Test',
        role: 'coder',
        model: 'claude-opus-4-7',
        description: null,
        systemPrompt: null,
        preferredProvider: 'claude-cli',
        isEnabled: true,
        sortOrder: 0,
        createdAt: 0,
        updatedAt: 0
      }

      const result = resolveRuntime(profile, { providerType: 'claude-cli', model: 'claude-sonnet-4-6' })

      expect(result.model).toBe('claude-opus-4-7')
    })

    it('falls back to baseConfig model when profile model is invalid', () => {
      const profile: AgentProfile = {
        id: 'test',
        workspaceId: null,
        name: 'Test',
        role: 'coder',
        model: 'invalid-model',
        description: null,
        systemPrompt: null,
        preferredProvider: 'claude-cli',
        isEnabled: true,
        sortOrder: 0,
        createdAt: 0,
        updatedAt: 0
      }

      const result = resolveRuntime(profile, { providerType: 'claude-cli', model: 'claude-sonnet-4-6' })

      expect(result.model).toBe('claude-sonnet-4-6')
    })

    it('falls back to provider default when both profile and baseConfig models are invalid', () => {
      const profile: AgentProfile = {
        id: 'test',
        workspaceId: null,
        name: 'Test',
        role: 'coder',
        model: 'invalid',
        description: null,
        systemPrompt: null,
        preferredProvider: 'claude-cli',
        isEnabled: true,
        sortOrder: 0,
        createdAt: 0,
        updatedAt: 0
      }

      const result = resolveRuntime(profile, { providerType: 'claude-cli', model: 'also-invalid' })

      expect(result.model).toBe('claude-opus-4-7')
    })

    it('uses profile model even when baseConfig has different provider', () => {
      // Profile wants codex-cli + o3, baseConfig says claude-cli + claude-sonnet
      // Provider resolution picks codex-cli (profile wins)
      // Model resolution: profile.model='o3' is valid for codex-cli → use it
      const profile: AgentProfile = {
        id: 'test',
        workspaceId: null,
        name: 'Test',
        role: 'coder',
        model: 'o3',
        description: null,
        systemPrompt: null,
        preferredProvider: 'codex-cli',
        isEnabled: true,
        sortOrder: 0,
        createdAt: 0,
        updatedAt: 0
      }

      const result = resolveRuntime(profile, { providerType: 'claude-cli', model: 'claude-sonnet-4-6' })

      expect(result.providerType).toBe('codex-cli')
      expect(result.model).toBe('o3')
    })
  })

  describe('combined resolution', () => {
    it('resolves to default provider and first model when nothing is specified', () => {
      const profile: AgentProfile = {
        id: 'test',
        workspaceId: null,
        name: 'Test',
        role: 'coder',
        model: '',
        description: null,
        systemPrompt: null,
        isEnabled: true,
        sortOrder: 0,
        createdAt: 0,
        updatedAt: 0
      }

      const result = resolveRuntime(profile, {})

      expect(result.providerType).toBe('claude-cli')
      expect(result.model).toBe('claude-opus-4-7')
    })

    it('full chain: profile preferredProvider invalid → baseConfig providerType valid → profile model valid for resolved provider', () => {
      const profile: AgentProfile = {
        id: 'test',
        workspaceId: null,
        name: 'Test',
        role: 'coder',
        model: 'claude-sonnet-4-6',
        description: null,
        systemPrompt: null,
        preferredProvider: 'invalid',
        isEnabled: true,
        sortOrder: 0,
        createdAt: 0,
        updatedAt: 0
      }

      const result = resolveRuntime(profile, { providerType: 'claude-cli', model: 'invalid' })

      expect(result.providerType).toBe('claude-cli')
      expect(result.model).toBe('claude-sonnet-4-6')
    })
  })
})
