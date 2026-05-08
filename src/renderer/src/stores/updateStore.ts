import { create } from 'zustand'

interface UpdateState {
  checking: boolean
  lastResult: UpdateInfo | null
  dismissedVersion: string | null

  checkUpdate: () => Promise<void>
  dismissUpdate: () => void
  setOnStartupResult: (info: UpdateInfo) => void
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  checking: false,
  lastResult: null,
  dismissedVersion: null,

  checkUpdate: async () => {
    set({ checking: true })
    try {
      const info = await window.api.system.checkUpdate()
      const { dismissedVersion } = get()
      if (!info.hasUpdate || info.latestVersion !== dismissedVersion) {
        set({ lastResult: info, checking: false })
      } else {
        set({ checking: false })
      }
    } catch {
      set({ checking: false })
    }
  },

  dismissUpdate: () => {
    const { lastResult } = get()
    if (lastResult?.latestVersion) {
      set({ dismissedVersion: lastResult.latestVersion, lastResult: null })
    }
  },

  setOnStartupResult: (info: UpdateInfo) => {
    const { dismissedVersion } = get()
    if (info.hasUpdate && info.latestVersion !== dismissedVersion) {
      set({ lastResult: info })
    }
  }
}))
