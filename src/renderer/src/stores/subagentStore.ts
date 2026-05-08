import { create } from 'zustand'

export interface SubagentInfo {
  id: string
  name: string
  type: string
  description?: string
  status: 'active' | 'completed' | 'stopped'
  result?: string
  startedAt?: number
}

interface SubagentState {
  agents: Record<string, SubagentInfo>
}

export const useSubagentStore = create<SubagentState & {
  onSubagentStarted: (event: { agentId: string; agentType: string; name: string; description?: string }) => void
  onSubagentStopped: (event: { agentId: string }) => void
  onSubagentCompleted: (event: { agentId: string; result?: string }) => void
  clear: () => void
}>((set) => ({
  agents: {},
  onSubagentStarted: (event) => {
    set((state) => ({
      agents: {
        ...state.agents,
        [event.agentId]: {
          id: event.agentId,
          name: event.name,
          type: event.agentType,
          description: event.description,
          status: 'active',
          startedAt: Date.now()
        }
      }
    }))
  },
  onSubagentStopped: (event) => {
    set((state) => {
      const { [event.agentId]: _, ...rest } = state.agents
      return { agents: rest }
    })
  },
  onSubagentCompleted: (event) => {
    set((state) => ({
      agents: {
        ...state.agents,
        [event.agentId]: {
          ...state.agents[event.agentId],
          status: 'completed',
          result: event.result
        }
      }
    }))
  },
  clear: () => set({ agents: {} })
}))
