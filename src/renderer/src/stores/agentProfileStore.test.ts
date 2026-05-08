import { describe, expect, it, beforeEach, vi } from 'vitest'
import { useAgentProfileStore } from './agentProfileStore'
import type { AgentProfileConfig } from './agentProfileStore'

const mockProfiles: AgentProfileConfig[] = [
  {
    id: 'p1',
    workspaceId: null,
    name: 'Planner',
    role: 'planning',
    model: 'claude-opus-4-7',
    description: '任务分解与方案验证',
    systemPrompt: null,
    preferredProvider: null,
    capabilities: ['planning', 'architecture'],
    whenToUse: '需要复杂方案设计时',
    outputContract: '返回结构化的设计方案',
    isEnabled: true,
    sortOrder: 0,
    createdAt: 1700000000,
    updatedAt: 1700000000
  },
  {
    id: 'p2',
    workspaceId: null,
    name: 'Coder',
    role: 'implementation',
    model: 'claude-sonnet-4-6',
    description: '代码编写与重构',
    systemPrompt: 'You are a senior engineer.',
    preferredProvider: 'claude-cli',
    capabilities: ['coding', 'refactoring'],
    whenToUse: '需要编写或修改代码时',
    outputContract: '返回可运行的代码',
    isEnabled: true,
    sortOrder: 1,
    createdAt: 1700000000,
    updatedAt: 1700000000
  },
  {
    id: 'p3',
    workspaceId: null,
    name: 'Reviewer',
    role: 'review',
    model: 'claude-haiku-4-5-20251001',
    description: null,
    systemPrompt: null,
    preferredProvider: null,
    capabilities: null,
    whenToUse: null,
    outputContract: null,
    isEnabled: false,
    sortOrder: 2,
    createdAt: 1700000000,
    updatedAt: 1700000000
  }
]

beforeEach(() => {
  useAgentProfileStore.setState({ profiles: [] })
  vi.stubGlobal('window', {
    api: {
      agent: {
        listProfiles: vi.fn().mockResolvedValue(mockProfiles),
        createProfile: vi.fn().mockImplementation(async (data) => ({
          id: 'new-id',
          workspaceId: data.workspaceId ?? null,
          name: data.name,
          role: data.role ?? 'coder',
          model: data.model ?? 'claude-sonnet-4-6',
          description: data.description ?? null,
          systemPrompt: data.systemPrompt ?? null,
          preferredProvider: data.preferredProvider ?? null,
          capabilities: data.capabilities ?? null,
          whenToUse: data.whenToUse ?? null,
          outputContract: data.outputContract ?? null,
          isEnabled: data.isEnabled !== false,
          sortOrder: data.sortOrder ?? 0,
          createdAt: Date.now() / 1000,
          updatedAt: Date.now() / 1000
        })),
        updateProfile: vi.fn().mockImplementation(async (id, patch) => {
          const existing = mockProfiles.find((p) => p.id === id) ?? mockProfiles[0]
          return { ...existing, ...patch, updatedAt: Date.now() / 1000 }
        }),
        deleteProfile: vi.fn().mockResolvedValue(undefined),
        seedDefaults: vi.fn().mockResolvedValue(mockProfiles)
      }
    }
  })
})

describe('agentProfileStore', () => {
  describe('initial state', () => {
    it('has empty profiles', () => {
      expect(useAgentProfileStore.getState().profiles).toEqual([])
    })
  })

  describe('loadProfiles', () => {
    it('loads profiles from API', async () => {
      await useAgentProfileStore.getState().loadProfiles()

      const { profiles } = useAgentProfileStore.getState()
      expect(profiles).toHaveLength(3)
      expect(profiles[0].name).toBe('Planner')
    })

    it('passes workspaceId when provided', async () => {
      await useAgentProfileStore.getState().loadProfiles('ws1')

      const { profiles } = useAgentProfileStore.getState()
      expect(profiles).toHaveLength(3)
    })
  })

  describe('createProfile', () => {
    it('adds created profile to state', async () => {
      const profile = await useAgentProfileStore.getState().createProfile({
        name: 'Custom',
        role: 'custom',
        model: 'claude-sonnet-4-6'
      })

      expect(profile.name).toBe('Custom')
      const { profiles } = useAgentProfileStore.getState()
      expect(profiles).toHaveLength(1)
      expect(profiles[0].name).toBe('Custom')
    })

    it('round-trips capabilities and agent metadata', async () => {
      const profile = await useAgentProfileStore.getState().createProfile({
        name: 'Custom',
        role: 'coder',
        model: 'claude-sonnet-4-6',
        capabilities: ['coding', 'testing'],
        whenToUse: '需要写代码时',
        outputContract: '返回完整的代码实现'
      })

      expect(profile.capabilities).toEqual(['coding', 'testing'])
      expect(profile.whenToUse).toBe('需要写代码时')
      expect(profile.outputContract).toBe('返回完整的代码实现')
    })
  })

  describe('updateProfile', () => {
    it('updates profile in state', async () => {
      useAgentProfileStore.setState({ profiles: [...mockProfiles] })

      await useAgentProfileStore.getState().updateProfile('p1', { name: 'Updated' })

      const { profiles } = useAgentProfileStore.getState()
      const updated = profiles.find((p) => p.id === 'p1')
      expect(updated?.name).toBe('Updated')
    })
  })

  describe('deleteProfile', () => {
    it('removes profile from state', async () => {
      useAgentProfileStore.setState({
        profiles: [...mockProfiles]
      })

      await useAgentProfileStore.getState().deleteProfile('p2')

      const state = useAgentProfileStore.getState()
      expect(state.profiles).toHaveLength(2)
    })
  })

  describe('seedDefaults', () => {
    it('loads default profiles from API', async () => {
      await useAgentProfileStore.getState().seedDefaults()

      const { profiles } = useAgentProfileStore.getState()
      expect(profiles).toHaveLength(3)
    })
  })
})
