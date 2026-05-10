import { create } from 'zustand'

type PermissionMode = 'manual' | 'autoEdit' | 'plan' | 'fullAuto' | 'trusted'
export type ExecutionMode = 'serial' | 'parallel'

/** Post-去Solo migration: canonical 3-tier permission (plan / autoEdit / trusted). */
export type CanonicalPermissionMode = 'plan' | 'autoEdit' | 'trusted'

const STORAGE_KEY = 'bytro-session-config'

function migratePermissionMode(raw: PermissionMode | undefined): PermissionMode {
  // 去Solo 后 canonical 三档：manual → plan, fullAuto → trusted
  if (raw === 'manual') return 'plan'
  if (raw === 'fullAuto') return 'trusted'
  return raw ?? 'plan'
}

function loadPersistedConfig(): Partial<SessionConfigState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    // Migrate legacy permission modes
    if (parsed.permissionMode && (parsed.permissionMode === 'manual' || parsed.permissionMode === 'fullAuto')) {
      parsed.permissionMode = migratePermissionMode(parsed.permissionMode)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed))
    }
    return parsed
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
  providerType: (persisted.providerType as string) || 'claude',
  model: (persisted.model as SessionConfigState['model']) || 'claude-sonnet-4-6',
  permissionMode: migratePermissionMode(persisted.permissionMode as PermissionMode | undefined),
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
