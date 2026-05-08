import { create } from 'zustand'

export interface AgentProfileConfig {
  id: string
  workspaceId: string | null
  name: string
  role: string
  model: string
  description: string | null
  systemPrompt: string | null
  preferredProvider?: string
  capabilities?: string[]
  whenToUse?: string
  outputContract?: string
  isEnabled: boolean
  sortOrder: number
  createdAt: number
  updatedAt: number
}

interface NewProfileData {
  name: string
  role?: string
  model?: string
  description?: string
  systemPrompt?: string
  preferredProvider?: string
  capabilities?: string[]
  whenToUse?: string
  outputContract?: string
  isEnabled?: boolean
  sortOrder?: number
  workspaceId?: string
}

interface PatchProfileData {
  name?: string
  role?: string
  model?: string
  description?: string | null
  systemPrompt?: string | null
  preferredProvider?: string | null
  capabilities?: string[] | null
  whenToUse?: string | null
  outputContract?: string | null
  isEnabled?: boolean
  sortOrder?: number
}

interface AgentProfileState {
  profiles: AgentProfileConfig[]

  loadProfiles: (workspaceId?: string) => Promise<void>
  createProfile: (data: NewProfileData) => Promise<AgentProfileConfig>
  updateProfile: (id: string, patch: PatchProfileData) => Promise<AgentProfileConfig>
  deleteProfile: (id: string) => Promise<void>
  seedDefaults: () => Promise<void>
}

export const useAgentProfileStore = create<AgentProfileState>((set, get) => ({
  profiles: [],

  loadProfiles: async (workspaceId) => {
    try {
      const profiles = await window.api.agent.listProfiles(workspaceId)
      set({ profiles: profiles as AgentProfileConfig[] })
    } catch {
      // keep existing state
    }
  },

  createProfile: async (data) => {
    const profile = await window.api.agent.createProfile(data)
    set((state) => ({ profiles: [...state.profiles, profile as AgentProfileConfig] }))
    return profile as AgentProfileConfig
  },

  updateProfile: async (id, patch) => {
    const updated = await window.api.agent.updateProfile(id, patch)
    set((state) => ({
      profiles: state.profiles.map((p) => (p.id === id ? (updated as AgentProfileConfig) : p))
    }))
    return updated as AgentProfileConfig
  },

  deleteProfile: async (id) => {
    await window.api.agent.deleteProfile(id)
    set((state) => ({
      profiles: state.profiles.filter((p) => p.id !== id)
    }))
  },

  seedDefaults: async () => {
    const profiles = await window.api.agent.seedDefaults()
    set({ profiles: profiles as AgentProfileConfig[] })
  }
}))
