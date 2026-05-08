import { create } from 'zustand'

interface MemoryCandidate {
  id: string
  workspace_id: string
  kind: string
  title: string
  content: string
  source_conversation_id?: string
  source_message_id?: string
  confidence: string
  status: string
  created_at: number
  updated_at: number
}

interface ProjectMemoryItem {
  id: string
  workspace_id: string
  kind: string
  title: string
  content: string
  status: string
  source_path?: string
  source_hash?: string
  created_at: number
  updated_at: number
}

interface ConversationSummary {
  id: string
  conversation_id: string
  summary: string
  completed_items?: string
  pending_items?: string
  changed_files?: string
  risks?: string
  next_steps?: string
  from_message_id?: string
  to_message_id?: string
  created_at: number
}

interface AgentSession {
  id: string
  workspace_id: string
  conversation_id: string
  agent_id: string
  provider: string
  external_session_id?: string
  seq: number
  status: string
  created_at: number
  ended_at?: number
}

interface MemoryState {
  candidates: MemoryCandidate[]
  projectItems: ProjectMemoryItem[]
  currentSummary: ConversationSummary | null
  agentSessions: AgentSession[]
  projectMemoryText: string | null
  agentMemoryText: string | null
  recallResults: any[]

  loadCandidates: (workspaceId: string, status?: string) => Promise<void>
  createCandidate: (data: { workspace_id: string; kind: string; title: string; content: string; source_conversation_id?: string; source_message_id?: string; confidence: string }) => Promise<string>
  approveCandidate: (id: string, workspaceId: string) => Promise<void>
  rejectCandidate: (id: string) => Promise<void>
  loadProjectItems: (workspaceId: string) => Promise<void>
  loadProjectMemoryText: (workspaceId: string) => Promise<void>
  appendProjectMemory: (workspaceId: string, section: string, entry: string) => Promise<void>
  loadAgentMemoryText: (workspaceId: string, agentId: string) => Promise<void>
  loadLatestSummary: (conversationId: string) => Promise<void>
  createSummary: (data: { conversation_id: string; summary: string; completed_items?: string; pending_items?: string; changed_files?: string; risks?: string; next_steps?: string; from_message_id?: string; to_message_id?: string }) => Promise<string>
  recall: (query: string, options: { scope?: string; workspaceId?: string; conversationId?: string; limit?: number }) => Promise<void>
  createAgentSession: (data: { workspace_id: string; conversation_id: string; agent_id: string; provider: string; external_session_id?: string; seq?: number; status: string }) => Promise<string>
  endAgentSession: (id: string) => Promise<void>
  endAgentSessionByExternalId: (externalSessionId: string) => Promise<void>
  loadAgentSessions: (conversationId: string) => Promise<void>
}

export const useMemoryStore = create<MemoryState>((set) => ({
  candidates: [],
  projectItems: [],
  currentSummary: null,
  agentSessions: [],
  projectMemoryText: null,
  agentMemoryText: null,
  recallResults: [],

  loadCandidates: async (workspaceId, status) => {
    const candidates = await window.api.memory.listCandidates(workspaceId, status)
    set({ candidates })
  },

  createCandidate: async (data) => {
    const { id } = await window.api.memory.createCandidate(data)
    return id
  },

  approveCandidate: async (id, workspaceId) => {
    await window.api.memory.materializeCandidate(id)
    const [candidates, projectItems] = await Promise.all([
      window.api.memory.listCandidates(workspaceId),
      window.api.memory.listProjectItems(workspaceId)
    ])
    set({ candidates, projectItems })
  },

  rejectCandidate: async (id) => {
    await window.api.memory.updateCandidateStatus(id, 'rejected')
    set((state) => ({
      candidates: state.candidates.filter((c) => c.id !== id)
    }))
  },

  loadProjectItems: async (workspaceId) => {
    const projectItems = await window.api.memory.listProjectItems(workspaceId)
    set({ projectItems })
  },

  loadProjectMemoryText: async (workspaceId) => {
    const projectMemoryText = await window.api.memory.readProjectMemory(workspaceId)
    set({ projectMemoryText })
  },

  appendProjectMemory: async (workspaceId, section, entry) => {
    await window.api.memory.appendProjectMemory(workspaceId, section, entry)
    const projectMemoryText = await window.api.memory.readProjectMemory(workspaceId)
    set({ projectMemoryText })
  },

  loadAgentMemoryText: async (workspaceId, agentId) => {
    const agentMemoryText = await window.api.memory.readAgentMemory(workspaceId, agentId)
    set({ agentMemoryText })
  },

  loadLatestSummary: async (conversationId) => {
    const currentSummary = await window.api.memory.getLatestSummary(conversationId)
    set({ currentSummary: currentSummary || null })
  },

  createSummary: async (data) => {
    const { id } = await window.api.memory.createSummary(data)
    return id
  },

  recall: async (query, options) => {
    const recallResults = await window.api.memory.recall(query, options)
    set({ recallResults })
  },

  createAgentSession: async (data) => {
    const session = await window.api.memory.createAgentSession(data)
    set((state) => ({
      agentSessions: [
        ...state.agentSessions.filter((existing) => existing.id !== session.id),
        session as AgentSession
      ]
    }))
    return session.id
  },

  endAgentSession: async (id) => {
    await window.api.memory.endAgentSession(id)
    set((state) => ({
      agentSessions: state.agentSessions.map((session) =>
        session.id === id ? { ...session, status: 'ended', ended_at: Math.floor(Date.now() / 1000) } : session
      )
    }))
  },

  endAgentSessionByExternalId: async (externalSessionId) => {
    await window.api.memory.endAgentSessionByExternalId(externalSessionId)
    set((state) => ({
      agentSessions: state.agentSessions.map((session) =>
        session.external_session_id === externalSessionId
          ? { ...session, status: 'ended', ended_at: Math.floor(Date.now() / 1000) }
          : session
      )
    }))
  },

  loadAgentSessions: async (conversationId) => {
    const agentSessions = await window.api.memory.listAgentSessions(conversationId)
    set({ agentSessions })
  }
}))
