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
  loadProjectMemoryText: (workspacePath: string) => Promise<void>
  appendProjectMemory: (workspacePath: string, section: string, entry: string) => Promise<void>
  loadAgentMemoryText: (workspacePath: string, agentId: string) => Promise<void>
  loadLatestSummary: (conversationId: string) => Promise<void>
  createSummary: (data: { conversation_id: string; summary: string; completed_items?: string; pending_items?: string; changed_files?: string; risks?: string; next_steps?: string; from_message_id?: string; to_message_id?: string }) => Promise<string>
  recall: (query: string, options: { scope?: string; workspaceId?: string; conversationId?: string; limit?: number }) => Promise<void>
  createAgentSession: (data: { workspace_id: string; conversation_id: string; agent_id: string; provider: string; external_session_id?: string; seq: number; status: string }) => Promise<string>
  endAgentSession: (id: string) => Promise<void>
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
    await window.api.memory.updateCandidateStatus(id, 'approved')
    const candidate = await window.api.memory.listCandidates(workspaceId).then((cs: any[]) => cs.find((c: any) => c.id === id))
    if (candidate) {
      await window.api.memory.createProjectItem({
        workspace_id: candidate.workspace_id,
        kind: candidate.kind,
        title: candidate.title,
        content: candidate.content
      })
      await window.api.memory.updateCandidateStatus(id, 'materialized')
    }
  },

  rejectCandidate: async (id) => {
    await window.api.memory.updateCandidateStatus(id, 'rejected')
  },

  loadProjectItems: async (workspaceId) => {
    const projectItems = await window.api.memory.listProjectItems(workspaceId)
    set({ projectItems })
  },

  loadProjectMemoryText: async (workspacePath) => {
    const projectMemoryText = await window.api.memory.readProjectMemory(workspacePath)
    set({ projectMemoryText })
  },

  appendProjectMemory: async (workspacePath, section, entry) => {
    await window.api.memory.appendProjectMemory(workspacePath, section, entry)
    const projectMemoryText = await window.api.memory.readProjectMemory(workspacePath)
    set({ projectMemoryText })
  },

  loadAgentMemoryText: async (workspacePath, agentId) => {
    const agentMemoryText = await window.api.memory.readAgentMemory(workspacePath, agentId)
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
    const { id } = await window.api.memory.createAgentSession(data)
    return id
  },

  endAgentSession: async (id) => {
    await window.api.memory.endAgentSession(id)
  },

  loadAgentSessions: async (conversationId) => {
    const agentSessions = await window.api.memory.listAgentSessions(conversationId)
    set({ agentSessions })
  }
}))
