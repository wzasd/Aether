import { create } from 'zustand'

type ThemeMode = 'light' | 'dark' | 'system'
type ResolvedTheme = 'light' | 'dark'

function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return mode
}

function applyTheme(resolved: ResolvedTheme) {
  document.documentElement.classList.toggle('dark', resolved === 'dark')
}

function getSavedTheme(): ThemeMode {
  const stored = localStorage.getItem('bytro-theme')
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  return 'dark'
}

const savedMode = getSavedTheme()
applyTheme(resolveTheme(savedMode))

interface UIState {
  sidebarOpen: boolean
  theme: ThemeMode
  resolved: ResolvedTheme
  toggleSidebar: () => void
  setTheme: (theme: ThemeMode) => void
  taskRailCollapsed: boolean
  setTaskRailCollapsed: (v: boolean) => void
  toggleTaskRailCollapsed: () => void
  workspaceCollapsed: boolean
  setWorkspaceCollapsed: (v: boolean) => void
  toggleWorkspaceCollapsed: () => void
  showSidePanel: boolean
  setShowSidePanel: (v: boolean) => void
  bottomPanelOpen: boolean
  toggleBottomPanel: () => void
  setBottomPanelOpen: (v: boolean) => void
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  theme: savedMode,
  resolved: resolveTheme(savedMode),

  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

  setTheme: (theme) => {
    const resolved = resolveTheme(theme)
    set({ theme, resolved })
    localStorage.setItem('bytro-theme', theme)
    applyTheme(resolved)
  },

  taskRailCollapsed: false,
  setTaskRailCollapsed: (taskRailCollapsed) => set({ taskRailCollapsed }),
  toggleTaskRailCollapsed: () => set((state) => ({ taskRailCollapsed: !state.taskRailCollapsed })),

  workspaceCollapsed: false,
  setWorkspaceCollapsed: (workspaceCollapsed) => set({ workspaceCollapsed }),
  toggleWorkspaceCollapsed: () => set((state) => ({ workspaceCollapsed: !state.workspaceCollapsed })),

  showSidePanel: false,
  setShowSidePanel: (showSidePanel) => set({ showSidePanel }),

  bottomPanelOpen: false,
  toggleBottomPanel: () => set((state) => ({ bottomPanelOpen: !state.bottomPanelOpen })),
  setBottomPanelOpen: (bottomPanelOpen) => set({ bottomPanelOpen }),
}))

// Listen for system theme changes when mode is 'system'
if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    const state = useUIStore.getState()
    if (state.theme === 'system') {
      const resolved = e.matches ? 'dark' : 'light'
      applyTheme(resolved)
      useUIStore.setState({ resolved })
    }
  })
}
