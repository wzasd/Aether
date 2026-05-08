import { create } from 'zustand'

export type MemoryCategory = 'core' | 'architecture' | 'conventions' | 'antipatterns' | 'decisions'

export interface MemoryEntry {
  id: string
  workspaceId: string
  category: MemoryCategory
  title: string
  content: string
  tags: string[]
  citedBy: string[]
  createdAt: number
  updatedAt: number
}

type NewEntryData = {
  category: MemoryCategory
  title: string
  content: string
  tags?: string[]
}

type PatchData = {
  title?: string
  content?: string
  category?: MemoryCategory
  tags?: string[]
}

interface MemoryPalaceState {
  items: MemoryEntry[]
  filterCategory: MemoryCategory | 'all'
  selectedId: string | null
  isEditing: boolean
  editDraft: Partial<MemoryEntry>
  _openPanelSeq: number

  loadItems: (workspaceId: string) => Promise<void>
  createItem: (workspaceId: string, data: NewEntryData) => Promise<void>
  updateItem: (id: string, patch: PatchData) => Promise<void>
  deleteItem: (id: string) => Promise<void>
  setFilter: (category: MemoryCategory | 'all') => void
  selectEntry: (id: string | null) => void
  startEditing: () => void
  cancelEditing: () => void
  setDraft: (patch: Partial<MemoryEntry>) => void
  requestOpenPanel: () => void
}

export const useMemoryPalaceStore = create<MemoryPalaceState>((set, get) => ({
  items: [],
  filterCategory: 'all',
  selectedId: null,
  isEditing: false,
  editDraft: {},
  _openPanelSeq: 0,

  loadItems: async (workspaceId) => {
    try {
      const entries = await window.api.memoryPalace.list(workspaceId)
      set({ items: entries as MemoryEntry[] })
    } catch {
      // keep existing state
    }
  },

  createItem: async (workspaceId, data) => {
    const entry = await window.api.memoryPalace.create(workspaceId, data) as MemoryEntry
    set((state) => ({ items: [entry, ...state.items], selectedId: entry.id, isEditing: false }))
  },

  updateItem: async (id, patch) => {
    const updated = await window.api.memoryPalace.update(id, patch) as MemoryEntry
    set((state) => ({
      items: state.items.map((item) => (item.id === id ? updated : item)),
      isEditing: false,
      editDraft: {}
    }))
  },

  deleteItem: async (id) => {
    await window.api.memoryPalace.delete(id)
    set((state) => {
      const items = state.items.filter((item) => item.id !== id)
      const selectedId = state.selectedId === id ? (items[0]?.id ?? null) : state.selectedId
      return { items, selectedId, isEditing: false, editDraft: {} }
    })
  },

  setFilter: (category) => set({ filterCategory: category }),

  selectEntry: (id) => set({ selectedId: id, isEditing: false, editDraft: {} }),

  startEditing: () => {
    const selected = get().items.find((item) => item.id === get().selectedId)
    set({
      isEditing: true,
      editDraft: selected ? { ...selected } : { category: 'core', title: '', content: '' }
    })
  },

  cancelEditing: () => set({ isEditing: false, editDraft: {} }),

  setDraft: (patch) => set((state) => ({ editDraft: { ...state.editDraft, ...patch } })),

  requestOpenPanel: () => set((state) => ({ _openPanelSeq: state._openPanelSeq + 1 }))
}))
