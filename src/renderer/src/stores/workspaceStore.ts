import { create } from 'zustand'

interface Workspace {
  id: string
  name: string
  description: string | null
  icon: string | null
  repo_path: string | null
  created_at: number
  updated_at: number
}

interface WorkspaceState {
  workspaces: Workspace[]
  currentWorkspaceId: string | null
  loading: boolean
  loadWorkspaces: () => Promise<void>
  setCurrentWorkspace: (id: string | null) => void
  createWorkspace: (data: { name: string; description?: string; repo_path?: string }) => Promise<Workspace | null>
  deleteWorkspace: (id: string) => Promise<void>
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  workspaces: [],
  currentWorkspaceId: null,
  loading: false,

  loadWorkspaces: async () => {
    set({ loading: true })
    try {
      const workspaces = await window.api.workspace.list()
      set({ workspaces, loading: false })
    } catch (err) {
      console.error('Failed to load workspaces:', err)
      set({ loading: false })
    }
  },

  setCurrentWorkspace: (id) => set({ currentWorkspaceId: id }),

  createWorkspace: async (data) => {
    try {
      const workspace = await window.api.workspace.create(data)
      set((state) => ({ workspaces: [workspace, ...state.workspaces] }))
      return workspace
    } catch (err) {
      console.error('Failed to create workspace:', err)
      return null
    }
  },

  deleteWorkspace: async (id) => {
    try {
      await window.api.workspace.delete(id)
      set((state) => ({
        workspaces: state.workspaces.filter((w) => w.id !== id),
        currentWorkspaceId: state.currentWorkspaceId === id ? null : state.currentWorkspaceId
      }))
    } catch (err) {
      console.error('Failed to delete workspace:', err)
    }
  }
}))