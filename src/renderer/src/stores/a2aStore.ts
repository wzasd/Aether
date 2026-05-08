import { create } from 'zustand'

export type A2AStatus = 'pending' | 'working' | 'completed' | 'failed'

export interface A2ATask {
  id: string
  conversationId: string
  fromProfileId: string | null
  toProfileId: string
  message: string
  status: A2AStatus
  depth: number
  createdAt: number
  completedAt?: number
}

interface A2AState {
  tasksByConversation: Record<string, A2ATask[]>
  queuePositions: Record<string, Record<string, number>> // conversationId -> taskId -> position
  onTaskCreated: (task: A2ATask) => void
  onTaskCompleted: (payload: { taskId: string; conversationId: string; error?: string }) => void
  onTaskQueued: (payload: { taskId: string; conversationId: string; position: number }) => void
  getTasksForConversation: (conversationId: string) => A2ATask[]
  getQueuePosition: (conversationId: string, taskId: string) => number | undefined
  clearConversation: (conversationId: string) => void
}

export const useA2AStore = create<A2AState>((set, get) => ({
  tasksByConversation: {},
  queuePositions: {},

  onTaskCreated: (task) => {
    set((state) => {
      const existing = state.tasksByConversation[task.conversationId] ?? []
      return {
        tasksByConversation: {
          ...state.tasksByConversation,
          [task.conversationId]: [...existing, task]
        }
      }
    })
  },

  onTaskCompleted: ({ taskId, conversationId, error }) => {
    set((state) => {
      const tasks = state.tasksByConversation[conversationId]
      if (!tasks) return state
      const newPositions = { ...state.queuePositions[conversationId] }
      delete newPositions[taskId]
      return {
        tasksByConversation: {
          ...state.tasksByConversation,
          [conversationId]: tasks.map((t) =>
            t.id === taskId
              ? { ...t, status: error ? ('failed' as A2AStatus) : ('completed' as A2AStatus), completedAt: Math.floor(Date.now() / 1000) }
              : t
          )
        },
        queuePositions: {
          ...state.queuePositions,
          [conversationId]: newPositions
        }
      }
    })
  },

  onTaskQueued: ({ taskId, conversationId, position }) => {
    set((state) => ({
      queuePositions: {
        ...state.queuePositions,
        [conversationId]: {
          ...(state.queuePositions[conversationId] ?? {}),
          [taskId]: position
        }
      }
    }))
  },

  getTasksForConversation: (conversationId) => {
    return get().tasksByConversation[conversationId] ?? []
  },

  getQueuePosition: (conversationId, taskId) => {
    return get().queuePositions[conversationId]?.[taskId]
  },

  clearConversation: (conversationId) => {
    set((state) => {
      const { [conversationId]: _, ...restTasks } = state.tasksByConversation
      const { [conversationId]: __, ...restPositions } = state.queuePositions
      return { tasksByConversation: restTasks, queuePositions: restPositions }
    })
  }
}))
