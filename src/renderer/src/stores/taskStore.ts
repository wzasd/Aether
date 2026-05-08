import { create } from 'zustand'

export type TaskStatus = 'Idle' | 'Running' | 'Waiting' | 'Error' | 'Done'

interface Task {
  id: string
  project_id: string
  title: string
  description: string | null
  status: TaskStatus
  mode: string | null
  created_at: number
  updated_at: number
  completed_at: number | null
  /** Derived: number of agents assigned */
  agent_count: number
  /** Derived: number of file changes */
  change_count: number
}

interface TaskState {
  tasks: Task[]
  activeTaskId: string | null
  filter: 'all' | 'active' | 'pending' | 'completed'
  loading: boolean

  loadTasks: (projectId?: string) => Promise<void>
  createTask: (projectId: string, data: { title: string; description?: string; mode?: string }) => Promise<Task>
  setActiveTask: (taskId: string) => void
  updateTaskStatus: (taskId: string, status: TaskStatus) => Promise<void>
  deleteTask: (taskId: string) => Promise<void>
  setFilter: (filter: TaskState['filter']) => void
}

function mapTask(raw: any): Task {
  return {
    ...raw,
    agent_count: raw.agent_count ?? raw.agentCount ?? 0,
    change_count: raw.change_count ?? raw.changes ?? 0,
  }
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  activeTaskId: null,
  filter: 'all',
  loading: false,

  loadTasks: async (projectId) => {
    set({ loading: true })
    try {
      const tasks = (await window.api.task.list(projectId)).map(mapTask)
      set({ tasks, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  createTask: async (projectId, data) => {
    const task = mapTask(await window.api.task.create(projectId, data))
    set((state) => ({ tasks: [task, ...state.tasks], activeTaskId: task.id }))
    return task
  },

  setActiveTask: (taskId) => set({ activeTaskId: taskId }),

  updateTaskStatus: async (taskId, status) => {
    const updated = mapTask(await window.api.task.updateStatus(taskId, status))
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === taskId ? updated : t)),
    }))
  },

  deleteTask: async (taskId) => {
    const previous = get()
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== taskId),
      activeTaskId: state.activeTaskId === taskId ? null : state.activeTaskId,
    }))
    try {
      await window.api.task.delete(taskId)
    } catch (error) {
      set({
        tasks: previous.tasks,
        activeTaskId: previous.activeTaskId,
      })
      throw error
    }
  },

  setFilter: (filter) => set({ filter }),
}))
