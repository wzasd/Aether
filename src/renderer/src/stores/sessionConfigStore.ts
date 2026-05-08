import { create } from 'zustand'

type PermissionMode = 'manual' | 'autoEdit' | 'plan' | 'fullAuto'
export type ExecutionMode = 'serial' | 'parallel'

const STORAGE_KEY = 'bytro-session-config'

function loadPersistedConfig(): Partial<SessionConfigState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return {}
}

function persistConfig(state: Partial<SessionConfigState>) {
  try {
    const existing = loadPersistedConfig()
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...existing, ...state }))
  } catch {}
}

interface SessionConfigState {
  providerType: string
  model: string
  permissionMode: PermissionMode
  workingDir: string
  executionMode: ExecutionMode
}

const persisted = loadPersistedConfig()

export const useSessionConfigStore = create<SessionConfigState & {
  setModel: (model: string) => void
  setProviderType: (providerType: string) => void
  setPermissionMode: (mode: PermissionMode) => void
  setExecutionMode: (mode: ExecutionMode) => void
  selectWorkingDir: () => Promise<void>
}>((set) => ({
  providerType: (persisted.providerType as string) || 'claude-cli',
  model: (persisted.model as SessionConfigState['model']) || 'claude-sonnet-4-6',
  permissionMode: (persisted.permissionMode as PermissionMode) || 'plan',
  workingDir: (persisted.workingDir as string) || '',
  executionMode: (persisted.executionMode as ExecutionMode) || 'serial',
  setProviderType: (providerType) => {
    persistConfig({ providerType })
    set({ providerType })
  },
  setModel: (model) => {
    persistConfig({ model })
    set({ model })
  },
  setPermissionMode: (mode) => {
    persistConfig({ permissionMode: mode })
    set({ permissionMode: mode })
  },
  setExecutionMode: (mode) => {
    persistConfig({ executionMode: mode })
    set({ executionMode: mode })
  },
  selectWorkingDir: async () => {
    const dir = await window.api.dialog.openDirectory()
    if (dir) {
      persistConfig({ workingDir: dir })
      set({ workingDir: dir })
    }
  }
}))
